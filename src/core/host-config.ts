import { resolve } from 'node:path';
import { fileExists, readTextFile, writeTextFile } from '../utils/fs.js';
import type { InvokerHostConfig, RuntimeTarget } from '../types.js';

export function getInvokerHomePath(): string {
  return resolve(process.env.HOME || process.env.USERPROFILE || '', '.invoker');
}

export function getInvokerConfigPath(): string {
  return resolve(getInvokerHomePath(), 'config.json');
}

export function getDefaultHostRoots(): Record<RuntimeTarget, string | undefined> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return {
    invoker: resolve(home, '.invoker', 'skills'),
    claude: resolve(home, '.claude', 'skills'),
    codex: resolve(home, '.codex', 'skills'),
    unknown: undefined,
  };
}

export async function loadInvokerConfig(): Promise<InvokerHostConfig> {
  const configPath = getInvokerConfigPath();
  if (!(await fileExists(configPath))) {
    return {};
  }

  const raw = await readTextFile(configPath);
  const parsed = JSON.parse(raw) as InvokerHostConfig;
  return parsed ?? {};
}

export async function saveInvokerConfig(config: InvokerHostConfig): Promise<void> {
  await writeTextFile(getInvokerConfigPath(), JSON.stringify(config, null, 2));
}

export async function getConfiguredHostRoots(): Promise<Record<RuntimeTarget, string | undefined>> {
  const config = await loadInvokerConfig();
  const defaults = getDefaultHostRoots();
  return {
    invoker: config.hosts?.invoker?.root ? resolve(config.hosts.invoker.root) : defaults.invoker,
    claude: config.hosts?.claude?.root ? resolve(config.hosts.claude.root) : defaults.claude,
    codex: config.hosts?.codex?.root ? resolve(config.hosts.codex.root) : defaults.codex,
    unknown: undefined,
  };
}

export async function getEffectiveHostRoot(host: RuntimeTarget, override?: string): Promise<string | undefined> {
  if (override) return resolve(override);
  const roots = await getConfiguredHostRoots();
  return roots[host];
}

export async function setHostRoot(host: RuntimeTarget, root: string): Promise<InvokerHostConfig> {
  const config = await loadInvokerConfig();
  const next: InvokerHostConfig = {
    ...config,
    hosts: {
      ...config.hosts,
      [host]: { root: resolve(root) },
    },
  };
  await saveInvokerConfig(next);
  return next;
}

export async function unsetHostRoot(host: RuntimeTarget): Promise<InvokerHostConfig> {
  const config = await loadInvokerConfig();
  const hosts = { ...(config.hosts ?? {}) };
  delete hosts[host];
  const next: InvokerHostConfig = { ...config, hosts };
  await saveInvokerConfig(next);
  return next;
}
