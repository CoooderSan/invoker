import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSkill } from '../core/runner.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-runner-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('runSkill throws when doctor gate fails (error)', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: blocked-skill\ndescription: blocked\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  cli:\n    - name: fake-nonexistent-cli-zzz\n      command: fake-nonexistent-cli-zzz\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho hello\n', 'utf8');

    await assert.rejects(
      () => runSkill(join(dir, 'skill')),
      (err: Error) => {
        assert.ok(err.message.includes('not runnable'), `expected "not runnable" in: ${err.message}`);
        return true;
      },
    );
  });
});

test('runSkill throws when entrypoint is missing', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: no-entrypoint\ndescription: no entry\nversion: 1.0.0\n`,
      'utf8',
    );

    await assert.rejects(
      () => runSkill(join(dir, 'skill'), [], true),
      (err: Error) => {
        assert.ok(err.message.includes('no entrypoint'), `expected "no entrypoint" in: ${err.message}`);
        return true;
      },
    );
  });
});

test('runSkill executes entrypoint when skipDoctor is true', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: runnable-skill\ndescription: runnable\nversion: 1.0.0\nentrypoint: ./run.sh\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho hello-from-skill\n', 'utf8');

    const result = await runSkill(join(dir, 'skill'), [], true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello-from-skill'));
  });
});

test('runSkill passes through non-zero exit code', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: failing-skill\ndescription: fails\nversion: 1.0.0\nentrypoint: ./run.sh\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\nexit 42\n', 'utf8');

    const result = await runSkill(join(dir, 'skill'), [], true);
    assert.equal(result.exitCode, 42);
  });
});

test('runSkill error message includes host hint when host is specified', async () => {
  await withTempDir(async (dir) => {
    const claudeRoot = join(dir, 'runtime', 'claude', 'skills');
    const skillDir = join(claudeRoot, 'blocked-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'skill.yaml'),
      `name: blocked-skill\ndescription: blocked\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  cli:\n    - name: fake-nonexistent-cli-zzz\n      command: fake-nonexistent-cli-zzz\n`,
      'utf8',
    );
    await writeFile(join(skillDir, 'run.sh'), '#!/bin/sh\necho hello\n', 'utf8');

    await assert.rejects(
      () => runSkill('blocked-skill', [], false, { target: 'claude', targetRoot: claudeRoot }),
      (err: Error) => {
        assert.match(err.message, /--host claude/);
        return true;
      },
    );
  });
});

test('runSkill points to doctor instead of install or fix when host readiness fails', async () => {
  await withTempDir(async (dir) => {
    const claudeRoot = join(dir, 'runtime', 'claude', 'skills');
    const skillDir = join(claudeRoot, 'blocked-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'skill.yaml'),
      `name: blocked-skill\ndescription: blocked\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  settings:\n    - key: enableAllProjectMcpServers\n      host: claude\n      expectedValue: true\n`,
      'utf8',
    );
    await writeFile(join(skillDir, 'run.sh'), '#!/bin/sh\necho hello\n', 'utf8');

    await assert.rejects(
      () => runSkill('blocked-skill', [], false, { target: 'claude', targetRoot: claudeRoot }),
      (err: Error) => {
        assert.match(err.message, /invoker doctor blocked-skill --host claude/);
        assert.doesNotMatch(err.message, /invoker install/i);
        assert.doesNotMatch(err.message, /invoker fix/i);
        return true;
      },
    );
  });
});

test('runSkill proceeds when trust checker reports error', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skills-check'), { recursive: true });
    await writeFile(
      join(dir, 'skills-check', 'skill.yaml'),
      `name: skills-check\ndescription: checker\nversion: 1.0.0\nentrypoint: ./check.js\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skills-check', 'check.js'),
      `console.log(JSON.stringify({ findings: [{ name: 'unsafe-pattern', status: 'error', message: 'Unsafe pattern detected' }] }));\n`,
      'utf8',
    );

    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: trust-runner\ndescription: trust runner\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho trust-runner-ok\n', 'utf8');
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: ../skills-check\n      required: true\n`,
      'utf8',
    );

    const result = await runSkill(join(dir, 'skill'));
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /trust-runner-ok/);
  });
});
