import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInstallPlan, executeInstallPlan } from '../core/installer.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-installer-'));
  const savedEnv: Record<string, string | undefined> = {};
  const vars = ['MY_TOKEN', 'BASE_URL', 'HOME'];
  for (const v of vars) savedEnv[v] = process.env[v];
  try {
    for (const v of vars) delete process.env[v];
    process.env.HOME = dir;
    await run(dir);
  } finally {
    for (const v of vars) {
      if (savedEnv[v] === undefined) delete process.env[v];
      else process.env[v] = savedEnv[v];
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildInstallPlan generates auto step for cli with installCommand', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: cli-skill\ndescription: cli test\nversion: 1.0.0\nrequires:\n  cli:\n    - name: fake-nonexistent-tool-xyz\n      command: fake-nonexistent-tool-xyz\n      installCommand: "echo install-fake-tool"\n`,
      'utf8',
    );

    const plan = await buildInstallPlan(join(dir, 'skill'));

    assert.equal(plan.skillName, 'cli-skill');
    const step = plan.steps.find((s) => s.type === 'cli');
    assert.ok(step, 'should have a cli step');
    assert.equal(step!.mode, 'auto');
    assert.equal(step!.command, 'echo install-fake-tool');
    assert.equal(step!.status, 'pending');
  });
});

test('buildInstallPlan generates manual step for cli without installCommand', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: manual-cli-skill\ndescription: manual cli\nversion: 1.0.0\nrequires:\n  cli:\n    - name: fake-missing-tool-abc\n      command: fake-missing-tool-abc\n`,
      'utf8',
    );

    const plan = await buildInstallPlan(join(dir, 'skill'));

    const step = plan.steps.find((s) => s.type === 'cli');
    assert.ok(step, 'should have a cli step');
    assert.equal(step!.mode, 'manual');
    assert.equal(step!.command, undefined);
  });
});

test('buildInstallPlan generates manual steps for token and env', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: auth-skill\ndescription: auth test\nversion: 1.0.0\nrequires:\n  tokens:\n    - name: API Token\n      envVar: MY_TOKEN\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n`,
      'utf8',
    );

    const plan = await buildInstallPlan(join(dir, 'skill'));

    const tokenStep = plan.steps.find((s) => s.type === 'token');
    assert.ok(tokenStep, 'should have a token step');
    assert.equal(tokenStep!.mode, 'manual');

    const envStep = plan.steps.find((s) => s.type === 'env');
    assert.ok(envStep, 'should have an env step');
    assert.equal(envStep!.mode, 'manual');
  });
});

test('buildInstallPlan generates auto step for fixable resource', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: resource-skill\ndescription: resource test\nversion: 1.0.0\nrequires:\n  resources:\n    - name: config\n      path: ./config.json\n      template: '{"key": "value"}'\n`,
      'utf8',
    );

    const plan = await buildInstallPlan(join(dir, 'skill'));

    const step = plan.steps.find((s) => s.type === 'resource');
    assert.ok(step, 'should have a resource step');
    assert.equal(step!.mode, 'auto');
    assert.equal(step!.action, 'create');
  });
});

test('buildInstallPlan returns empty steps when all dependencies satisfied', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: ready-skill\ndescription: ready\nversion: 1.0.0\nrequires:\n  cli:\n    - name: node\n      command: node\n`,
      'utf8',
    );

    const plan = await buildInstallPlan(join(dir, 'skill'));

    assert.equal(plan.steps.length, 0, 'node should already be available');
  });
});

test('buildInstallPlan generates auto register step for dependent skill with local path', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      const parentDir = join(dir, 'parent-skill');
      const childDir = join(dir, 'child-skill');
      await mkdir(join(dir, '.invoker'), { recursive: true });
      await mkdir(parentDir, { recursive: true });
      await mkdir(childDir, { recursive: true });
      await writeFile(join(childDir, 'skill.yaml'), `name: child-skill\ndescription: child\nversion: 1.0.0\n`, 'utf8');
      await writeFile(
        join(parentDir, 'skill.yaml'),
        `name: parent-skill\ndescription: parent\nversion: 1.0.0\nrequires:\n  skills:\n    - name: child-skill\n      path: ../child-skill\n`,
        'utf8',
      );

      const plan = await buildInstallPlan(parentDir);
      const step = plan.steps.find((s) => s.type === 'skill');
      assert.ok(step, 'should have a skill step');
      assert.equal(step!.mode, 'auto');
      assert.equal(step!.operation, 'register');
      assert.equal(step!.path, childDir);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});

test('buildInstallPlan generates auto register step for pathless dependent skill already present in same host root', async () => {
  await withTempDir(async (dir) => {
    const claudeRoot = join(dir, 'runtime', 'claude', 'skills');
    const parentDir = join(claudeRoot, 'parent-skill');
    const childDir = join(claudeRoot, 'child-skill');
    await mkdir(join(dir, '.invoker'), { recursive: true });
    await mkdir(parentDir, { recursive: true });
    await mkdir(childDir, { recursive: true });
    await writeFile(join(parentDir, 'skill.yaml'), `name: parent-skill\ndescription: parent\nversion: 1.0.0\nrequires:\n  skills:\n    - name: child-skill\n`, 'utf8');
    await writeFile(join(childDir, 'skill.yaml'), `name: child-skill\ndescription: child\nversion: 1.0.0\n`, 'utf8');

    const plan = await buildInstallPlan('parent-skill', { target: 'claude', targetRoot: claudeRoot });
    const step = plan.steps.find((s) => s.type === 'skill');
    assert.ok(step, 'should have a skill step');
    assert.equal(step!.mode, 'auto');
    assert.equal(step!.operation, 'register');
    assert.equal(step!.path, childDir);
    assert.equal(step!.host, 'claude');
  });
});
