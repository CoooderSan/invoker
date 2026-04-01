import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from '../core/doctor.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-doctor-'));
  const previousToken = process.env.MY_TOKEN;
  const previousUrl = process.env.BASE_URL;
  try {
    delete process.env.MY_TOKEN;
    delete process.env.BASE_URL;
    await run(dir);
  } finally {
    if (previousToken === undefined) delete process.env.MY_TOKEN;
    else process.env.MY_TOKEN = previousToken;
    if (previousUrl === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = previousUrl;
    await rm(dir, { recursive: true, force: true });
  }
}

test('doctor classifies missing auth/config/resource and ready skill dependency', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'dep-skill'));
    await writeFile(join(dir, 'dep-skill', 'skill.yaml'), 'name: dep-skill\ndescription: dep\nversion: 1.0.0\n', 'utf8');

    await mkdir(join(dir, 'main-skill'));
    await writeFile(
      join(dir, 'main-skill', 'skill.yaml'),
      `name: main-skill\ndescription: main\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  tokens:\n    - name: API Token\n      envVar: MY_TOKEN\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n  resources:\n    - name: template\n      path: ./templates/review.md\n      template: |\n        # Review\n  skills:\n    - name: dep-skill\n      path: ../dep-skill\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'main-skill'));

    assert.equal(report.overall, 'error');
    assert.equal(report.summary.error, 3);
    assert.equal(report.summary.ok, 1);
    assert.ok(report.checks.some((item) => item.category === 'token' && item.status === 'error'));
    assert.ok(report.checks.some((item) => item.category === 'env' && item.status === 'error'));
    assert.ok(report.checks.some((item) => item.category === 'resource' && item.status === 'error' && item.fixable));
    assert.ok(report.checks.some((item) => item.category === 'skill' && item.status === 'ok'));
  });
});

test('doctor warns when dependent skill is optional and unavailable', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: optional-parent\ndescription: parent\nversion: 1.0.0\nrequires:\n  skills:\n    - name: missing-skill\n      required: false\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'skill'));
    const check = report.checks.find((item) => item.category === 'skill');
    assert.ok(check);
    assert.equal(check?.status, 'warning');
  });
});

test('doctor emits manifest warning when skill has no requires', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: bare-skill\ndescription: bare\nversion: 1.0.0\nentrypoint: ./run.sh\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'skill'));

    assert.equal(report.overall, 'warning');
    const manifestCheck = report.checks.find((c) => c.category === 'manifest');
    assert.ok(manifestCheck, 'should have a manifest check');
    assert.equal(manifestCheck!.status, 'warning');
    assert.equal(report.requirementsDeclared, false);
  });
});

test('doctor warns on optional missing token instead of erroring', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: optional-token-skill\ndescription: optional token\nversion: 1.0.0\nrequires:\n  tokens:\n    - name: Optional Token\n      envVar: MY_TOKEN\n      required: false\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'skill'));

    const check = report.checks.find((c) => c.category === 'token');
    assert.ok(check);
    assert.equal(check!.status, 'warning');
    assert.equal(report.overall, 'warning');
  });
});

test('doctor remediation points to install/register flow for local dependent skill path', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: parent-skill\ndescription: parent\nversion: 1.0.0\nrequires:\n  skills:\n    - name: child-skill\n      path: ../child-skill\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'skill'));
    const check = report.checks.find((item) => item.category === 'skill');
    assert.ok(check);
    assert.match(check?.remediation ?? '', /register the local dependent skill/);
    assert.ok(check?.suggestedSkillPath?.endsWith('child-skill'));
  });
});
