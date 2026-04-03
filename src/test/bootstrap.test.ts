import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapSkill, detectInvokerCli, ensureInvokerCli, getInvokerBootstrapCommands } from '../core/bootstrap.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-bootstrap-'));
  const savedEnv: Record<string, string | undefined> = {};
  const vars = ['HOME', 'PATH'];
  for (const v of vars) savedEnv[v] = process.env[v];
  try {
    await run(dir);
  } finally {
    for (const v of vars) {
      if (savedEnv[v] === undefined) delete process.env[v];
      else process.env[v] = savedEnv[v];
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test('getInvokerBootstrapCommands returns install and fallback commands', () => {
  const commands = getInvokerBootstrapCommands();
  assert.equal(commands.installCommand, 'npm install -g @cooodersan/invoker');
  assert.equal(commands.fallbackCommand, 'npx -y @cooodersan/invoker');
});

test('detectInvokerCli reports missing command when command is not on PATH', async () => {
  await withTempDir(async (dir) => {
    process.env.PATH = join(dir, 'empty-bin');
    const result = await detectInvokerCli('invoker');
    assert.equal(result.available, false);
    assert.equal(result.command, 'invoker');
    assert.equal(result.detectedPath, undefined);
  });
});

test('ensureInvokerCli reports missing with fallback guidance when auto install is disabled', async () => {
  await withTempDir(async (dir) => {
    process.env.PATH = join(dir, 'empty-bin');

    const result = await ensureInvokerCli({ autoInstall: false });

    assert.equal(result.status, 'missing');
    assert.equal(result.command, 'invoker');
    assert.equal(result.installCommand, 'npm install -g @cooodersan/invoker');
    assert.equal(result.fallbackCommand, 'npx -y @cooodersan/invoker');
    assert.match(result.message, /Install it with/);
    assert.match(result.message, /one-shot execution/);
  });
});

test('ensureInvokerCli installs custom command when auto install succeeds', async () => {
  await withTempDir(async (dir) => {
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`;

    const installScript = join(dir, 'install-invoker.sh');
    await writeFile(
      installScript,
      `#!/bin/sh
cat > "${join(binDir, 'invoker')}" <<'EOF'
#!/bin/sh
echo invoker-test
EOF
chmod +x "${join(binDir, 'invoker')}"
`,
      'utf8',
    );

    const result = await ensureInvokerCli({ autoInstall: true, installCommand: `/bin/sh "${installScript}"` });

    assert.equal(result.status, 'installed');
    assert.equal(result.command, 'invoker');
    assert.equal(result.detectedPath, join(binDir, 'invoker'));
    assert.match(result.message, /Installed Invoker CLI/);
  });
});

test('ensureInvokerCli reports failed when install command exits non-zero', async () => {
  await withTempDir(async (dir) => {
    process.env.PATH = join(dir, 'empty-bin');

    const result = await ensureInvokerCli({ autoInstall: true, installCommand: '/bin/sh -c "exit 7"' });

    assert.equal(result.status, 'failed');
    assert.equal(result.command, 'invoker');
  });
});

test('bootstrapSkill installs missing remote skill and returns ready doctor report', async () => {
  await withTempDir(async (dir) => {
    process.env.HOME = dir;

    const targetRoot = join(dir, 'runtime', 'claude', 'skills');
    const skillDir = join(targetRoot, 'bootstrap-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: bootstrap-skill
description: bootstrap
version: 1.0.0
entrypoint: ./run.sh
---

# Bootstrap Skill
`,
      'utf8',
    );
    await writeFile(join(skillDir, 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');

    const result = await bootstrapSkill('bootstrap-skill', { target: 'claude', targetRoot });

    assert.equal(result.skill, 'bootstrap-skill');
    assert.equal(result.installAttempted, false);
    assert.equal(result.installPlan, undefined);
    assert.equal(result.doctorReport.skillName, 'bootstrap-skill');
    assert.equal(result.doctorReport.overall, 'warning');
  });
});

test('bootstrapSkill installs dependencies when doctor reports blocking error', async () => {
  await withTempDir(async (dir) => {
    process.env.HOME = dir;

    const targetRoot = join(dir, 'runtime', 'claude', 'skills');
    const skillDir = join(targetRoot, 'bootstrap-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: bootstrap-skill
description: bootstrap
version: 1.0.0
entrypoint: ./run.sh
requires:
  resources:
    - name: config
      path: ./config.json
      template: '{"ok":true}'
---

# Bootstrap Skill
`,
      'utf8',
    );
    await writeFile(join(skillDir, 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');

    const result = await bootstrapSkill('bootstrap-skill', { target: 'claude', targetRoot });

    assert.equal(result.installAttempted, true);
    assert.ok(result.installPlan);
    assert.ok(result.installPlan?.steps.some((step) => step.type === 'resource' && step.status === 'skipped'));
    assert.equal(result.doctorReport.overall, 'error');
  });
});
