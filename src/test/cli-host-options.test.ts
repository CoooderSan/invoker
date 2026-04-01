import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfiguredHostRoots, getEffectiveHostRoot, setHostRoot } from '../core/host-config.js';

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

test('host config falls back to default roots when no config exists', async () => {
  await withTempDir(async (dir) => {
    const roots = await getConfiguredHostRoots();

    assert.equal(roots.claude, join(dir, '.claude', 'skills'));
    assert.equal(roots.codex, join(dir, '.codex', 'skills'));
    assert.equal(roots.invoker, join(dir, '.invoker', 'skills'));
  });
});

test('host config uses configured root when present', async () => {
  await withTempDir(async (dir) => {
    const configuredRoot = join(dir, 'runtime', 'claude', 'skills');
    await mkdir(join(dir, '.invoker'), { recursive: true });
    await setHostRoot('claude', configuredRoot);

    const roots = await getConfiguredHostRoots();
    const effectiveRoot = await getEffectiveHostRoot('claude');

    assert.equal(roots.claude, configuredRoot);
    assert.equal(effectiveRoot, configuredRoot);
  });
});

test('host config override takes precedence over configured root', async () => {
  await withTempDir(async (dir) => {
    const configuredRoot = join(dir, 'runtime', 'claude', 'skills');
    const overrideRoot = join(dir, 'override', 'claude', 'skills');
    await mkdir(join(dir, '.invoker'), { recursive: true });
    await setHostRoot('claude', configuredRoot);

    const effectiveRoot = await getEffectiveHostRoot('claude', overrideRoot);

    assert.equal(effectiveRoot, overrideRoot);
  });
});
