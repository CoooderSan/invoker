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
    assert.equal(report.readinessStatus, 'error');
    assert.equal(report.trustStatus, 'unknown');
    assert.equal(report.summary.error, 3);
    assert.equal(report.summary.ok, 1);
    assert.ok(report.checks.some((item) => item.category === 'token' && item.status === 'error'));
    assert.ok(report.checks.some((item) => item.category === 'env' && item.status === 'error'));
    assert.ok(report.checks.some((item) => item.category === 'resource' && item.status === 'error' && item.fixable));
    assert.ok(report.checks.some((item) => item.category === 'skill' && item.status === 'ok'));
    assert.equal(report.declaredProblems.length, 3);
    assert.equal(report.observedProblems.length, 0);
    assert.equal(report.dependencyFindings.length, 1);
    assert.ok(report.remediationActions.some((item) => item.category === 'token' && item.type === 'configure'));
    assert.ok(report.remediationActions.some((item) => item.category === 'env' && item.type === 'configure'));
    assert.ok(report.remediationActions.some((item) => item.category === 'resource' && item.type === 'create'));
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
    assert.equal(report.dependencyFindings.length, 1);
    assert.equal(report.dependencyFindings[0].required, false);
  });
});

test('doctor classifies host settings, host config, and permissions separately', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      await mkdir(join(dir, 'skill'));
      await mkdir(join(dir, '.claude'), { recursive: true });
      await writeFile(
        join(dir, '.claude', 'settings.json'),
        JSON.stringify({ enableAllProjectMcpServers: false }, null, 2),
        'utf8',
      );
      await writeFile(
        join(dir, 'skill', 'skill.yaml'),
        `name: host-aware-skill\ndescription: host aware\nversion: 1.0.0\nrequires:\n  settings:\n    - key: enableAllProjectMcpServers\n      host: claude\n      expectedValue: true\n  hostConfig:\n    - name: claude-root\n      host: claude\n      kind: root_exists\n  permissions:\n    - mcp__example__read\n`,
        'utf8',
      );

      const report = await doctor(join(dir, 'skill'), { target: 'claude' });

      assert.equal(report.overall, 'error');
      assert.ok(report.checks.some((item) => item.category === 'setting' && item.status === 'error'));
      assert.ok(report.checks.some((item) => item.category === 'hostConfig' && item.status === 'error'));
      assert.ok(report.checks.some((item) => item.category === 'permission' && item.status === 'warning'));
      assert.ok(report.declaredProblems.some((item) => item.category === 'setting'));
      assert.ok(report.declaredProblems.some((item) => item.category === 'hostConfig'));
      assert.ok(report.observedProblems.some((item) => item.category === 'permission'));
      assert.ok(report.remediationActions.some((item) => item.category === 'setting' && item.type === 'verify'));
      assert.ok(report.remediationActions.some((item) => item.category === 'hostConfig' && item.type === 'verify'));
      assert.ok(report.remediationActions.some((item) => item.category === 'permission' && item.type === 'verify'));
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
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
    assert.equal(report.declaredProblems.length, 0);
    assert.equal(report.observedProblems.length, 1);
    assert.equal(report.observedProblems[0].origin, 'observed');
    assert.ok(report.remediationActions.some((item) => item.category === 'manifest' && item.type === 'verify'));
    assert.match(manifestCheck!.detail ?? '', /SKILL\.md frontmatter/);
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
    const dependency = report.dependencyFindings[0];
    assert.equal(dependency.name, 'child-skill');
    assert.equal(dependency.required, true);
    const action = report.remediationActions.find((item) => item.category === 'skill');
    assert.ok(action);
    assert.equal(action?.type, 'register');
  });
});

test('doctor keeps trust status unknown when no checker is configured', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: no-trust-checker\ndescription: no trust checker\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');

    const report = await doctor(join(dir, 'skill'));

    assert.equal(report.readinessStatus, 'ok');
    assert.equal(report.trustStatus, 'unknown');
    assert.equal(report.overall, 'ok');
    assert.equal(report.overallStatus, 'unknown');
    assert.deepEqual(report.trustReport?.findings, []);
  });
});

test('doctor maps trust checker findings into trust report and overall status', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skills-check'), { recursive: true });
    await writeFile(
      join(dir, 'skills-check', 'skill.yaml'),
      `name: skills-check\ndescription: checker\nversion: 1.0.0\nentrypoint: ./check.js\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skills-check', 'check.js'),
      `console.log(JSON.stringify({ findings: [{ name: 'unsafe-pattern', status: 'error', ruleId: 'SC001', message: 'Unsafe pattern detected', remediation: 'Remove unsafe pattern' }] }));\n`,
      'utf8',
    );

    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: trust-checked-skill\ndescription: trust checked\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: ../skills-check\n      required: true\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'skill'));

    assert.equal(report.readinessStatus, 'ok');
    assert.equal(report.overall, 'ok');
    assert.equal(report.trustStatus, 'error');
    assert.equal(report.overallStatus, 'error');
    assert.equal(report.trustReport?.findings.length, 1);
    assert.equal(report.trustReport?.findings[0].provider, 'skills-check');
    assert.equal(report.trustReport?.findings[0].ruleId, 'SC001');
    assert.equal(report.trustReport?.providers?.[0].status, 'error');
  });
});

test('doctor degrades to trust warning when checker returns invalid json', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skills-check'), { recursive: true });
    await writeFile(
      join(dir, 'skills-check', 'skill.yaml'),
      `name: skills-check\ndescription: checker\nversion: 1.0.0\nentrypoint: ./check.js\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skills-check', 'check.js'), `console.log('not-json');\n`, 'utf8');

    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: invalid-json-skill\ndescription: invalid checker\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: ../skills-check\n      required: true\n`,
      'utf8',
    );

    const report = await doctor(join(dir, 'skill'));

    assert.equal(report.readinessStatus, 'ok');
    assert.equal(report.overall, 'ok');
    assert.equal(report.trustStatus, 'warning');
    assert.equal(report.overallStatus, 'warning');
    assert.equal(report.trustReport?.findings[0].provider, 'skills-check');
    assert.match(report.trustReport?.findings[0].message ?? '', /invalid JSON/i);
  });
});


test('doctor supports single-file SKILL.md with trust and readiness', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skills-check'), { recursive: true });
    await writeFile(
      join(dir, 'skills-check', 'skill.yaml'),
      `name: skills-check
description: checker
version: 1.0.0
entrypoint: ./check.js
`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skills-check', 'check.js'),
      `console.log(JSON.stringify({ findings: [{ name: 'safe', status: 'warning', message: 'Review recommended' }] }));
`,
      'utf8',
    );

    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'SKILL.md'),
      `---
name: doctor-single-file
description: doctor single
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

# Doctor Single File
`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');

    const report = await doctor(join(dir, 'skill'));

    assert.equal(report.manifestPath, join(dir, 'skill', 'SKILL.md'));
    assert.equal(report.readinessStatus, 'ok');
    assert.equal(report.trustStatus, 'warning');
    assert.equal(report.overall, 'ok');
  });
});

test('doctor reports duplicate document warning when SKILL.md and yaml coexist', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'SKILL.md'),
      `---
name: duplicate-doc-skill
description: duplicate
version: 1.0.0
entrypoint: ./run.sh
---

# Duplicate
`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'skill.yaml'), `name: legacy
description: legacy
version: 0.1.0
`, 'utf8');
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');

    const report = await doctor(join(dir, 'skill'));

    assert.equal(report.readinessStatus, 'warning');
    assert.equal(report.overall, 'warning');
    assert.equal(report.warnings?.length, 1);
    assert.equal(report.warnings?.[0].code, 'duplicate_primary_doc');
    assert.equal(report.checks.some((item) => item.name === 'duplicate_primary_doc'), false);
  });
});
