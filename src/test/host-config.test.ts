import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../bin/invoker.js', import.meta.url));

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-host-config-'));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = dir;
    await run(dir);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCli(home: string, args: string[]) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, HOME: home },
  });
}

test('getConfiguredHostRoots falls back to built-in defaults', async () => {
  await withTempDir(async (dir) => {
    const hostConfig = await import(`../core/host-config.js?case=${Date.now()}`);
    const roots = await hostConfig.getConfiguredHostRoots();

    assert.equal(roots.invoker, join(dir, '.invoker', 'skills'));
    assert.equal(roots.claude, join(dir, '.claude', 'skills'));
    assert.equal(roots.codex, join(dir, '.codex', 'skills'));
    assert.equal(roots.unknown, undefined);
  });
});

test('hosts set persists config and hosts list reflects the configured root', async () => {
  await withTempDir(async (dir) => {
    const customRoot = join(dir, 'custom', 'claude-skills');
    await mkdir(customRoot, { recursive: true });

    await runCli(dir, ['hosts', 'set', 'claude', customRoot]);
    const configContent = await readFile(join(dir, '.invoker', 'config.json'), 'utf8');
    assert.match(configContent, /claude/);
    assert.match(configContent, /claude-skills/);

    const { stdout } = await runCli(dir, ['hosts', 'list']);
    assert.match(stdout, /claude/);
    assert.match(stdout, /customized:\s+yes/);
    assert.match(stdout, /claude-skills/);
  });
});

test('hosts unset removes persisted override and list falls back to default root', async () => {
  await withTempDir(async (dir) => {
    const customRoot = join(dir, 'custom', 'claude-skills');
    await mkdir(customRoot, { recursive: true });
    await runCli(dir, ['hosts', 'set', 'claude', customRoot]);

    await runCli(dir, ['hosts', 'unset', 'claude']);
    const configContent = await readFile(join(dir, '.invoker', 'config.json'), 'utf8');
    assert.doesNotMatch(configContent, /claude-skills/);

    const { stdout } = await runCli(dir, ['hosts', 'list']);
    assert.match(stdout, /claude/);
    assert.match(stdout, /customized:\s+no/);
    assert.match(stdout, new RegExp(join(dir, '.claude', 'skills').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('doctor --json outputs parseable trust report without log noise', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skills-check'), { recursive: true });
    await writeFile(
      join(dir, 'skills-check', 'skill.yaml'),
      `name: skills-check\ndescription: checker\nversion: 1.0.0\nentrypoint: ./check.js\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skills-check', 'check.js'),
      `console.log(JSON.stringify({ findings: [{ name: 'unsafe-pattern', status: 'warning', message: 'Potential issue detected' }] }));\n`,
      'utf8',
    );

    await mkdir(join(dir, 'skill'), { recursive: true });
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: json-doctor-skill\ndescription: json doctor\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: ../skills-check\n      required: true\n`,
      'utf8',
    );

    const { stdout, stderr } = await runCli(dir, ['doctor', join(dir, 'skill'), '--json']);
    assert.equal(stderr, '');

    const report = JSON.parse(stdout);
    assert.equal(report.skillName, 'json-doctor-skill');
    assert.equal(report.primaryDocFormat, 'yaml');
    assert.ok(report.primaryDocPath.endsWith('skill.yaml'));
    assert.equal(report.warnings[0].code, 'legacy_yaml');
    assert.equal(report.readinessStatus, 'warning');
    assert.equal(report.trustStatus, 'warning');
    assert.equal(report.overall, 'warning');
    assert.equal(report.overallStatus, 'warning');
    assert.equal(report.trustReport.providers[0].name, 'skills-check');
    assert.equal(report.trustReport.providers[0].status, 'warning');
  });
});

test('info --json nests doctor trust report without log noise', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skills-check'), { recursive: true });
    await writeFile(
      join(dir, 'skills-check', 'skill.yaml'),
      `name: skills-check\ndescription: checker\nversion: 1.0.0\nentrypoint: ./check.js\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'skills-check', 'check.js'),
      `console.log(JSON.stringify({ findings: [{ name: 'unsafe-pattern', status: 'error', ruleId: 'SC001', message: 'Unsafe pattern detected' }] }));\n`,
      'utf8',
    );

    await mkdir(join(dir, 'skill'), { recursive: true });
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: json-info-skill\ndescription: json info\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(dir, 'skill', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await writeFile(
      join(dir, 'skill', 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: ../skills-check\n      required: true\n`,
      'utf8',
    );

    const { stdout, stderr } = await runCli(dir, ['info', join(dir, 'skill'), '--json']);
    assert.equal(stderr, '');

    const info = JSON.parse(stdout);
    assert.equal(info.manifest.name, 'json-info-skill');
    assert.equal(info.primaryDocFormat, 'yaml');
    assert.ok(info.primaryDocPath.endsWith('skill.yaml'));
    assert.equal(info.warnings[0].code, 'legacy_yaml');
    assert.equal(info.doctorReport.readinessStatus, 'warning');
    assert.equal(info.doctorReport.trustStatus, 'error');
    assert.equal(info.doctorReport.overallStatus, 'error');
    assert.equal(info.doctorReport.trustReport.findings[0].provider, 'skills-check');
    assert.equal(info.doctorReport.trustReport.findings[0].ruleId, 'SC001');
  });
});

test('list --refresh --json returns trust summary without log noise', async () => {
  await withTempDir(async (dir) => {
    const skillsRoot = join(dir, '.invoker', 'skills');
    const checkerDir = join(skillsRoot, 'skills-check');
    const sampleDir = join(skillsRoot, 'sample-skill');
    await mkdir(checkerDir, { recursive: true });
    await mkdir(sampleDir, { recursive: true });

    await writeFile(
      join(checkerDir, 'skill.yaml'),
      `name: skills-check\ndescription: checker\nversion: 1.0.0\nentrypoint: ./check.js\n`,
      'utf8',
    );
    await writeFile(
      join(checkerDir, 'check.js'),
      `console.log(JSON.stringify({ findings: [{ name: 'unsafe-pattern', status: 'error', message: 'Unsafe pattern detected' }] }));\n`,
      'utf8',
    );

    await writeFile(
      join(sampleDir, 'skill.yaml'),
      `name: sample-skill\ndescription: sample\nversion: 1.0.0\nentrypoint: ./run.sh\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(join(sampleDir, 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
    await writeFile(
      join(sampleDir, 'invoker.skill.yaml'),
      `trust:\n  checkers:\n    - name: skills-check\n      skill: skills-check\n      required: true\n`,
      'utf8',
    );

    const { stdout, stderr } = await runCli(dir, ['list', '--refresh', '--json']);
    assert.equal(stderr, '');

    const skills = JSON.parse(stdout);
    const sample = skills.find((item: { name: string }) => item.name === 'sample-skill');
    assert.ok(sample);
    assert.ok(sample.primaryDocPath.endsWith('skill.yaml'));
    assert.equal(sample.primaryDocFormat, 'yaml');
    assert.equal(sample.warnings[0].code, 'legacy_yaml');
    assert.equal(sample.status, 'warning');
    assert.equal(sample.readinessStatus, 'warning');
    assert.equal(sample.trustStatus, 'error');
    assert.equal(sample.overallStatus, 'error');
  });
});
