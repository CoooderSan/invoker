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
