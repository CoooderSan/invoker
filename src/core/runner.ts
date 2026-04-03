import { resolve } from 'node:path';
import { run } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { scan } from './scanner.js';
import { doctor, formatDoctorSummary } from './doctor.js';
import type { NormalizedSkill, ScanOptions } from '../types.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface EntrypointCommandSpec {
  command: string;
  args: string[];
  entrypoint: string;
}

export function resolveEntrypointCommand(normalized: NormalizedSkill, args: string[] = []): EntrypointCommandSpec {
  const { manifest, dir } = normalized;
  if (!manifest.entrypoint) {
    throw new Error(`Skill "${manifest.name}" has no entrypoint defined`);
  }

  const entrypoint = resolve(dir, manifest.entrypoint);
  const ext = entrypoint.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'js':
    case 'mjs':
      return { command: 'node', args: [entrypoint, ...args], entrypoint };
    case 'ts':
      return { command: 'npx', args: ['tsx', entrypoint, ...args], entrypoint };
    case 'py':
      return { command: 'python3', args: [entrypoint, ...args], entrypoint };
    case 'sh':
      return { command: '/bin/sh', args: [entrypoint, ...args], entrypoint };
    default:
      return { command: entrypoint, args, entrypoint };
  }
}

export async function executeSkillEntrypoint(
  normalized: NormalizedSkill,
  args: string[] = [],
  envOverrides?: Record<string, string>,
): Promise<RunResult> {
  const { effectiveRequires, dir } = normalized;
  const commandSpec = resolveEntrypointCommand(normalized, args);

  const env: Record<string, string> = { ...process.env, ...envOverrides } as Record<string, string>;
  if (effectiveRequires?.env) {
    for (const e of effectiveRequires.env) {
      if (!env[e.envVar] && e.defaultValue) {
        env[e.envVar] = e.defaultValue;
      }
    }
  }

  const result = await run(commandSpec.command, commandSpec.args, dir, env);

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
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
  const { manifest, target } = normalized;

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
        ? `Run \"invoker doctor ${manifest.name}${hostSuffix}\" to inspect readiness gaps, then resolve the reported blocking issues before running again.`
        : `Run \"invoker doctor ${manifest.name}${hostSuffix}\" to inspect configuration, host settings, or permissions gaps before running again.`;

      throw new Error(
        `Skill "${manifest.name}" is not runnable yet (${formatDoctorSummary(report)}):\n${errorMessages}\n\n${nextStep}`,
      );
    }
    if (report.overall === 'warning') {
      logger.warn(`Skill "${manifest.name}" has warnings (${formatDoctorSummary(report)}), but proceeding...`);
    }
    if (report.trustStatus === 'warning' || report.trustStatus === 'error') {
      logger.warn(
        `Skill "${manifest.name}" has trust ${report.trustStatus} (${report.trustReport?.summary?.total ?? report.trustReport?.findings.length ?? 0} finding(s)), but proceeding...`,
      );
    }
  }

  const commandSpec = resolveEntrypointCommand(normalized, args);
  logger.info(`Running "${manifest.name}" (${commandSpec.entrypoint})...`);

  const result = await executeSkillEntrypoint(normalized, args);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);

  return result;
}
