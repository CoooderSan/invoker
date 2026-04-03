import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { runShell } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { doctor } from './doctor.js';
import { getSourceConfig } from './host-config.js';
import { installRemoteSkill, previewRemoteSkill } from './remote-source.js';
import { getTargetRoot, scan } from './scanner.js';
import { registerDependentSkill, planDependentSkillRegistrations, registerSkillFromPath } from './registry.js';
import type {
  InstallOptions,
  InstallPlan,
  InstallStep,
  RemediationAction,
  RemoteInstallRequest,
  RuntimeTarget,
  ScanOptions,
} from '../types.js';

interface PreparedPlanInput {
  skillLookup: string;
  scanOptions: ScanOptions;
  preSteps: InstallStep[];
  cleanup?: () => Promise<void>;
}

function isSkillNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Cannot find skill document');
}

function withRemoteHint(message: string): string {
  return `${message}\nTip: configure a source in ~/.invoker/config.json and run invoker install <skill> --host <claude|codex|invoker> --source <name>`;
}

function resolveRemoteTarget(options: InstallOptions): RuntimeTarget {
  const target = options.target;
  if (!target || target === 'unknown') {
    throw new Error('Remote install requires an explicit --host (claude, codex, or invoker).');
  }
  return target;
}

async function buildRemoteInstallRequest(skill: string, options: InstallOptions): Promise<RemoteInstallRequest> {
  const target = resolveRemoteTarget(options);
  const targetRoot = await getTargetRoot(target, options.targetRoot);

  if (!targetRoot) {
    throw new Error(
      `Cannot resolve host root for host "${target}". Provide --host-root or configure it with "invoker hosts set ${target} <path>".`,
    );
  }

  return {
    skill,
    version: options.version,
    target,
    targetRoot,
    source: options.source ?? '',
    force: options.force,
  };
}

function buildRemotePlanPrelude(params: {
  skill: string;
  version: string;
  sourceName: string;
  downloadUrl: string;
  target: RuntimeTarget;
  targetRoot: string;
}): InstallStep[] {
  const targetDir = resolve(params.targetRoot, params.skill);

  return [
    {
      type: 'config',
      name: params.skill,
      action: 'fetch',
      description: `Fetch remote package (${params.sourceName}): ${params.skill}@${params.version}`,
      status: 'pending',
      mode: 'auto',
      remediation: params.downloadUrl,
      host: params.target,
      path: targetDir,
    },
    {
      type: 'config',
      name: params.skill,
      action: 'materialize',
      description: `Materialize skill into host root (${params.target}): ${targetDir}`,
      status: 'pending',
      mode: 'auto',
      host: params.target,
      path: targetDir,
    },
    {
      type: 'config',
      name: params.skill,
      action: 'register',
      description: `Register skill in local registry: ${params.skill}`,
      status: 'pending',
      mode: 'auto',
      host: params.target,
      path: targetDir,
    },
  ];
}

async function prepareRemotePlanInput(skillPathOrName: string, options: InstallOptions): Promise<PreparedPlanInput | null> {
  const source = await getSourceConfig(options.source);
  if (!source) {
    if (options.source) {
      throw new Error(`Remote source "${options.source}" is not configured in ~/.invoker/config.json.`);
    }
    return null;
  }

  const request = await buildRemoteInstallRequest(skillPathOrName, options);
  request.source = source.name;

  const preview = await previewRemoteSkill(request, source);
  const preSteps = buildRemotePlanPrelude({
    skill: request.skill,
    version: preview.pkg.version,
    sourceName: source.name,
    downloadUrl: preview.pkg.downloadUrl,
    target: request.target,
    targetRoot: request.targetRoot,
  });

  return {
    skillLookup: preview.skillDir,
    scanOptions: { target: request.target, targetRoot: request.targetRoot },
    preSteps,
    cleanup: preview.cleanup,
  };
}

/**
 * Build an install plan based on doctor report.
 * Only includes steps for items that are NOT ok.
 */
export async function buildInstallPlan(skillPathOrName: string, options: InstallOptions = {}): Promise<InstallPlan> {
  let input: PreparedPlanInput = {
    skillLookup: skillPathOrName,
    scanOptions: options,
    preSteps: [],
  };

  try {
    await scan(skillPathOrName, options);
  } catch (error) {
    if (!isSkillNotFoundError(error)) {
      throw error;
    }

    const remoteInput = await prepareRemotePlanInput(skillPathOrName, options);
    if (!remoteInput) {
      throw new Error(withRemoteHint(error instanceof Error ? error.message : String(error)));
    }

    input = remoteInput;
  }

  try {
    return await buildInstallPlanForResolvedSkill(input.skillLookup, input.scanOptions, input.preSteps);
  } finally {
    if (input.cleanup) {
      await input.cleanup();
    }
  }
}

async function buildInstallPlanForResolvedSkill(
  skillPathOrName: string,
  options: ScanOptions,
  preSteps: InstallStep[] = [],
): Promise<InstallPlan> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, dir } = normalized;
  const report = await doctor(skillPathOrName, options);

  const steps: InstallStep[] = [...preSteps];

  const dependencyRegistrationSteps = await planDependentSkillRegistrations(normalized.effectiveRequires?.skills, dir, {
    target: normalized.target,
    targetRoot: normalized.targetRoot,
  });

  for (const step of dependencyRegistrationSteps) {
    const alreadyPlanned = steps.some(
      (existing) => existing.type === 'skill' && existing.name === step.name && existing.operation === 'register',
    );
    if (alreadyPlanned) continue;
    steps.push(step);
  }

  for (const action of report.remediationActions ?? []) {
    const step = remediationActionToInstallStep(action);
    if (!step) continue;

    if (step.type === 'skill' && step.operation === 'register') {
      const alreadyPlanned = steps.some(
        (existing) => existing.type === 'skill' && existing.name === step.name && existing.operation === 'register',
      );
      if (alreadyPlanned) continue;
    }

    steps.push(step);
  }

  if ((report.remediationActions ?? []).length === 0) {
    for (const check of report.checks) {
      if (check.status === 'ok') continue;

      if (check.category === 'cli') {
        steps.push({
          type: 'cli',
          name: check.name,
          action: 'install',
          command: check.fixCommand,
          description: check.fixCommand ? `Install dependency: ${check.name}` : `Install dependency manually: ${check.name}`,
          status: 'pending',
          mode: check.fixCommand ? 'auto' : 'manual',
          source: check.source,
          remediation: check.remediation,
        });
        continue;
      }

      if (check.category === 'token') {
        steps.push({
          type: 'token',
          name: check.name,
          action: 'configure',
          description: `Configure authentication: ${check.name}`,
          status: 'pending',
          mode: 'manual',
          source: check.source,
          remediation: check.remediation ?? check.detail ?? 'Set the required environment variable',
        });
        continue;
      }

      if (check.category === 'env') {
        steps.push({
          type: 'env',
          name: check.name,
          action: 'configure',
          description: `Set configuration: ${check.name}`,
          status: 'pending',
          mode: 'manual',
          source: check.source,
          remediation: check.remediation ?? 'Set the required environment variable',
        });
        continue;
      }

      if (check.category === 'resource') {
        steps.push({
          type: 'resource',
          name: check.name,
          action: check.fixable ? 'create' : 'configure',
          description: check.fixable ? `Materialize resource: ${check.name}` : `Create/configure resource: ${check.name}`,
          status: 'pending',
          mode: check.fixable ? 'auto' : 'manual',
          source: check.source,
          remediation: check.remediation ?? 'Create the required resource file',
        });
        continue;
      }

      if (check.category === 'skill') {
        const alreadyPlanned = steps.some(
          (step) => step.type === 'skill' && step.name === check.name && step.operation === 'register',
        );
        if (alreadyPlanned) continue;

        const dependent = normalized.effectiveRequires?.skills?.find((item) => item.name === check.name);
        const dependentPath = dependent?.path;
        const host = options.target;
        const canAutoRegister = Boolean(dependentPath);
        const hostHint = host ? ` in host ${host}` : '';
        steps.push({
          type: 'skill',
          name: check.name,
          action: canAutoRegister ? 'register' : 'install',
          operation: canAutoRegister ? 'register' : 'install',
          description: canAutoRegister
            ? `Register dependent skill${hostHint}: ${check.name}`
            : `Install dependent skill${hostHint}: ${check.name}`,
          status: 'pending',
          mode: canAutoRegister ? 'auto' : 'manual',
          source: check.source,
          remediation:
            check.remediation ??
            (canAutoRegister
              ? `Run invoker install ${manifest.name}${host ? ` --host ${host}` : ''} to register the local dependent skill`
              : `Provide a local path or place the skill in host ${host ?? 'current'} root, then re-run install`),
          path: dependentPath,
          host,
        });
        continue;
      }
    }
  }

  return { skillName: manifest.name, steps };
}

function remediationActionToInstallStep(action: RemediationAction): InstallStep | null {
  switch (action.category) {
    case 'cli':
      return {
        type: 'cli',
        name: action.name,
        action: action.type,
        command: action.command,
        description: action.description,
        status: 'pending',
        mode: action.mode,
        source: action.source,
        remediation: action.remediation,
      };
    case 'token':
      return {
        type: 'token',
        name: action.name,
        action: 'configure',
        description: action.description,
        status: 'pending',
        mode: action.mode,
        source: action.source,
        remediation: action.remediation,
      };
    case 'env':
      return {
        type: 'env',
        name: action.name,
        action: 'configure',
        description: action.description,
        status: 'pending',
        mode: action.mode,
        source: action.source,
        remediation: action.remediation,
      };
    case 'resource':
      return {
        type: 'resource',
        name: action.name,
        action: action.type === 'create' ? 'create' : 'configure',
        description: action.description,
        status: 'pending',
        mode: action.mode,
        source: action.source,
        remediation: action.remediation,
      };
    case 'skill':
      return {
        type: 'skill',
        name: action.name,
        action: action.type === 'register' ? 'register' : 'install',
        operation: action.type === 'register' ? 'register' : 'install',
        description: action.description,
        status: 'pending',
        mode: action.mode,
        source: action.source,
        remediation: action.remediation,
        path: action.path,
        host: action.target,
      };
    default:
      return null;
  }
}

/**
 * Execute an install plan, running fixable steps automatically.
 */
export async function executeInstallPlan(
  plan: InstallPlan,
  context?: { skillPathOrName?: string; skillDir?: string; options?: ScanOptions },
): Promise<InstallPlan> {
  logger.heading(`Installing dependencies for: ${plan.skillName}`);
  logger.blank();

  if (plan.steps.length === 0) {
    logger.success('All dependencies are already satisfied!');
    return plan;
  }

  for (const step of plan.steps) {
    if (step.type === 'skill' && step.operation === 'register' && context?.skillDir) {
      const spinner = ora(`${step.description}`).start();
      step.status = 'running';
      try {
        const requirement = { name: step.name, path: step.path };
        await registerDependentSkill(requirement, context.skillDir, {
          ...context.options,
          target: step.host ?? context.options?.target,
        });
        step.status = 'done';
        spinner.succeed(`${step.description}`);
      } catch (err: unknown) {
        step.status = 'failed';
        step.error = String(err);
        spinner.fail(`${step.description} — ERROR`);
      }
      continue;
    }

    if (!step.command) {
      step.status = 'skipped';
      logger.warn(`${step.description} — requires manual action, skipped`);
      if (step.remediation) {
        console.log(chalk.gray(`    Next step: ${step.remediation}`));
      }
      continue;
    }

    const spinner = ora(`${step.description}`).start();
    step.status = 'running';

    try {
      const result = await runShell(step.command);
      if (result.exitCode !== 0) {
        step.status = 'failed';
        step.error = result.stderr || result.stdout;
        spinner.fail(`${step.description} — FAILED`);
        if (step.error) {
          console.log(chalk.gray(`    ${step.error.split('\n')[0]}`));
        }
      } else {
        step.status = 'done';
        spinner.succeed(`${step.description}`);
      }
    } catch (err: unknown) {
      step.status = 'failed';
      step.error = String(err);
      spinner.fail(`${step.description} — ERROR`);
    }
  }

  logger.blank();
  const failed = plan.steps.filter((s) => s.status === 'failed');
  const skipped = plan.steps.filter((s) => s.status === 'skipped');
  const done = plan.steps.filter((s) => s.status === 'done');

  logger.info(`Results: ${done.length} done, ${skipped.length} skipped, ${failed.length} failed`);
  return plan;
}

/**
 * High-level install command: build plan + execute.
 */
export async function install(skillPathOrName: string, options: InstallOptions = {}): Promise<InstallPlan> {
  try {
    const normalized = await scan(skillPathOrName, options);
    const plan = await buildInstallPlanForResolvedSkill(skillPathOrName, options);
    return executeInstallPlan(plan, { skillPathOrName, skillDir: normalized.dir, options });
  } catch (error) {
    if (!isSkillNotFoundError(error)) {
      throw error;
    }

    const source = await getSourceConfig(options.source);
    if (!source) {
      if (options.source) {
        throw new Error(`Remote source "${options.source}" is not configured in ~/.invoker/config.json.`);
      }
      throw new Error(withRemoteHint(error instanceof Error ? error.message : String(error)));
    }

    const request = await buildRemoteInstallRequest(skillPathOrName, options);
    request.source = source.name;

    const remoteResult = await installRemoteSkill(request, source);
    await registerSkillFromPath(
      remoteResult.targetDir,
      { target: request.target, targetRoot: request.targetRoot },
      {
        installedFrom: 'remote',
        sourceName: source.name,
        sourceVersion: remoteResult.package.version,
      },
    );

    if (remoteResult.status === 'noop') {
      logger.info(
        `Remote skill "${request.skill}" is already present at ${remoteResult.targetDir} (${remoteResult.package.version}).`,
      );
    } else {
      logger.info(
        `Materialized remote skill "${request.skill}" into ${remoteResult.targetDir} via source "${source.name}" (${remoteResult.package.version}).`,
      );
    }

    const scanOptions: ScanOptions = { target: request.target, targetRoot: request.targetRoot };
    const plan = await buildInstallPlanForResolvedSkill(remoteResult.targetDir, scanOptions);
    return executeInstallPlan(plan, {
      skillPathOrName: remoteResult.targetDir,
      skillDir: remoteResult.targetDir,
      options: scanOptions,
    });
  }
}
