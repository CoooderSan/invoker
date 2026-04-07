#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

const root = process.cwd();
const cliPath = resolve(root, 'dist/bin/invoker.js');
const tempDir = mkdtempSync(join(tmpdir(), 'invoker-release-smoke-'));
const linkPath = join(tempDir, 'invoker');

try {
  symlinkSync(cliPath, linkPath);

  const version = run('node', [linkPath, '--version']).trim();
  if (version !== '0.1.3') {
    throw new Error(`Expected invoker --version to output 0.1.3, got ${JSON.stringify(version)}`);
  }

  const listOutput = run('node', [linkPath, 'list', '--json'], {
    env: { ...process.env, HOME: tempDir },
  }).trim();

  JSON.parse(listOutput);

  console.log('release smoke ok');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
