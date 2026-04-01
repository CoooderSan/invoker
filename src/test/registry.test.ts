import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-registry-'));
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

test('listSkills refresh stores last status summary and paths', async () => {
  await withTempDir(async (dir) => {
    const skillsRoot = join(dir, '.invoker', 'skills', 'sample-skill');
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(
      join(skillsRoot, 'skill.yaml'),
      `name: sample-skill\ndescription: sample\nversion: 1.0.0\nrequires:\n  env:\n    - name: Base URL\n      envVar: BASE_URL\n      defaultValue: https://example.com\n`,
      'utf8',
    );
    await writeFile(
      join(skillsRoot, 'invoker.skill.yaml'),
      `requires:\n  resources:\n    - name: tpl\n      path: ./templates/review.md\n      template: |\n        # Review\n`,
      'utf8',
    );

    const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
    const skills = await registryModule.listSkills(true);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'sample-skill');
    assert.ok(skills[0].manifestPath?.endsWith('skill.yaml'));
    assert.ok(skills[0].sidecarPath?.endsWith('invoker.skill.yaml'));
    assert.ok(typeof skills[0].lastStatusSummary === 'string');
    assert.ok(skills[0].lastDoctorAt);
  });
});

test('listSkills returns empty array when no skills are installed', async () => {
  await withTempDir(async (dir) => {
    // HOME points to dir but no .invoker/skills directory exists
    const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
    const skills = await registryModule.listSkills(false);
    assert.deepEqual(skills, []);
  });
});

test('registerSkillFromPath adds skill to registry and can be retrieved', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, '.invoker'), { recursive: true });
    await mkdir(join(dir, 'my-skill'));
    await writeFile(
      join(dir, 'my-skill', 'skill.yaml'),
      `name: my-skill\ndescription: my skill\nversion: 2.0.0\n`,
      'utf8',
    );

    const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
    const entry = await registryModule.registerSkillFromPath(join(dir, 'my-skill'));

    assert.equal(entry.name, 'my-skill');
    assert.equal(entry.version, '2.0.0');
    assert.equal(entry.path, join(dir, 'my-skill'));

    const registry = await registryModule.loadRegistry();
    assert.equal(registry.skills.length, 1);
    assert.equal(registry.skills[0].name, 'my-skill');
  });
});

test('registerSkillFromPath updates existing entry on re-register', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, '.invoker'), { recursive: true });
    await mkdir(join(dir, 'my-skill'));
    await writeFile(
      join(dir, 'my-skill', 'skill.yaml'),
      `name: my-skill\ndescription: my skill\nversion: 1.0.0\n`,
      'utf8',
    );

    const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
    await registryModule.registerSkillFromPath(join(dir, 'my-skill'));

    // update version and re-register
    await writeFile(
      join(dir, 'my-skill', 'skill.yaml'),
      `name: my-skill\ndescription: my skill\nversion: 1.1.0\n`,
      'utf8',
    );
    await registryModule.registerSkillFromPath(join(dir, 'my-skill'));

    const registry = await registryModule.loadRegistry();
    assert.equal(registry.skills.length, 1, 'should not duplicate');
    assert.equal(registry.skills[0].version, '1.1.0');
  });
});

test('registerDependentSkill registers pathless dependency from same host target', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      const claudeRoot = join(dir, 'runtime', 'claude', 'skills');
      const parentDir = join(claudeRoot, 'parent-skill');
      const depDir = join(claudeRoot, 'dep-skill');
      await mkdir(parentDir, { recursive: true });
      await mkdir(depDir, { recursive: true });
      await writeFile(join(parentDir, 'skill.yaml'), `name: parent-skill\ndescription: parent\nversion: 1.0.0\n`, 'utf8');
      await writeFile(join(depDir, 'skill.yaml'), `name: dep-skill\ndescription: dep\nversion: 2.0.0\n`, 'utf8');

      const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
      const entry = await registryModule.registerDependentSkill({ name: 'dep-skill' }, parentDir, {
        target: 'claude',
        targetRoot: claudeRoot,
      });

      assert.equal(entry.name, 'dep-skill');
      assert.equal(entry.target, 'claude');
      assert.equal(entry.path, depDir);

      const registry = await registryModule.loadRegistry();
      assert.equal(registry.skills.length, 1);
      assert.equal(registry.skills[0].target, 'claude');
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});


test('listSkills respects explicit host root over default root', async () => {
  await withTempDir(async (dir) => {
    const defaultClaudeRoot = join(dir, '.claude', 'skills');
    const overrideClaudeRoot = join(dir, 'runtime', 'claude', 'skills');
    await mkdir(join(defaultClaudeRoot, 'default-skill'), { recursive: true });
    await mkdir(join(overrideClaudeRoot, 'override-skill'), { recursive: true });
    await writeFile(
      join(defaultClaudeRoot, 'default-skill', 'skill.yaml'),
      `name: default-skill\ndescription: default\nversion: 1.0.0\n`,
      'utf8',
    );
    await writeFile(
      join(overrideClaudeRoot, 'override-skill', 'skill.yaml'),
      `name: override-skill\ndescription: override\nversion: 1.0.0\n`,
      'utf8',
    );

    const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
    const skills = await registryModule.listSkills(false, { target: 'claude', targetRoot: overrideClaudeRoot });

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'override-skill');
    assert.equal(skills[0].target, 'claude');
    assert.equal(skills[0].targetRoot, overrideClaudeRoot);
  });
});

test('listSkills falls back to configured host root when override is absent', async () => {
  await withTempDir(async (dir) => {
    const configuredClaudeRoot = join(dir, 'runtime', 'claude', 'skills');
    await mkdir(join(dir, '.invoker'), { recursive: true });
    await writeFile(
      join(dir, '.invoker', 'config.json'),
      JSON.stringify({ hosts: { claude: { root: configuredClaudeRoot } } }, null, 2),
      'utf8',
    );
    await mkdir(join(configuredClaudeRoot, 'configured-skill'), { recursive: true });
    await writeFile(
      join(configuredClaudeRoot, 'configured-skill', 'skill.yaml'),
      `name: configured-skill\ndescription: configured\nversion: 1.0.0\n`,
      'utf8',
    );

    const registryModule = await import(`../core/registry.js?case=${Date.now()}`);
    const skills = await registryModule.listSkills(false, { target: 'claude' });

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'configured-skill');
    assert.equal(skills[0].target, 'claude');
    assert.equal(skills[0].targetRoot, configuredClaudeRoot);
  });
});
