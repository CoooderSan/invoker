import which from 'which';
import { doctor } from './doctor.js';
import { install } from './installer.js';
import type { DoctorReport, InstallOptions, InstallPlan } from '../types.js';
import { runShell } from '../utils/exec.js';

export interface InvokerBootstrapCommandSet {
  installCommand: string;
  fallbackCommand: string;
}

export interface DetectInvokerCliResult {
  available: boolean;
  command: string;
  detectedPath?: string;
}

export interface EnsureInvokerCliOptions {
  command?: string;
  autoInstall?: boolean;
  installCommand?: string;
}

export interface EnsureInvokerCliResult {
  status: 'available' | 'installed' | 'missing' | 'failed';
  command: string;
  detectedPath?: string;
  installCommand: string;
  fallbackCommand: string;
  message: string;
}

export interface BootstrapSkillOptions extends InstallOptions {}

export interface BootstrapSkillResult {
  skill: string;
  installAttempted: boolean;
  installPlan?: InstallPlan;
  doctorReport: DoctorReport;
}

const DEFAULT_INVOKER_COMMAND = 'invoker';
const DEFAULT_INSTALL_COMMAND = 'npm install -g @cooodersan/invoker';
const DEFAULT_FALLBACK_COMMAND = 'npx -y @cooodersan/invoker';

export function getInvokerBootstrapCommands(): InvokerBootstrapCommandSet {
  return {
    installCommand: DEFAULT_INSTALL_COMMAND,
    fallbackCommand: DEFAULT_FALLBACK_COMMAND,
  };
}

export async function detectInvokerCli(command = DEFAULT_INVOKER_COMMAND): Promise<DetectInvokerCliResult> {
  try {
    const detectedPath = await which(command);
    return {
      available: true,
      command,
      detectedPath,
    };
  } catch {
    return {
      available: false,
      command,
    };
  }
}

export async function ensureInvokerCli(options: EnsureInvokerCliOptions = {}): Promise<EnsureInvokerCliResult> {
  const command = options.command ?? DEFAULT_INVOKER_COMMAND;
  const commands = getInvokerBootstrapCommands();
  const installCommand = options.installCommand ?? commands.installCommand;
  const fallbackCommand = commands.fallbackCommand;
  const detected = await detectInvokerCli(command);

  if (detected.available) {
    return {
      status: 'available',
      command,
      detectedPath: detected.detectedPath,
      installCommand,
      fallbackCommand,
      message: `Invoker CLI is available at ${detected.detectedPath}`,
    };
  }

  if (!options.autoInstall) {
    return {
      status: 'missing',
      command,
      installCommand,
      fallbackCommand,
      message: `Invoker CLI is not available. Install it with "${installCommand}" or use "${fallbackCommand}" for one-shot execution.`,
    };
  }

  const result = await runShell(installCommand);
  if (result.exitCode !== 0) {
    return {
      status: 'failed',
      command,
      installCommand,
      fallbackCommand,
      message: result.stderr || result.stdout || `Failed to install Invoker CLI with "${installCommand}".`,
    };
  }

  const installed = await detectInvokerCli(command);
  if (!installed.available) {
    return {
      status: 'failed',
      command,
      installCommand,
      fallbackCommand,
      message: `Ran "${installCommand}", but ${command} is still not on PATH.`,
    };
  }

  return {
    status: 'installed',
    command,
    detectedPath: installed.detectedPath,
    installCommand,
    fallbackCommand,
    message: `Installed Invoker CLI and detected it at ${installed.detectedPath}`,
  };
}

function isSkillNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Cannot find skill document');
}

export async function bootstrapSkill(skill: string, options: BootstrapSkillOptions = {}): Promise<BootstrapSkillResult> {
  let installAttempted = false;
  let installPlan: InstallPlan | undefined;
  let doctorReport: DoctorReport;

  try {
    doctorReport = await doctor(skill, options);
    if (doctorReport.overall === 'error') {
      installAttempted = true;
      installPlan = await install(skill, options);
      doctorReport = await doctor(skill, options);
    }
  } catch (error) {
    if (!isSkillNotFoundError(error)) {
      throw error;
    }

    installAttempted = true;
    installPlan = await install(skill, options);
    doctorReport = await doctor(skill, options);
  }

  return {
    skill,
    installAttempted,
    installPlan,
    doctorReport,
  };
}
