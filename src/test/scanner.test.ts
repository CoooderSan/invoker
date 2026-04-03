import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../core/scanner.js';

const sampleSkillMd = `---
name: sample-skill
description: sample
version: 1.0.0
entrypoint: ./run.sh
requires:
  cli:
    - name: git
      command: git
  env:
    - name: Base URL
      envVar: BASE_URL
trust:
  checkers:
    - name: builtin-check
      skill: ../trust-check
notes:
  - sample note
---
# Sample Skill
`;

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-scan-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('scan prefers SKILL.md and parses frontmatter', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(join(dir, 'skill', 'SKILL.md'), sampleSkillMd, 'utf8');

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.manifest.name, 'sample-skill');
    assert.equal(normalized.primaryDocFormat, 'markdown');
    assert.ok(normalized.primaryDocPath.endsWith('SKILL.md'));
    assert.equal(normalized.manifestPath, normalized.primaryDocPath);
    assert.equal(normalized.trust?.checkers?.[0].name, 'builtin-check');
    assert.equal(normalized.sidecarPath, undefined);
    assert.equal(normalized.warnings.length, 0);
  });
});

test('scan warns when using legacy yaml only', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: no-sidecar\ndescription: no sidecar\nversion: 1.0.0\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.primaryDocFormat, 'yaml');
    assert.equal(normalized.warnings.length, 1);
    assert.equal(normalized.warnings[0].code, 'legacy_yaml');
  });
});

test('scan prefers SKILL.md when markdown and yaml coexist', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(join(dir, 'skill', 'SKILL.md'), sampleSkillMd, 'utf8');
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: stale-skill\ndescription: stale\nversion: 0.9.0\nrequires:\n  cli:\n    - name: stale-cli\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `requires:\n  resources:\n    - name: tpl\n      path: ./templates/review.md\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.manifest.name, 'sample-skill');
    assert.equal(normalized.primaryDocFormat, 'markdown');
    assert.deepEqual(
      normalized.effectiveRequires?.cli?.map((item) => item.name),
      ['git'],
    );
    assert.equal(normalized.effectiveRequires?.resources?.length, 1);
    assert.equal(normalized.warnings.length, 1);
    assert.equal(normalized.warnings[0].code, 'duplicate_primary_doc');
    assert.deepEqual(normalized.warnings[0].paths.map((item) => item.split('/').pop()), ['SKILL.md', 'skill.yaml']);
  });
});

test('scan merges sidecar with SKILL.md primary document', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(join(dir, 'skill', 'SKILL.md'), sampleSkillMd, 'utf8');
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `requires:\n  resources:\n    - name: tpl\n      path: ./templates/review.md\ntrust:\n  checkers:\n    - name: sidecar-check\n      skill: ../sidecar-check\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.manifest.name, 'sample-skill');
    assert.equal(normalized.primaryDocFormat, 'markdown');
    assert.equal(normalized.effectiveRequires?.cli?.[0].name, 'git');
    assert.equal(normalized.effectiveRequires?.resources?.[0].name, 'tpl');
    assert.equal(normalized.trust?.checkers?.[0].name, 'builtin-check');
    assert.equal(normalized.warnings.length, 0);
  });
});



test('scan parses single-file SKILL.md with requires and trust', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'SKILL.md'),
      `---
name: single-file-skill
description: single file
version: 1.0.0
entrypoint: ./run.sh
requires:
  env:
    - name: Base URL
      envVar: BASE_URL
      defaultValue: https://example.com
trust:
  checkers:
    - name: skills-check
      skill: ../skills-check
      required: true
---

# Single File Skill
`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.manifest.name, 'single-file-skill');
    assert.equal(normalized.manifestPath, join(dir, 'skill', 'SKILL.md'));
    assert.equal(normalized.primaryDocPath, join(dir, 'skill', 'SKILL.md'));
    assert.equal(normalized.primaryDocFormat, 'markdown');
    assert.equal(normalized.sidecarPath, undefined);
    assert.equal(normalized.effectiveRequires?.env?.[0].envVar, 'BASE_URL');
    assert.equal(normalized.trust?.checkers?.[0].name, 'skills-check');
    assert.deepEqual(normalized.warnings, []);
  });
});

test('scan prefers SKILL.md over legacy yaml and emits warning', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'SKILL.md'),
      `---
name: canonical-skill
description: canonical
version: 2.0.0
requires:
  env:
    - name: Base URL
      envVar: BASE_URL
---

# Canonical
`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: legacy-skill
description: legacy
version: 1.0.0
requires:
  cli:
    - name: jq
      command: jq
`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'invoker.skill.yaml'), `trust:
  checkers:
    - name: legacy-check
`, 'utf8');

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.manifest.name, 'canonical-skill');
    assert.equal(normalized.manifest.version, '2.0.0');
    assert.equal(normalized.primaryDocFormat, 'markdown');
    assert.ok(normalized.sidecarPath?.endsWith('invoker.skill.yaml'));
    assert.equal(normalized.effectiveRequires?.cli, undefined);
    assert.equal(normalized.warnings.length, 1);
    assert.equal(normalized.warnings[0].code, 'duplicate_primary_doc');
  });
});

test('scan merges manifest and sidecar requires', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: sample-skill\ndescription: sample\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  cli:\n    - name: git\n      command: git\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `schemaVersion: "0.1"\nrequires:\n  cli:\n    - name: jq\n      command: jq\n  resources:\n    - name: tpl\n      path: ./templates/review.md\n      template: |\n        # Review\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.manifest.name, 'sample-skill');
    assert.ok(normalized.sidecarPath?.endsWith('invoker.skill.yaml'));
    assert.equal(normalized.effectiveRequires?.cli?.length, 2);
    assert.equal(normalized.effectiveRequires?.env?.length, 1);
    assert.equal(normalized.effectiveRequires?.resources?.length, 1);
    assert.equal(normalized.resolutionSource, 'direct_path');
    assert.equal(normalized.location.source, 'direct_path');
    assert.equal(normalized.location.manifestPath, normalized.manifestPath);
    assert.deepEqual(
      normalized.effectiveRequires?.cli?.map((item) => [item.name, item.source]),
      [
        ['git', 'manifest'],
        ['jq', 'sidecar'],
      ],
    );
  });
});

test('scan merges skill dependencies from manifest and sidecar', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'child-skill'));
    await writeFile(
      join(dir, 'child-skill', 'skill.yaml'),
      `name: child-skill\ndescription: child\nversion: 1.0.0\n`,
      'utf8',
    );

    await mkdir(join(dir, 'parent-skill'));
    await writeFile(
      join(dir, 'parent-skill', 'skill.yaml'),
      `name: parent-skill\ndescription: parent\nversion: 1.0.0\nrequires:\n  skills:\n    - name: child-skill\n      path: ../child-skill\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'parent-skill', 'invoker.skill.yaml'),
      `requires:\n  skills:\n    - name: extra-skill\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'parent-skill'));
    assert.equal(normalized.effectiveRequires?.skills?.length, 2);
    assert.deepEqual(
      normalized.effectiveRequires?.skills?.map((item) => [item.name, item.source]),
      [
        ['child-skill', 'manifest'],
        ['extra-skill', 'sidecar'],
      ],
    );
  });
});

test('scan resolves skill by explicit target root', async () => {
  await withTempDir(async (dir) => {
    const claudeRoot = join(dir, 'runtime', 'claude', 'skills');
    const skillDir = join(claudeRoot, 'target-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'skill.yaml'),
      `name: target-skill\ndescription: target\nversion: 1.0.0\n`,
      'utf8',
    );

    const normalized = await scan('target-skill', { target: 'claude', targetRoot: claudeRoot });

    assert.equal(normalized.manifest.name, 'target-skill');
    assert.equal(normalized.target, 'claude');
    assert.equal(normalized.targetRoot, claudeRoot);
    assert.equal(normalized.resolutionSource, 'target_dir');
    assert.equal(normalized.location.target, 'claude');
    assert.equal(normalized.location.targetRoot, claudeRoot);
    assert.equal(normalized.location.skillDir, skillDir);
  });
});

test('scan infers target metadata from direct path under known root', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      const skillDir = join(dir, '.claude', 'skills', 'hosted-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'skill.yaml'),
        `name: hosted-skill\ndescription: hosted\nversion: 1.0.0\n`,
        'utf8',
      );

      const normalized = await scan(skillDir);
      assert.equal(normalized.target, 'claude');
      assert.equal(normalized.targetRoot, join(dir, '.claude', 'skills'));
      assert.equal(normalized.resolutionSource, 'direct_path');
      assert.equal(normalized.location.target, 'claude');
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});

test('scan throws when manifest does not exist', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => scan(join(dir, 'nonexistent-skill')),
      (err: Error) => {
        assert.ok(err.message.includes('Cannot find skill document (SKILL.md, skill.yaml, or skill.yml)'), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });
});

test('scan returns undefined sidecarPath when no sidecar exists', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: no-sidecar\ndescription: no sidecar\nversion: 1.0.0\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.sidecarPath, undefined);
    assert.equal(normalized.sidecar, undefined);
  });
});


test('scan prefers explicit targetRoot over default host root', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      const defaultClaudeRoot = join(dir, '.claude', 'skills');
      const overrideClaudeRoot = join(dir, 'custom', 'claude-skills');
      await mkdir(join(defaultClaudeRoot, 'dup-skill'), { recursive: true });
      await mkdir(join(overrideClaudeRoot, 'dup-skill'), { recursive: true });
      await writeFile(
        join(defaultClaudeRoot, 'dup-skill', 'skill.yaml'),
        `name: default-skill\ndescription: default\nversion: 1.0.0\n`,
        'utf8',
      );
      await writeFile(
        join(overrideClaudeRoot, 'dup-skill', 'skill.yaml'),
        `name: override-skill\ndescription: override\nversion: 2.0.0\n`,
        'utf8',
      );

      const normalized = await scan('dup-skill', { target: 'claude', targetRoot: overrideClaudeRoot });
      assert.equal(normalized.manifest.name, 'override-skill');
      assert.equal(normalized.targetRoot, overrideClaudeRoot);
      assert.equal(normalized.location.skillDir, join(overrideClaudeRoot, 'dup-skill'));
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});

test('scan falls back to configured host root when targetRoot is not provided', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      const configuredClaudeRoot = join(dir, 'runtime', 'claude', 'skills');
      await mkdir(join(dir, '.invoker'), { recursive: true });
      await writeFile(
        join(dir, '.invoker', 'config.json'),
        JSON.stringify({ hosts: { claude: { root: configuredClaudeRoot } } }, null, 2),
        'utf8',
      );
      const skillDir = join(configuredClaudeRoot, 'configured-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'skill.yaml'),
        `name: configured-skill\ndescription: configured\nversion: 1.0.0\n`,
        'utf8',
      );

      const normalized = await scan('configured-skill', { target: 'claude' });
      assert.equal(normalized.manifest.name, 'configured-skill');
      assert.equal(normalized.target, 'claude');
      assert.equal(normalized.targetRoot, configuredClaudeRoot);
      assert.equal(normalized.resolutionSource, 'target_dir');
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});

test('scan merges host-aware requirements and preserves merged metadata', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: host-aware-skill\ndescription: host aware\nversion: 1.0.0\nrequires:\n  settings:\n    - key: enableAllProjectMcpServers\n      host: claude\n  hostConfig:\n    - name: claude-root\n      host: claude\n      kind: root_exists\n  permissions:\n    - mcp__example__read\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `requires:\n  settings:\n    - key: enableAllProjectMcpServers\n      host: claude\n      expectedValue: "true"\n  hostConfig:\n    - name: claude-root\n      host: claude\n      kind: root_exists\n      description: Claude host root must exist\n  permissions:\n    - mcp__example__read\n    - mcp__example__write\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.effectiveRequires?.settings?.length, 1);
    assert.equal(normalized.effectiveRequires?.settings?.[0].key, 'enableAllProjectMcpServers');
    assert.equal(normalized.effectiveRequires?.settings?.[0].host, 'claude');
    assert.equal(normalized.effectiveRequires?.settings?.[0].required, true);
    assert.equal(normalized.effectiveRequires?.settings?.[0].expectedValue, 'true');
    assert.equal(normalized.effectiveRequires?.settings?.[0].source, 'merged');

    assert.equal(normalized.effectiveRequires?.hostConfig?.length, 1);
    assert.equal(normalized.effectiveRequires?.hostConfig?.[0].name, 'claude-root');
    assert.equal(normalized.effectiveRequires?.hostConfig?.[0].host, 'claude');
    assert.equal(normalized.effectiveRequires?.hostConfig?.[0].kind, 'root_exists');
    assert.equal(normalized.effectiveRequires?.hostConfig?.[0].description, 'Claude host root must exist');
    assert.equal(normalized.effectiveRequires?.hostConfig?.[0].required, true);
    assert.equal(normalized.effectiveRequires?.hostConfig?.[0].source, 'merged');

    assert.deepEqual(normalized.effectiveRequires?.permissions, ['mcp__example__read', 'mcp__example__write']);
  });
});

test('scan parses trust checker config from sidecar', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: trust-aware-skill\ndescription: trust aware\nversion: 1.0.0\nentrypoint: ./run.sh\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: ../skills-check\n      target: claude\n      args:\n        - --json\n      required: true\n      timeoutMs: 15000\n`,
      'utf8',
    );

    const normalized = await scan(join(dir, 'skill'));

    assert.equal(normalized.trust?.checkers?.length, 1);
    assert.equal(normalized.trust?.checkers?.[0].name, 'skills-check');
    assert.equal(normalized.trust?.checkers?.[0].skill, '../skills-check');
    assert.equal(normalized.trust?.checkers?.[0].target, 'claude');
    assert.deepEqual(normalized.trust?.checkers?.[0].args, ['--json']);
    assert.equal(normalized.trust?.checkers?.[0].required, true);
    assert.equal(normalized.trust?.checkers?.[0].timeoutMs, 15000);
  });
});
