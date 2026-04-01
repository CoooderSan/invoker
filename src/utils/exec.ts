import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function run(
  command: string,
  args: string[] = [],
  cwd?: string,
  envOverrides?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout: 60_000,
      env: { ...process.env, ...envOverrides },
    });
    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      exitCode: 0,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: (e.stdout ?? '').toString().trim(),
      stderr: (e.stderr ?? '').toString().trim(),
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export async function runShell(command: string, cwd?: string): Promise<ExecResult> {
  const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh';
  const shellArg = process.platform === 'win32' ? '/c' : '-c';
  return run(shell, [shellArg, command], cwd);
}
