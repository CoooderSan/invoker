import which from 'which';
import semver from 'semver';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { run } from '../utils/exec.js';
import { fileExists, readTextFile, resolveRequirementPath } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { getInvokerConfigPath, getEffectiveHostRoot } from './host-config.js';
import { hasRequirements, scan } from './scanner.js';
import { buildTrustReport } from './trust.js';
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
  SettingRequirement,
  HostConfigRequirement,
  ProblemFinding,
  DependencyFinding,
  RemediationAction,
  ReadinessReport,
  RuntimeTarget,
  ScanOptions,
  TrustReport,
} from '../types.js';

// === Public API ===

export async function doctor(skillPathOrName: string, options: ScanOptions = {}): Promise<DoctorReport> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, effectiveRequires, manifestPath, sidecarPath, primaryDocPath, primaryDocFormat, warnings, dir, target, targetRoot } = normalized;
  const checks: CheckResult[] = [];
  const requirementsDeclared = hasRequirements(effectiveRequires);

  if (!requirementsDeclared && manifest.entrypoint) {
    checks.push({
      name: 'requires',
      category: 'manifest',
      status: 'warning',
      message: 'Skill does not declare any requires, so Invoker can only do limited validation',
      detail: 'Add requires to SKILL.md frontmatter to improve doctor/install/fix coverage. Legacy yaml remains supported for compatibility.',
      source: 'derived',
      severity: 'non_blocking',
      remediation: 'Declare requires in SKILL.md frontmatter',
    });
  }

  if (effectiveRequires?.cli) {
    for (const cli of effectiveRequires.cli) {
      checks.push(await checkCli(cli));
    }
  }

  if (effectiveRequires?.hostConfig) {
    for (const hostConfig of effectiveRequires.hostConfig) {
      checks.push(await checkHostConfig(hostConfig, { target, targetRoot }));
    }
  }

  if (effectiveRequires?.settings) {
    for (const setting of effectiveRequires.settings) {
      checks.push(await checkSetting(setting, { target, targetRoot }));
    }
  }

  if (effectiveRequires?.permissions?.length) {
    for (const permission of effectiveRequires.permissions) {
      checks.push(checkPermission(permission, { target }));
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
  const readinessReport = buildReadinessReport(checks, summary);
  const trustReport = await buildTrustReport(normalized, options);
  const trustStatus = trustReport.status;
  const overallStatus = deriveOverallStatus(readinessReport.status, trustStatus);

  return {
    skillName: manifest.name,
    manifestPath,
    sidecarPath,
    primaryDocPath,
    primaryDocFormat,
    warnings,
    timestamp: new Date().toISOString(),
    overall,
    overallStatus,
    readinessStatus: readinessReport.status,
    trustStatus,
    summary,
    requirementsDeclared,
    checks,
    declaredProblems: readinessReport.declaredProblems,
    observedProblems: readinessReport.observedProblems,
    dependencyFindings: readinessReport.dependencyFindings,
    remediationActions: readinessReport.remediationActions,
    readinessReport,
    trustReport,
  };
}

export function printReport(report: DoctorReport): void {
  logger.blank();
  logger.heading(`Doctor Report: ${report.skillName}`);
  console.log(`  ${chalk.gray('Manifest:')} ${report.manifestPath}`);
  if (report.primaryDocPath && report.primaryDocPath !== report.manifestPath) {
    console.log(`  ${chalk.gray('Primary doc:')} ${report.primaryDocPath}`);
  }
  if (report.sidecarPath) {
    console.log(`  ${chalk.gray('Sidecar:')}  ${report.sidecarPath}`);
  }
  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.log(`  ${chalk.yellow('⚠')} ${chalk.gray(`[${warning.code}]`)} ${warning.message}`);
    }
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
  const trustIcon = report.trustStatus === 'ok' ? chalk.green('✔') : report.trustStatus === 'warning' ? chalk.yellow('⚠') : report.trustStatus === 'error' ? chalk.red('✖') : chalk.gray('?');
  console.log(`  Summary: ${chalk.gray(formatDoctorSummary(report))}`);
  console.log(`  Readiness: ${overallIcon} ${report.readinessStatus.toUpperCase()}`);
  console.log(`  Trust: ${trustIcon} ${report.trustStatus === 'unknown' ? chalk.gray('UNKNOWN') : report.trustStatus.toUpperCase()}`);
  console.log(`  Trust findings: ${chalk.gray(`${report.trustReport?.summary?.total ?? report.trustReport?.findings.length ?? 0}`)}`);
  if (report.trustReport?.providers?.length) {
    const providerSummary = report.trustReport.providers
      .map((provider) => `${provider.name}:${provider.status}${provider.executed ? '' : '(not-run)'}`)
      .join(', ');
    console.log(`  Trust providers: ${chalk.gray(providerSummary)}`);
  }
  console.log(`  Findings: ${chalk.gray(`${report.declaredProblems.length} declared, ${report.observedProblems.length} observed, ${report.dependencyFindings.length} dependency, ${report.remediationActions.length} actions`)}`);
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

// === Host config checks ===

async function checkHostConfig(
  req: HostConfigRequirement,
  options: { target?: RuntimeTarget; targetRoot?: string } = {},
): Promise<CheckResult> {
  const host = req.host ?? options.target;
  const required = req.required !== false;

  if (!host || host === 'unknown') {
    return {
      name: req.name,
      category: 'hostConfig',
      status: 'warning',
      message: `Host config check for "${req.name}" could not determine a target host`,
      detail: req.description,
      source: req.source,
      severity: 'non_blocking',
      required,
      remediation: 'Run doctor with an explicit --host when host-specific configuration matters',
    };
  }

  const root = await getEffectiveHostRoot(host, options.targetRoot);
  if (!root) {
    return {
      name: req.name,
      category: 'hostConfig',
      status: required ? 'error' : 'warning',
      message: `Host configuration missing for ${host}: no effective host root is configured`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      required,
      remediation: `Configure a host root for ${host} with \"invoker hosts set ${host} <path>\" or pass --host-root`,
      expectedValue: host,
      suggestedTarget: host,
    };
  }

  const exists = await fileExists(root);
  if (!exists) {
    return {
      name: req.name,
      category: 'hostConfig',
      status: required ? 'error' : 'warning',
      message: `Host configuration missing for ${host}: root does not exist at ${root}`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      required,
      remediation: `Create ${root} or update the configured host root for ${host}`,
      expectedValue: root,
      suggestedTarget: host,
      suggestedTargetRoot: root,
    };
  }

  return {
    name: req.name,
    category: 'hostConfig',
    status: 'ok',
    message: `Host configuration ready for ${host}: root exists at ${root}`,
    source: req.source,
    severity: 'non_blocking',
    required,
    detectedValue: root,
  };
}

// === Settings checks ===

async function checkSetting(
  req: SettingRequirement,
  options: { target?: RuntimeTarget; targetRoot?: string } = {},
): Promise<CheckResult> {
  const host = req.host ?? options.target;
  const required = req.required !== false;

  if (!host || host === 'unknown') {
    return {
      name: req.key,
      category: 'setting',
      status: 'warning',
      message: `Host setting "${req.key}" could not be checked because no target host was resolved`,
      detail: req.description,
      source: req.source,
      severity: 'non_blocking',
      required,
      remediation: 'Run doctor with an explicit --host when host-specific settings are required',
      expectedValue: req.expectedValue ?? req.key,
    };
  }

  const settingsPath = getSettingsFilePath(host);
  if (!settingsPath) {
    return {
      name: req.key,
      category: 'setting',
      status: 'warning',
      message: `Host setting "${req.key}" is not yet verifiable for host ${host}`,
      detail: req.description,
      source: req.source,
      severity: 'non_blocking',
      required,
      remediation: `Verify the required ${host} setting manually`,
      expectedValue: req.expectedValue ?? req.key,
    };
  }

  if (!(await fileExists(settingsPath))) {
    return {
      name: req.key,
      category: 'setting',
      status: required ? 'error' : 'warning',
      message: `Host settings file for ${host} is missing at ${settingsPath}`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      required,
      remediation: `Create or configure ${settingsPath} with the required setting`,
      expectedValue: req.expectedValue ?? req.key,
      suggestedTarget: host,
    };
  }

  const settings = await readJsonObject(settingsPath);
  const value = readPath(settings, req.key);
  if (value === undefined) {
    return {
      name: req.key,
      category: 'setting',
      status: required ? 'error' : 'warning',
      message: `Host setting "${req.key}" is not configured for ${host}`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      required,
      remediation: `Add setting ${req.key} to ${settingsPath}`,
      expectedValue: req.expectedValue ?? req.key,
      suggestedTarget: host,
    };
  }

  if (req.expectedValue !== undefined && String(value) !== req.expectedValue) {
    return {
      name: req.key,
      category: 'setting',
      status: required ? 'error' : 'warning',
      message: `Host setting "${req.key}" for ${host} does not match the expected value`,
      detail: req.description,
      source: req.source,
      severity: required ? 'blocking' : 'non_blocking',
      required,
      remediation: `Update ${req.key} in ${settingsPath} to ${req.expectedValue}`,
      detectedValue: String(value),
      expectedValue: req.expectedValue,
      suggestedTarget: host,
    };
  }

  return {
    name: req.key,
    category: 'setting',
    status: 'ok',
    message: `Host setting "${req.key}" is configured for ${host}`,
    source: req.source,
    severity: 'non_blocking',
    required,
    detectedValue: String(value),
    expectedValue: req.expectedValue,
  };
}

function checkPermission(permission: string, options: { target?: RuntimeTarget } = {}): CheckResult {
  return {
    name: permission,
    category: 'permission',
    status: 'warning',
    message: `Required host permission "${permission}" is declared but not yet verifiable${options.target ? ` for ${options.target}` : ''}`,
    detail: `Declared permission: ${permission}`,
    source: 'derived',
    severity: 'non_blocking',
    required: true,
    remediation: 'Verify that the target host has granted the required permission',
    expectedValue: permission,
    suggestedTarget: options.target,
  };
}

function getSettingsFilePath(host: RuntimeTarget): string | undefined {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  switch (host) {
    case 'claude':
      return resolve(home, '.claude', 'settings.json');
    case 'codex':
      return resolve(home, '.codex', 'settings.json');
    case 'invoker':
      return getInvokerConfigPath();
    default:
      return undefined;
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readTextFile(filePath);
  return JSON.parse(raw) as Record<string, unknown>;
}

function readPath(input: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, input);
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
      required,
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
      required,
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
      required: true,
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
      required: req.required !== false,
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
      required,
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

function buildReadinessReport(checks: CheckResult[], summary: DoctorSummary): ReadinessReport {
  const declaredProblems: ProblemFinding[] = [];
  const observedProblems: ProblemFinding[] = [];
  const dependencyFindings: DependencyFinding[] = [];
  const remediationActions: RemediationAction[] = [];

  for (const check of checks) {
    if (check.category === 'skill') {
      dependencyFindings.push({
        name: check.name,
        status: check.status,
        source: check.source,
        severity: check.severity,
        message: check.message,
        detail: check.detail,
        remediation: check.remediation,
        required: check.required !== false,
        suggestedSkillPath: check.suggestedSkillPath,
        suggestedTarget: check.suggestedTarget,
        suggestedTargetRoot: check.suggestedTargetRoot,
        detectedValue: check.detectedValue,
        expectedValue: check.expectedValue,
      });
      if (check.status !== 'ok') {
        remediationActions.push(toRemediationAction(check));
      }
      continue;
    }

    if (check.status !== 'ok') {
      const finding = toProblemFinding(check);
      if (check.source === 'derived') {
        observedProblems.push(finding);
      } else {
        declaredProblems.push(finding);
      }
      remediationActions.push(toRemediationAction(check));
    }
  }

  return {
    status: deriveOverall(checks),
    summary,
    declaredProblems,
    observedProblems,
    dependencyFindings,
    remediationActions,
  };
}

function toProblemFinding(check: CheckResult): ProblemFinding {
  return {
    name: check.name,
    category: check.category,
    status: check.status === 'ok' ? 'warning' : check.status,
    source: check.source,
    severity: check.severity,
    message: check.message,
    detail: check.detail,
    remediation: check.remediation,
    detectedValue: check.detectedValue,
    expectedValue: check.expectedValue,
    fixable: check.fixable,
    fixCommand: check.fixCommand,
    origin: check.source === 'derived' ? 'observed' : 'declared',
  };
}

function toRemediationAction(check: CheckResult): RemediationAction {
  return {
    type: remediationActionTypeForCheck(check),
    category: check.category,
    name: check.name,
    status: check.status === 'ok' ? 'warning' : check.status,
    mode: check.fixCommand || check.fixable ? 'auto' : 'manual',
    description: remediationDescriptionForCheck(check),
    command: check.fixCommand,
    remediation: check.remediation,
    source: check.source,
    target: check.suggestedTarget,
    targetRoot: check.suggestedTargetRoot,
    path: check.suggestedSkillPath,
    expectedValue: check.expectedValue,
  };
}

function remediationActionTypeForCheck(check: CheckResult): RemediationAction['type'] {
  switch (check.category) {
    case 'cli':
      return 'install';
    case 'token':
    case 'env':
      return 'configure';
    case 'resource':
      return check.fixable ? 'create' : 'configure';
    case 'skill':
      return check.suggestedSkillPath ? 'register' : 'install';
    default:
      return 'verify';
  }
}

function remediationDescriptionForCheck(check: CheckResult): string {
  switch (check.category) {
    case 'cli':
      return check.fixCommand ? `Install dependency: ${check.name}` : `Install dependency manually: ${check.name}`;
    case 'token':
      return `Configure authentication: ${check.name}`;
    case 'env':
      return `Set configuration: ${check.name}`;
    case 'resource':
      return check.fixable ? `Materialize resource: ${check.name}` : `Create/configure resource: ${check.name}`;
    case 'skill':
      return check.suggestedSkillPath ? `Register dependent skill: ${check.name}` : `Install dependent skill: ${check.name}`;
    default:
      return check.remediation ?? `Verify requirement: ${check.name}`;
  }
}

function deriveOverallStatus(readinessStatus: CheckStatus, trustStatus: DoctorReport['trustStatus']): DoctorReport['overallStatus'] {
  if (readinessStatus === 'error' || trustStatus === 'error') return 'error';
  if (readinessStatus === 'warning' || trustStatus === 'warning') return 'warning';
  if (readinessStatus === 'ok' && trustStatus === 'ok') return 'ok';
  return 'unknown';
}

function deriveOverall(checks: CheckResult[]): CheckStatus {
  if (checks.some((c) => c.status === 'error')) return 'error';
  if (checks.some((c) => c.status === 'warning')) return 'warning';
  return 'ok';
}
