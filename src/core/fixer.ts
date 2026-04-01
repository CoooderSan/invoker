import chalk from 'chalk';
import ora from 'ora';
import { runShell } from '../utils/exec.js';
import { writeTextFile, resolveRequirementPath } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { scan } from './scanner.js';
import { doctor, printReport } from './doctor.js';
import { registerDependentSkill, planDependentSkillRegistrations } from './registry.js';
import type { ResourceRequirement, ScanOptions } from '../types.js';

export interface FixResult {
  skillName: string;
  fixed: string[];
  skipped: string[];
  failed: string[];
}

/**
 * Automatically fix all fixable issues found by doctor.
 */
export async function fix(skillPathOrName: string, options: ScanOptions = {}): Promise<FixResult> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, dir, effectiveRequires } = normalized;

  logger.info(`Running doctor check on "${manifest.name}"...`);
  const report = await doctor(skillPathOrName, options);

  const fixableChecks = report.checks.filter((c) => c.status !== 'ok');
  const registrationSteps = await planDependentSkillRegistrations(effectiveRequires?.skills, dir, {
    target: normalized.target,
    targetRoot: normalized.targetRoot,
  });
  if (fixableChecks.length === 0 && registrationSteps.length === 0) {
    logger.success(`"${manifest.name}" has no issues to fix!`);
    return { skillName: manifest.name, fixed: [], skipped: [], failed: [] };
  }

  logger.heading(`Fixing issues for: ${manifest.name}`);
  logger.blank();

  const result: FixResult = {
    skillName: manifest.name,
    fixed: [],
    skipped: [],
    failed: [],
  };

  for (const step of registrationSteps) {
    const spinner = ora(step.description).start();
    try {
      await registerDependentSkill(
        { name: step.name, path: step.path },
        dir,
        { ...options, target: step.host ?? normalized.target, targetRoot: normalized.targetRoot },
      );
      spinner.succeed(step.description);
      result.fixed.push(step.name);
    } catch {
      spinner.fail(`${step.description} — ERROR`);
      result.failed.push(step.name);
    }
  }

  for (const check of fixableChecks) {
    if (check.category === 'cli' && check.fixCommand) {
      const spinner = ora(`Installing dependency: ${check.name}`).start();
      try {
        const res = await runShell(check.fixCommand);
        if (res.exitCode === 0) {
          spinner.succeed(`Installed dependency: ${check.name}`);
          result.fixed.push(check.name);
        } else {
          spinner.fail(`Failed to install dependency: ${check.name}`);
          if (res.stderr) console.log(chalk.gray(`    ${res.stderr.split('\n')[0]}`));
          result.failed.push(check.name);
        }
      } catch {
        spinner.fail(`Error installing dependency: ${check.name}`);
        result.failed.push(check.name);
      }
      continue;
    }

    if (check.category === 'resource' && check.fixable) {
      const resource = effectiveRequires?.resources?.find((r) => r.name === check.name);
      if (resource) {
        const fixed = await fixResource(resource, dir);
        if (fixed) {
          result.fixed.push(check.name);
        } else {
          result.failed.push(check.name);
        }
        continue;
      }
    }

    if (check.category === 'skill') {
      const dependent = effectiveRequires?.skills?.find((item) => item.name === check.name);
      const canAutoRegister = Boolean(dependent?.path || check.suggestedSkillPath);
      if (dependent && canAutoRegister) {
        const spinner = ora(`Registering dependent skill: ${check.name}`).start();
        try {
          await registerDependentSkill(
            { ...dependent, path: dependent.path ?? check.suggestedSkillPath },
            dir,
            { ...options, target: check.suggestedTarget ?? options.target, targetRoot: check.suggestedTargetRoot ?? options.targetRoot },
          );
          spinner.succeed(`Registered dependent skill: ${check.name}`);
          result.fixed.push(check.name);
        } catch {
          spinner.fail(`Failed to register dependent skill: ${check.name}`);
          result.failed.push(check.name);
        }
        continue;
      }
    }

    if (!check.fixable && !check.fixCommand) {
      logger.warn(`[${check.category}] ${check.name}: requires manual action — ${check.message}`);
      if (check.remediation) {
        console.log(chalk.gray(`    Next step: ${check.remediation}`));
      }
      result.skipped.push(check.name);
      continue;
    }

    if (check.fixCommand) {
      const spinner = ora(`Fixing: ${check.name}`).start();
      try {
        const res = await runShell(check.fixCommand);
        if (res.exitCode === 0) {
          spinner.succeed(`Fixed: ${check.name}`);
          result.fixed.push(check.name);
        } else {
          spinner.fail(`Failed to fix: ${check.name}`);
          result.failed.push(check.name);
        }
      } catch {
        spinner.fail(`Error fixing: ${check.name}`);
        result.failed.push(check.name);
      }
      continue;
    }

    result.skipped.push(check.name);
  }

  logger.blank();
  logger.heading('Fix Summary');
  if (result.fixed.length > 0) {
    logger.success(`Fixed: ${result.fixed.join(', ')}`);
  }
  if (result.skipped.length > 0) {
    logger.warn(`Skipped (manual): ${result.skipped.join(', ')}`);
  }
  if (result.failed.length > 0) {
    logger.error(`Failed: ${result.failed.join(', ')}`);
  }

  logger.blank();
  logger.info('Re-running doctor check...');
  const finalReport = await doctor(skillPathOrName, options);
  printReport(finalReport);

  return result;
}

async function fixResource(resource: ResourceRequirement, skillDir: string): Promise<boolean> {
  if (!resource.path) return false;

  const targetPath = resolveRequirementPath(resource.path, skillDir);
  const spinner = ora(`Creating resource: ${resource.name} at ${targetPath}`).start();

  try {
    if (resource.template) {
      await writeTextFile(targetPath, resource.template);
      spinner.succeed(`Created resource: ${resource.name}`);
      return true;
    }

    if (resource.templateUrl) {
      const response = await fetch(resource.templateUrl);
      if (!response.ok) {
        spinner.fail(`Failed to download template for ${resource.name}: HTTP ${response.status}`);
        return false;
      }
      const content = await response.text();
      await writeTextFile(targetPath, content);
      spinner.succeed(`Created resource: ${resource.name} (from URL)`);
      return true;
    }

    spinner.fail(`No template available for resource: ${resource.name}`);
    return false;
  } catch {
    spinner.fail(`Error creating resource: ${resource.name}`);
    return false;
  }
}

