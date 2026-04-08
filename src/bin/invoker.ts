#!/usr/bin/env node

import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { fileExists } from '../utils/fs.js';
import { scan, hasRequirements } from '../core/scanner.js';
import { doctor, printReport } from '../core/doctor.js';
import { install, buildInstallPlan } from '../core/installer.js';
import { fix } from '../core/fixer.js';
import { listSkills, getSkillInfo, registerSkillFromPath, unregisterSkill } from '../core/registry.js';
import { getConfiguredHostRoots, getDefaultHostRoots, setHostRoot, unsetHostRoot } from '../core/host-config.js';
import { runSkill } from '../core/runner.js';
import { bootstrapSkill, ensureInvokerCli } from '../core/bootstrap.js';
import { syncTrellisCommandsToCodex } from '../core/trellis-sync.js';
import { logger, setJsonMode } from '../utils/logger.js';
import type { InstallOptions, RuntimeTarget, ScanOptions } from '../types.js';

const program = new Command();

program
  .name('invoker')
  .description('AI Skill Control Plane — diagnose and remediate host readiness for AI skills')
  .version('0.1.4');

export function isCliEntrypoint(argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(argvPath).href;
  }
}

export function buildScanOptions(opts: { host?: string; hostRoot?: string }): ScanOptions {
  return {
    target: opts.host as RuntimeTarget | undefined,
    targetRoot: opts.hostRoot,
  };
}

function addHostOptions(command: Command): Command {
  return command
    .option('--host <host>', 'Host runtime to resolve the skill from (claude, codex, invoker)')
    .option('--host-root <path>', 'Override the root directory for the selected host runtime');
}

addHostOptions(
  program
    .command('scan <skill>')
    .description('Scan skill dependencies from the skill document')
    .option('--json', 'Output machine-readable JSON (for AI consumers)')
    .action(async (skill: string, opts: { host?: string; hostRoot?: string; json?: boolean }) => {
      if (opts.json) setJsonMode(true);
      try {
        const normalized = await scan(skill, buildScanOptions(opts));
        const { manifest, effectiveRequires, dir, manifestPath, sidecarPath, primaryDocPath, primaryDocFormat, warnings, target, targetRoot, resolutionSource } = normalized;

        if (opts.json) {
          console.log(JSON.stringify({ manifest, effectiveRequires, dir, manifestPath, sidecarPath, primaryDocPath, primaryDocFormat, warnings, target, targetRoot, resolutionSource }, null, 2));
          return;
        }

        logger.heading(`Skill: ${manifest.name} v${manifest.version}`);
        logger.info(`Directory: ${dir}`);
        logger.info(`Manifest: ${manifestPath}`);
        if (primaryDocPath !== manifestPath) {
          logger.info(`Primary doc: ${primaryDocPath}`);
        }
        logger.info(`Host: ${target}`);
        if (targetRoot) {
          logger.info(`Host root: ${targetRoot}`);
        }
        logger.info(`Resolved via: ${resolutionSource}`);
        logger.info(`Description: ${manifest.description}`);
        if (sidecarPath) {
          logger.info(`Sidecar: ${sidecarPath}`);
        }
        if (warnings.length) {
          for (const warning of warnings) {
            logger.warn(`${warning.code}: ${warning.message}`);
          }
        }

        if (manifest.entrypoint) {
          logger.info(`Entrypoint: ${manifest.entrypoint}`);
        }

        logger.blank();
        logger.heading('Effective dependencies:');
        if (!hasRequirements(effectiveRequires)) {
          console.log(chalk.yellow('  No requires declared in manifest or sidecar.'));
        } else {
          printRequirements(effectiveRequires);
        }

        if (manifest.intents?.length) {
          logger.blank();
          logger.heading('Intents:');
          for (const intent of manifest.intents) {
            console.log(`  - ${chalk.cyan(intent.name)}: ${intent.description}`);
          }
        }

        logger.blank();
      } catch (err: unknown) {
        if (opts.json) {
          console.log(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
          process.exit(1);
        }
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

program
  .command('trellis-codex-sync')
  .description('Migrate .claude Trellis commands into Codex .agents skills')
  .option('--project-root <path>', 'Project root to resolve source and target directories from')
  .option('--source-dir <path>', 'Override the Trellis Claude command source directory')
  .option('--target-dir <path>', 'Override the Codex skill output directory')
  .option('--json', 'Output machine-readable JSON (for AI consumers)')
  .action(async (opts: { projectRoot?: string; sourceDir?: string; targetDir?: string; json?: boolean }) => {
    if (opts.json) setJsonMode(true);
    try {
      const result = await syncTrellisCommandsToCodex({
        projectRoot: opts.projectRoot,
        sourceDir: opts.sourceDir,
        targetDir: opts.targetDir,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      logger.heading('Synced Trellis commands to Codex skills');
      logger.info(`Source: ${result.sourceDir}`);
      logger.info(`Target: ${result.targetDir}`);
      logger.blank();
      for (const skill of result.synced) {
        logger.success(`${skill.name} -> ${skill.targetPath}`);
      }
    } catch (err: unknown) {
      if (opts.json) {
        console.log(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
        process.exit(1);
      }
      logger.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    }
  });

addHostOptions(
  program
    .command('doctor <skill>')
    .description('Check environment for a skill')
    .option('--json', 'Output machine-readable JSON (for AI consumers)')
    .action(async (skill: string, opts: { host?: string; hostRoot?: string; json?: boolean }) => {
      if (opts.json) setJsonMode(true);
      try {
        const report = await doctor(skill, buildScanOptions(opts));
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          if (report.overall === 'error') process.exit(1);
          return;
        }
        printReport(report);
        if (report.overall === 'error') process.exit(1);
      } catch (err: unknown) {
        if (opts.json) {
          console.log(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
          process.exit(1);
        }
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('install <skill>')
    .description('Install missing dependencies for a skill')
    .option('--dry-run', 'Show install plan without executing')
    .option('--source <name>', 'Remote source name for market install fallback')
    .option('--version <version>', 'Remote skill version for market install fallback')
    .option('--force', 'Allow replacing existing local skill directory when installing from remote')
    .action(async (skill: string, opts: { dryRun?: boolean; host?: string; hostRoot?: string; source?: string; version?: string; force?: boolean }) => {
      try {
        const scanOptions: InstallOptions = {
          ...buildScanOptions(opts),
          source: opts.source,
          version: opts.version,
          force: opts.force,
        };
        if (opts.dryRun) {
          const plan = await buildInstallPlan(skill, scanOptions);
          logger.heading(`Install plan for: ${plan.skillName}`);
          if (plan.steps.length === 0) {
            logger.success('All dependencies are already satisfied!');
          } else {
            for (const step of plan.steps) {
              const mode = step.mode === 'manual' ? chalk.yellow('manual') : chalk.green('auto');
              const cmd = step.command ? chalk.gray(` → ${step.command}`) : '';
              console.log(`  [${step.type}] ${step.description} (${mode})${cmd}`);
              if (step.remediation) {
                console.log(chalk.gray(`      Next step: ${step.remediation}`));
              }
            }
          }
        } else {
          await install(skill, scanOptions);
        }
      } catch (err: unknown) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('fix <skill>')
    .description('Automatically fix all issues for a skill')
    .action(async (skill: string, opts: { host?: string; hostRoot?: string }) => {
      try {
        await fix(skill, buildScanOptions(opts));
      } catch (err: unknown) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('list')
    .description('List all installed skills')
    .option('--refresh', 'Refresh status via doctor check')
    .option('--json', 'Output machine-readable JSON (for AI consumers)')
    .action(async (opts: { refresh?: boolean; host?: string; hostRoot?: string; json?: boolean }) => {
      if (opts.json) setJsonMode(true);
      try {
        const skills = await listSkills(opts.refresh, buildScanOptions(opts));
        if (opts.json) {
          console.log(JSON.stringify(skills, null, 2));
          return;
        }

        if (skills.length === 0) {
          logger.info('No skills installed. Skills are discovered from configured host runtime roots.');
          return;
        }

        logger.heading('Installed Skills:');
        logger.blank();

        for (const skill of skills) {
          const statusIcon =
            skill.status === 'ok'
              ? chalk.green('✔')
              : skill.status === 'warning'
                ? chalk.yellow('⚠')
                : chalk.red('✖');
          const summary = skill.lastStatusSummary ? chalk.gray(` — ${skill.lastStatusSummary}`) : '';
          console.log(`  ${statusIcon} ${chalk.bold(skill.name)} [host:${skill.target}] v${skill.version} — ${skill.path}${summary}`);
        }
        logger.blank();
      } catch (err: unknown) {
        if (opts.json) {
          console.log(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
          process.exit(1);
        }
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('info <skill>')
    .description('Show detailed information about a skill')
    .option('--json', 'Output machine-readable JSON (for AI consumers)')
    .action(async (skill: string, opts: { host?: string; hostRoot?: string; json?: boolean }) => {
      if (opts.json) setJsonMode(true);
      try {
        const { manifest, effectiveRequires, dir, manifestPath, sidecarPath, primaryDocPath, primaryDocFormat, warnings, target, targetRoot, registered, registryEntry } =
          await getSkillInfo(skill, buildScanOptions(opts));

        const report = await doctor(skill, buildScanOptions(opts));

        if (opts.json) {
          console.log(JSON.stringify({ manifest, effectiveRequires, dir, manifestPath, sidecarPath, primaryDocPath, primaryDocFormat, warnings, target, targetRoot, registered, registryEntry, doctorReport: report }, null, 2));
          return;
        }

        logger.heading(`Skill: ${manifest.name}`);
        console.log(`  Version:     ${manifest.version}`);
        console.log(`  Description: ${manifest.description}`);
        console.log(`  Directory:   ${dir}`);
        console.log(`  Host:        ${target}`);
        console.log(`  Host root:   ${targetRoot ?? chalk.gray('none')}`);
        console.log(`  Manifest:    ${manifestPath}`);
        if (primaryDocPath !== manifestPath) {
          console.log(`  Primary doc: ${primaryDocPath}`);
        }
        console.log(`  Sidecar:     ${sidecarPath ?? chalk.gray('none')}`);
        console.log(`  Registered:  ${registered ? chalk.green('yes') : chalk.yellow('no')}`);
        if (manifest.entrypoint) {
          console.log(`  Entrypoint:  ${manifest.entrypoint}`);
        }
        if (registryEntry?.lastStatusSummary) {
          console.log(`  Last check:  ${registryEntry.lastStatusSummary}`);
        }
        if (warnings.length) {
          console.log(`  Warnings:    ${warnings.length}`);
          for (const warning of warnings) {
            console.log(`    - ${warning.code}: ${warning.message}`);
          }
        }

        if (hasRequirements(effectiveRequires)) {
          logger.blank();
          console.log('  Effective dependencies:');
          if (effectiveRequires?.cli?.length) console.log(`    CLI:         ${effectiveRequires.cli.length}`);
          if (effectiveRequires?.tokens?.length) console.log(`    Tokens:      ${effectiveRequires.tokens.length}`);
          if (effectiveRequires?.env?.length) console.log(`    Env vars:    ${effectiveRequires.env.length}`);
          if (effectiveRequires?.resources?.length) console.log(`    Resources:   ${effectiveRequires.resources.length}`);
          if (effectiveRequires?.skills?.length) console.log(`    Skills:      ${effectiveRequires.skills.length}`);
          if (effectiveRequires?.permissions?.length) console.log(`    Permissions: ${effectiveRequires.permissions.length}`);
        }

        if (manifest.intents?.length) {
          logger.blank();
          console.log(`  Intents: ${manifest.intents.length}`);
          for (const intent of manifest.intents) {
            console.log(`    - ${intent.name}: ${intent.description}`);
          }
        }

        logger.blank();
        printReport(report);
      } catch (err: unknown) {
        if (opts.json) {
          console.log(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
          process.exit(1);
        }
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('register <skill>')
    .description('Register an existing host skill into the local registry')
    .action(async (skill: string, opts: { host?: string; hostRoot?: string }) => {
      try {
        const entry = await registerSkillFromPath(skill, buildScanOptions(opts));
        logger.success(`Registered "${entry.name}" v${entry.version} from ${entry.path} [host:${entry.target}]`);
      } catch (err: unknown) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('unregister <skill>')
    .description('Remove a skill from the local registry without deleting host files')
    .action(async (skill: string, opts: { host?: string }) => {
      try {
        const removed = await unregisterSkill(skill, opts.host as RuntimeTarget | undefined);
        if (removed) {
          logger.success(`Unregistered "${skill}"`);
        } else {
          logger.warn(`Skill "${skill}" was not found in the registry`);
        }
      } catch (err: unknown) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

addHostOptions(
  program
    .command('bootstrap <skill>')
    .description('Bootstrap a skill-first install flow and remediate host readiness')
    .option('--json', 'Output machine-readable JSON (for AI consumers)')
    .option('--auto-install-invoker', 'Automatically install the invoker CLI when missing')
    .option('--source <name>', 'Remote source name for market install fallback')
    .option('--version <version>', 'Remote skill version for market install fallback')
    .option('--force', 'Allow replacing existing local skill directory when installing from remote')
    .action(
      async (
        skill: string,
        opts: {
          json?: boolean;
          autoInstallInvoker?: boolean;
          host?: string;
          hostRoot?: string;
          source?: string;
          version?: string;
          force?: boolean;
        },
      ) => {
        if (opts.json) setJsonMode(true);
        try {
          const ensured = await ensureInvokerCli({ autoInstall: opts.autoInstallInvoker });
          const scanOptions: InstallOptions = {
            ...buildScanOptions(opts),
            source: opts.source,
            version: opts.version,
            force: opts.force,
          };

          if (ensured.status === 'missing' || ensured.status === 'failed') {
            if (opts.json) {
              console.log(
                JSON.stringify(
                  {
                    status: ensured.status,
                    command: ensured.command,
                    installCommand: ensured.installCommand,
                    fallbackCommand: ensured.fallbackCommand,
                    message: ensured.message,
                  },
                  null,
                  2,
                ),
              );
              process.exit(ensured.status === 'failed' ? 1 : 0);
            }
            logger.warn(ensured.message);
            process.exit(ensured.status === 'failed' ? 1 : 0);
          }

          const result = await bootstrapSkill(skill, scanOptions);
          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  status: result.doctorReport.overall === 'error' ? 'blocked' : 'ready',
                  invokerCli: {
                    status: ensured.status,
                    command: ensured.command,
                    detectedPath: ensured.detectedPath,
                    installCommand: ensured.installCommand,
                    fallbackCommand: ensured.fallbackCommand,
                  },
                  installAttempted: result.installAttempted,
                  installPlan: result.installPlan,
                  doctorReport: result.doctorReport,
                },
                null,
                2,
              ),
            );
            if (result.doctorReport.overall === 'error') process.exit(1);
            return;
          }

          if (ensured.status === 'installed') {
            logger.success(ensured.message);
          }
          printReport(result.doctorReport);
          if (result.doctorReport.overall === 'error') process.exit(1);
        } catch (err: unknown) {
          if (opts.json) {
            console.log(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
            process.exit(1);
          }
          logger.error(String(err instanceof Error ? err.message : err));
          process.exit(1);
        }
      },
    ),
);

addHostOptions(
  program
    .command('run <skill>')
    .description('Run a skill')
    .option('--skip-doctor', 'Skip doctor check before running')
    .argument('[args...]', 'Arguments to pass to the skill')
    .action(async (skill: string, args: string[], opts: { skipDoctor?: boolean; host?: string; hostRoot?: string }) => {
      try {
        const result = await runSkill(skill, args, opts.skipDoctor, buildScanOptions(opts));
        process.exit(result.exitCode);
      } catch (err: unknown) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
);

program
  .command('hosts')
  .description('Manage persisted host roots')
  .addCommand(
    new Command('list').description('List effective host roots').action(async () => {
      try {
        const defaults = getDefaultHostRoots();
        const effective = await getConfiguredHostRoots();
        logger.heading('Host roots:');
        for (const host of ['invoker', 'claude', 'codex'] as RuntimeTarget[]) {
          const defaultRoot = defaults[host] ?? 'none';
          const effectiveRoot = effective[host] ?? 'none';
          const customized = effectiveRoot !== defaultRoot;
          const exists = effectiveRoot !== 'none' ? await fileExists(effectiveRoot) : false;
          console.log(`  - ${host}`);
          console.log(`      default:    ${defaultRoot}`);
          console.log(`      effective:  ${effectiveRoot}`);
          console.log(`      customized: ${customized ? 'yes' : 'no'}`);
          console.log(`      exists:     ${exists ? 'yes' : 'no'}`);
        }
      } catch (err: unknown) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    }),
  )
  .addCommand(
    new Command('set')
      .argument('<host>', 'Host name')
      .argument('<path>', 'Root path for the host')
      .description('Persist a host root override')
      .action(async (host: string, path: string) => {
        try {
          await setHostRoot(host as RuntimeTarget, path);
          const exists = await fileExists(path);
          logger.success(`Configured host root for ${host}: ${path}`);
          logger.info(`Path exists: ${exists ? 'yes' : 'no'}`);
        } catch (err: unknown) {
          logger.error(String(err instanceof Error ? err.message : err));
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command('unset')
      .argument('<host>', 'Host name')
      .description('Remove a persisted host root override')
      .action(async (host: string) => {
        try {
          await unsetHostRoot(host as RuntimeTarget);
          logger.success(`Removed host root override for ${host}`);
        } catch (err: unknown) {
          logger.error(String(err instanceof Error ? err.message : err));
          process.exit(1);
        }
      }),
  );

export { program };

if (isCliEntrypoint()) {
  program.parse();
}

function printRequirements(requires?: Awaited<ReturnType<typeof scan>>['effectiveRequires']): void {
  if (!requires) return;

  if (requires.cli?.length) {
    logger.blank();
    console.log(chalk.bold('  CLI:'));
    for (const cli of requires.cli) {
      const ver = cli.minVersion ? ` (>= ${cli.minVersion})` : '';
      const source = cli.source ? chalk.gray(` [${cli.source}]`) : '';
      console.log(`    - ${cli.name}${ver}${source}`);
      if (cli.installHint) console.log(chalk.gray(`      ${cli.installHint}`));
    }
  }

  if (requires.tokens?.length) {
    logger.blank();
    console.log(chalk.bold('  Tokens:'));
    for (const token of requires.tokens) {
      const env = token.envVar ? ` (env: ${token.envVar})` : '';
      const req = token.required !== false ? ' [required]' : ' [optional]';
      const source = token.source ? chalk.gray(` [${token.source}]`) : '';
      console.log(`    - ${token.name}${env}${req}${source}`);
    }
  }

  if (requires.env?.length) {
    logger.blank();
    console.log(chalk.bold('  Environment Variables:'));
    for (const env of requires.env) {
      const def = env.defaultValue ? ` (default: ${env.defaultValue})` : '';
      const source = env.source ? chalk.gray(` [${env.source}]`) : '';
      console.log(`    - ${env.envVar}${def}${source}`);
    }
  }

  if (requires.resources?.length) {
    logger.blank();
    console.log(chalk.bold('  Resources:'));
    for (const res of requires.resources) {
      const path = res.path ? ` → ${res.path}` : '';
      const source = res.source ? chalk.gray(` [${res.source}]`) : '';
      console.log(`    - ${res.name}${path}${source}`);
    }
  }

  if (requires.skills?.length) {
    logger.blank();
    console.log(chalk.bold('  Skills:'));
    for (const skill of requires.skills) {
      const path = skill.path ? ` → ${skill.path}` : '';
      const source = skill.source ? chalk.gray(` [${skill.source}]`) : '';
      console.log(`    - ${skill.name}${path}${source}`);
    }
  }

  if (requires.permissions?.length) {
    logger.blank();
    console.log(chalk.bold('  Permissions:'));
    for (const perm of requires.permissions) {
      console.log(`    - ${perm}`);
    }
  }
}
