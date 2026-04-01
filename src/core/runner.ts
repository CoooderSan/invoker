import { resolve } from 'node:path';
import { run } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { scan } from './scanner.js';
import { doctor, formatDoctorSummary } from './doctor.js';
import type { ScanOptions } from '../types.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a skill's entrypoint script.
 * Checks doctor first to ensure environment is ready.
 */
export async function runSkill(
  skillPathOrName: string,
  args: string[] = [],
  skipDoctor = false,
  options: ScanOptions = {},
): Promise<RunResult> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, dir, effectiveRequires, target } = normalized;

  if (!manifest.entrypoint) {
    throw new Error(`Skill "${manifest.name}" has no entrypoint defined`);
  }

  if (!skipDoctor) {
    const report = await doctor(skillPathOrName, options);
    if (report.overall === 'error') {
      const errors = report.checks.filter((c) => c.status === 'error');
      const errorMessages = errors.map((e) => `  - [${e.category}] ${e.name}: ${e.message}`).join('\n');
      const hasCliIssue = errors.some((e) => e.category === 'cli');
      const hostSuffix = target !== 'unknown' ? ` --host ${target}` : '';
      const nextStep = hasCliIssue
        ? `Run \"invoker install --dry-run ${manifest.name}${hostSuffix}\" to preview missing dependencies, then \"invoker install ${manifest.name}${hostSuffix}\" or \"invoker fix ${manifest.name}${hostSuffix}\".`
        : `Run \"invoker doctor ${manifest.name}${hostSuffix}\" to inspect configuration/authentication gaps, then follow with \"invoker install --dry-run ${manifest.name}${hostSuffix}\" or \"invoker fix ${manifest.name}${hostSuffix}\".`;

      throw new Error(
        `Skill "${manifest.name}" is not runnable yet (${formatDoctorSummary(report)}):\n${errorMessages}\n\n${nextStep}`,
      );
    }
    if (report.overall === 'warning') {
      logger.warn(`Skill "${manifest.name}" has warnings (${formatDoctorSummary(report)}), but proceeding...`);
    }
  }

  const entrypoint = resolve(dir, manifest.entrypoint);
  logger.info(`Running "${manifest.name}" (${entrypoint})...`);

  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  if (effectiveRequires?.env) {
    for (const e of effectiveRequires.env) {
      if (!env[e.envVar] && e.defaultValue) {
        env[e.envVar] = e.defaultValue;
      }
    }
  }

  const ext = entrypoint.split('.').pop()?.toLowerCase();
  let command: string;
  let cmdArgs: string[];

  switch (ext) {
    case 'js':
    case 'mjs':
      command = 'node';
      cmdArgs = [entrypoint, ...args];
      break;
    case 'ts':
      command = 'npx';
      cmdArgs = ['tsx', entrypoint, ...args];
      break;
    case 'py':
      command = 'python3';
      cmdArgs = [entrypoint, ...args];
      break;
    case 'sh':
      command = '/bin/sh';
      cmdArgs = [entrypoint, ...args];
      break;
    default:
      command = entrypoint;
      cmdArgs = args;
  }

  const result = await run(command, cmdArgs, dir, env);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
