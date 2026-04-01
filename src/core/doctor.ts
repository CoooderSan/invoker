import which from 'which';
import semver from 'semver';
import chalk from 'chalk';
import { run } from '../utils/exec.js';
import { fileExists, resolveRequirementPath } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { hasRequirements, scan } from './scanner.js';
import type {
  CheckResult,
  CheckStatus,
  DoctorReport,
  DoctorSummary,
  CliRequirement,
  TokenRequirement,
  EnvRequirement,
  ResourceRequirement,
  SkillDependencyRequirement,
  ScanOptions,
} from '../types.js';

// === Public API ===

export async function doctor(skillPathOrName: string, options: ScanOptions = {}): Promise<DoctorReport> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, effectiveRequires, manifestPath, sidecarPath, dir, target, targetRoot } = normalized;
  const checks: CheckResult[] = [];
  const requirementsDeclared = hasRequirements(effectiveRequires);

  if (!requirementsDeclared && manifest.entrypoint) {
    checks.push({
      name: 'requires',
      category: 'manifest',
      status: 'warning',
      message: 'Skill does not declare any requires, so Invoker can only do limited validation',
      detail: 'Add requires to skill.yaml or invoker.skill.yaml to improve doctor/install/fix coverage.',
      source: 'derived',
      severity: 'non_blocking',
      remediation: 'Declare requires in skill.yaml or invoker.skill.yaml',
    });
  }

  if (effectiveRequires?.cli) {
    for (const cli of effectiveRequires.cli) {
      checks.push(await checkCli(cli));
    }
  }

  if (effectiveRequires?.tokens) {
    for (const token of effectiveRequires.tokens) {
      checks.push(checkToken(token));
    }
  }

  if (effectiveRequires?.env) {
    for (const env of effectiveRequires.env) {
      checks.push(checkEnv(env));
    }
  }

  if (effectiveRequires?.resources) {
    for (const resource of effectiveRequires.resources) {
      checks.push(await checkResource(resource, dir));
    }
  }

  if (effectiveRequires?.skills) {
    for (const skill of effectiveRequires.skills) {
      checks.push(await checkSkillDependency(skill, dir, { target, targetRoot }));
    }
  }

  const overall = deriveOverall(checks);
  const summary = summarizeChecks(checks);

  return {
    skillName: manifest.name,
    manifestPath,
    sidecarPath,
    timestamp: new Date().toISOString(),
    overall,
    summary,
    requirementsDeclared,
    checks,
  };
}

export function printReport(report: DoctorReport): void {
  logger.blank();
  logger.heading(`Doctor Report: ${report.skillName}`);
  console.log(`  ${chalk.gray('Manifest:')} ${report.manifestPath}`);
  if (report.sidecarPath) {
    console.log(`  ${chalk.gray('Sidecar:')}  ${report.sidecarPath}`);
  }
  logger.blank();

  const statusIcon = (s: CheckStatus) =>
    s === 'ok' ? chalk.green('✔') : s === 'warning' ? chalk.yellow('⚠') : chalk.red('✖');

  for (const check of report.checks) {
    const icon = statusIcon(check.status);
    const fixHint = check.fixable ? chalk.gray(` (fixable${check.fixCommand ? `: ${check.fixCommand}` : ''})`) : '';
    const sourceHint = check.source ? chalk.gray(` [source: ${check.source}]`) : '';
    console.log(`  ${icon} [${check.category}] ${check.name}: ${check.message}${fixHint}${sourceHint}`);
    if (check.detail) {
      console.log(`    ${chalk.gray(check.detail)}`);
    }
    if (check.remediation && !check.fixCommand) {
      console.log(`    ${chalk.gray(`Next step: ${check.remediation}`)}`);
    }
  }

  logger.blank();
  const overallIcon = statusIcon(report.overall);
  console.log(`  Summary: ${chalk.gray(formatDoctorSummary(report))}`);
  console.log(`  Overall: ${overallIcon} ${report.overall.toUpperCase()}`);
  logger.blank();
}

export function formatDoctorSummary(report: DoctorReport): string {
  const { error, warning } = report.summary;
  if (error > 0 && warning > 0) {
    return `${error} error${error > 1 ? 's' : ''}, ${warning} warning${warning > 1 ? 's' : ''}`;
  }
  if (error > 0) {
    return `${error} error${error > 1 ? 's' : ''}`;
  }
  if (warning > 0) {
    return `${warning} warning${warning > 1 ? 's' : ''}`;
  }
  return 'ready';
}

// === CLI checks ===

async function checkCli(req: CliRequirement): Promise<CheckResult> {
  const cmd = req.command ?? req.name;

  let resolvedPath: string;
  try {
    resolvedPath = await which(cmd);
  } catch {
    return {
      name: req.name,
      category: 'cli',
      status: 'error',
      message: `Missing dependency: CLI "${cmd}" is not installed`,
      detail: req.installHint ?? `Install "${cmd}" and make sure it is on your PATH.`,
      fixable: !!req.installCommand,
      fixCommand: req.installCommand,
      source: req.source,
      severity: 'blocking',
      remediation: req.installCommand ? `Run ${req.installCommand}` : `Install ${cmd} and re-run doctor`,
      expectedValue: req.minVersion,
    };
  }

  if (req.minVersion && req.versionCommand) {
    const result = await run('/bin/sh', ['-c', req.versionCommand]);
    const output = result.stdout || result.stderr;
    let detectedVersion: string | null = null;

    if (req.versionPattern) {
      const match = output.match(new RegExp(req.versionPattern));
      detectedVersion = match?.[1] ?? null;
    } else {
      const match = output.match(/(\d+\.\d+\.\d+)/);
      detectedVersion = match?.[1] ?? null;
    }

    if (!detectedVersion) {
      return {
        name: req.name,
        category: 'cli',
        status: 'warning',
        message: `Dependency found, but version for CLI "${cmd}" could not be detected`,
        detail: `Version output: ${output.slice(0, 200)}`,
        source: req.source,
        severity: 'non_blocking',
        remediation: 'Verify the installed CLI version manually',
      };
    }

    if (!semver.gte(detectedVersion, req.minVersion)) {
      return {
        name: req.name,
        category: 'cli',
        status: 'error',
        message: `CLI "${cmd}" version ${detectedVersion} is below required ${req.minVersion}`,
        detail: req.installHint,
        fixable: !!req.installCommand,
        fixCommand: req.installCommand,
        source: req.source,
        severity: 'blocking',
        remediation: req.installCommand ? `Run ${req.installCommand}` : `Upgrade ${cmd} to ${req.minVersion} or newer`,
        detectedValue: detectedVersion,
        expectedValue: req.minVersion,
      };
    }

    return {
      name: req.name,
      category: 'cli',
      status: 'ok',
      message: `Dependency ready: CLI "${cmd}" v${detectedVersion}`,
      source: req.source,
      severity: 'non_blocking',
      detectedValue: detectedVersion,
      expectedValue: req.minVersion,
    };
  }

  return {
    name: req.name,
    category: 'cli',
    status: 'ok',
    message: `Dependency ready: CLI "${cmd}" found at ${resolvedPath}`,
    source: req.source,
    severity: 'non_blocking',
    detectedValue: resolvedPath,
  };
}

// === Token checks ===

function checkToken(req: TokenRequirement): CheckResult {
  const envVar = req.envVar ?? req.name;
  const value = process.env[envVar];
  const required = req.required !== false;

  if (!value) {
    return {
      name: req.name,
      category: 'token',
      status: required ? 'error' : 'warning',
      message: `Authentication not configured for "${req.name}" (env: ${envVar})`,
      detail: req.description,
      fixable: false,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      remediation: `Set ${envVar} before running the skill`,
      expectedValue: envVar,
    };
  }

  return {
    name: req.name,
    category: 'token',
    status: 'ok',
    message: `Authentication configured for "${req.name}" (env: ${envVar})`,
    source: req.source,
    severity: 'non_blocking',
    detectedValue: envVar,
  };
}

// === Env checks ===

function checkEnv(req: EnvRequirement): CheckResult {
  const value = process.env[req.envVar];
  const required = req.required !== false;

  if (!value && !req.defaultValue) {
    return {
      name: req.name,
      category: 'env',
      status: required ? 'error' : 'warning',
      message: `Configuration missing: env var "${req.envVar}" is not set`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      remediation: `Set ${req.envVar} before running the skill`,
      expectedValue: req.envVar,
    };
  }

  return {
    name: req.name,
    category: 'env',
    status: 'ok',
    message: value
      ? `Configuration ready: env var "${req.envVar}" is set`
      : `Configuration ready: env var "${req.envVar}" will use default value`,
    source: req.source,
    severity: 'non_blocking',
    detectedValue: value ?? req.defaultValue,
    expectedValue: req.defaultValue,
  };
}

// === Resource checks ===

async function checkResource(req: ResourceRequirement, skillDir: string): Promise<CheckResult> {
  if (!req.path) {
    return {
      name: req.name,
      category: 'resource',
      status: 'ok',
      message: `Configuration resource "${req.name}" has no path requirement`,
      source: req.source,
      severity: 'non_blocking',
    };
  }

  const resolvedPath = resolveRequirementPath(req.path, skillDir);
  const exists = await fileExists(resolvedPath);
  if (!exists) {
    return {
      name: req.name,
      category: 'resource',
      status: 'error',
      message: `Configuration missing: resource "${req.name}" not found`,
      detail: `Expected at ${resolvedPath}${req.description ? ` — ${req.description}` : ''}`,
      fixable: !!(req.template || req.templateUrl),
      source: req.source,
      severity: 'blocking',
      remediation: req.template || req.templateUrl ? 'Run invoker fix to materialize the resource' : `Create ${resolvedPath}`,
      expectedValue: resolvedPath,
    };
  }

  return {
    name: req.name,
    category: 'resource',
    status: 'ok',
    message: `Configuration ready: resource "${req.name}" exists at ${resolvedPath}`,
    source: req.source,
    severity: 'non_blocking',
    detectedValue: resolvedPath,
  };
}

async function checkSkillDependency(
  req: SkillDependencyRequirement,
  skillDir: string,
  options: ScanOptions = {},
): Promise<CheckResult> {
  try {
    const target = req.path ? resolveRequirementPath(req.path, skillDir) : req.name;
    const normalized = await scan(target, options);
    return {
      name: req.name,
      category: 'skill',
      status: 'ok',
      message: `Dependent skill "${req.name}" is available at ${normalized.dir}`,
      source: req.source,
      severity: 'non_blocking',
      detectedValue: normalized.dir,
    };
  } catch {
    const required = req.required !== false;
    return {
      name: req.name,
      category: 'skill',
      status: required ? 'error' : 'warning',
      message: `Dependent skill "${req.name}" is not available`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      remediation: req.path
        ? `Run invoker install <parent-skill>${options.target ? ` --host ${options.target}` : ''} to register the local dependent skill at ${req.path}`
        : `Place skill ${req.name} in host ${options.target ?? 'current'} root or provide requires.skills[].path, then re-run install`,
      expectedValue: req.path ?? req.name,
      suggestedSkillPath: req.path ? resolveRequirementPath(req.path, skillDir) : undefined,
      suggestedTarget: options.target,
      suggestedTargetRoot: options.targetRoot,
    };
  }
}

// === Helpers ===

function summarizeChecks(checks: CheckResult[]): DoctorSummary {
  return {
    total: checks.length,
    ok: checks.filter((c) => c.status === 'ok').length,
    warning: checks.filter((c) => c.status === 'warning').length,
    error: checks.filter((c) => c.status === 'error').length,
    blocking: checks.filter((c) => c.severity === 'blocking' && c.status !== 'ok').length,
  };
}

function deriveOverall(checks: CheckResult[]): CheckStatus {
  if (checks.some((c) => c.status === 'error')) return 'error';
  if (checks.some((c) => c.status === 'warning')) return 'warning';
  return 'ok';
}
