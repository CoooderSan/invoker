import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntrypoint } from '../bin/invoker.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'invoker-bin-entry-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('isCliEntrypoint returns true for the real built CLI path', () => {
  const cliPath = fileURLToPath(new URL('../bin/invoker.js', import.meta.url));
  assert.equal(isCliEntrypoint(cliPath), true);
});

test('isCliEntrypoint returns true for a symlink to the built CLI path', async () => {
  await withTempDir(async (dir) => {
    const cliPath = fileURLToPath(new URL('../bin/invoker.js', import.meta.url));
    const linkPath = join(dir, 'invoker');
    await symlink(cliPath, linkPath);
    assert.equal(isCliEntrypoint(linkPath), true);
  });
});
