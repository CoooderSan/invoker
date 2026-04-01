import chalk from 'chalk';
import ora from 'ora';
import { runShell } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { doctor } from './doctor.js';
import { scan } from './scanner.js';
import { registerDependentSkill, planDependentSkillRegistrations } from './registry.js';
import type { InstallPlan, InstallStep, ScanOptions } from '../types.js';

/**
 * Build an install plan based on doctor report.
 * Only includes steps for items that are NOT ok.
 */
export async function buildInstallPlan(skillPathOrName: string, options: ScanOptions = {}): Promise<InstallPlan> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, dir } = normalized;
  const report = await doctor(skillPathOrName, options);

  const steps: InstallStep[] = await planDependentSkillRegistrations(normalized.effectiveRequires?.skills, dir, {
    target: normalized.target,
    targetRoot: normalized.targetRoot,
  });

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
      const alreadyPlanned = steps.some((step) => step.type === 'skill' && step.name === check.name && step.operation === 'register');
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

  return { skillName: manifest.name, steps };
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
        await registerDependentSkill(requirement, context.skillDir, { ...context.options, target: step.host ?? context.options?.target });
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
export async function install(skillPathOrName: string, options: ScanOptions = {}): Promise<InstallPlan> {
  const normalized = await scan(skillPathOrName, options);
  const plan = await buildInstallPlan(skillPathOrName, options);
  return executeInstallPlan(plan, { skillPathOrName, skillDir: normalized.dir, options });
}
