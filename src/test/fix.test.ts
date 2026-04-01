import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix } from '../core/fixer.js';
import { loadRegistry } from '../core/registry.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-fix-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('fix materializes missing resource from template', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'skill'));
    await writeFile(
      join(dir, 'skill', 'skill.yaml'),
      `name: fixable-skill\ndescription: fixable\nversion: 1.0.0\nrequires:\n  resources:\n    - name: template\n      path: ./templates/review.md\n      template: |\n        # Review\n        \n        Body\n`,
      'utf8',
    );

    const result = await fix(join(dir, 'skill'));
    const target = join(dir, 'skill', 'templates', 'review.md');
    const content = await readFile(target, 'utf8');

    assert.ok(result.fixed.includes('template'));
    assert.match(content, /# Review/);
  });
});

test('fix registers pathless dependent skill already present in same host root', async () => {
  await withTempDir(async (dir) => {
    const previousHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      await mkdir(join(dir, '.invoker'), { recursive: true });
      const claudeRoot = join(dir, 'runtime', 'claude', 'skills');
      const parentDir = join(claudeRoot, 'parent-skill');
      const childDir = join(claudeRoot, 'child-skill');
      await mkdir(parentDir, { recursive: true });
      await mkdir(childDir, { recursive: true });
      await writeFile(join(childDir, 'skill.yaml'), `name: child-skill\ndescription: child\nversion: 1.0.0\n`, 'utf8');
      await writeFile(
        join(parentDir, 'skill.yaml'),
        `name: parent-skill\ndescription: parent\nversion: 1.0.0\nrequires:\n  skills:\n    - name: child-skill\n`,
        'utf8',
      );

      const result = await fix('parent-skill', { target: 'claude', targetRoot: claudeRoot });
      const registry = await loadRegistry();

      assert.ok(result.fixed.includes('child-skill'));
      assert.ok(registry.skills.some((entry) => entry.name === 'child-skill' && entry.target === 'claude'));
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});
