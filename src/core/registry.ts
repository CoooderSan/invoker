import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { readTextFile, writeTextFile, fileExists, resolveRequirementPath } from '../utils/fs.js';
import { scan, getTargetRoot, listKnownTargets } from './scanner.js';
import { getInvokerHomePath } from './host-config.js';
import { doctor, formatDoctorSummary } from './doctor.js';
import type {
  SkillRegistry,
  InstalledSkill,
  RuntimeTarget,
  ScanOptions,
  SkillDependencyRequirement,
  InstallStep,
} from '../types.js';

function getRegistryFilePath(): string {
  return resolve(getInvokerHomePath(), 'registry.json');
}

function getLegacySkillsDirPath(): string {
  return resolve(getInvokerHomePath(), 'skills');
}

export async function loadRegistry(): Promise<SkillRegistry> {
  const registryFile = getRegistryFilePath();
  if (await fileExists(registryFile)) {
    const raw = await readTextFile(registryFile);
    return JSON.parse(raw) as SkillRegistry;
  }
  return { skills: [] };
}

export async function saveRegistry(registry: SkillRegistry): Promise<void> {
  await writeTextFile(getRegistryFilePath(), JSON.stringify(registry, null, 2));
}

export async function registerSkillFromPath(skillPathOrName: string, options: ScanOptions = {}): Promise<InstalledSkill> {
  const normalized = await scan(skillPathOrName, options);
  const { manifest, dir, manifestPath, sidecarPath, target, targetRoot } = normalized;

  const registry = await loadRegistry();
  const existing = registry.skills.findIndex((s) => s.path === dir || (s.name === manifest.name && s.target === target));

  const entry: InstalledSkill = {
    name: manifest.name,
    version: manifest.version,
    path: dir,
    installedAt: existing >= 0 ? registry.skills[existing].installedAt : new Date().toISOString(),
    status: 'warning',
    target,
    targetRoot,
    managedInPlace: target !== 'invoker',
    manifestPath,
    sidecarPath,
    lastScannedAt: new Date().toISOString(),
    lastStatusSummary: 'registered, not yet checked',
  };

  if (existing >= 0) {
    registry.skills[existing] = { ...registry.skills[existing], ...entry };
  } else {
    registry.skills.push(entry);
  }

  await saveRegistry(registry);
  return entry;
}

export async function registerDependentSkill(
  requirement: SkillDependencyRequirement,
  parentSkillDir: string,
  options: ScanOptions = {},
): Promise<InstalledSkill> {
  const lookup = requirement.path ? resolveRequirementPath(requirement.path, parentSkillDir) : requirement.name;
  const normalized = await scan(lookup, options);
  return registerSkillFromPath(normalized.dir, { target: normalized.target, targetRoot: normalized.targetRoot });
}

export async function planDependentSkillRegistrations(
  requirements: SkillDependencyRequirement[] | undefined,
  parentSkillDir: string,
  options: ScanOptions = {},
): Promise<InstallStep[]> {
  if (!requirements?.length) return [];

  const registry = await loadRegistry();
  const seen = new Set<string>();
  const steps: InstallStep[] = [];

  for (const requirement of requirements) {
    try {
      const lookup = requirement.path ? resolveRequirementPath(requirement.path, parentSkillDir) : requirement.name;
      const normalized = await scan(lookup, options);
      const registered = registry.skills.some(
        (entry) => entry.path === normalized.dir || (entry.name === normalized.manifest.name && entry.target === normalized.target),
      );
      if (registered) continue;

      const key = `${normalized.target}:${normalized.dir}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const hostHint = normalized.target !== 'unknown' ? ` in host ${normalized.target}` : '';
      steps.push({
        type: 'skill',
        name: requirement.name,
        action: 'register',
        operation: 'register',
        description: `Register dependent skill${hostHint}: ${requirement.name}`,
        status: 'pending',
        mode: 'auto',
        source: requirement.source,
        remediation:
          normalized.target !== 'unknown'
            ? `Run invoker install ${requirement.name} --host ${normalized.target} to register it explicitly if needed`
            : `Register dependent skill ${requirement.name}`,
        path: normalized.dir,
        host: normalized.target,
      });
    } catch {
      // No local source available; leave this to doctor/install manual remediation.
    }
  }

  return steps;
}

export async function registerSkill(name: string, version: string, path: string, target: RuntimeTarget = 'invoker'): Promise<void> {
  const registry = await loadRegistry();
  const existing = registry.skills.findIndex((s) => s.name === name && s.target === target);
  const targetRoot = await getTargetRoot(target);

  const entry: InstalledSkill = {
    name,
    version,
    path,
    installedAt: new Date().toISOString(),
    status: 'ok',
    target,
    targetRoot,
    managedInPlace: target !== 'invoker',
  };

  if (existing >= 0) {
    registry.skills[existing] = { ...registry.skills[existing], ...entry };
  } else {
    registry.skills.push(entry);
  }

  await saveRegistry(registry);
}

export async function unregisterSkill(name: string, target?: RuntimeTarget): Promise<boolean> {
  const registry = await loadRegistry();
  const before = registry.skills.length;
  registry.skills = registry.skills.filter((s) => s.name !== name || (target && s.target !== target));
  if (registry.skills.length < before) {
    await saveRegistry(registry);
    return true;
  }
  return false;
}

async function discoverSkillsInTarget(
  registry: SkillRegistry,
  target: RuntimeTarget,
  root: string,
  options: ScanOptions = {},
): Promise<void> {
  if (!(await fileExists(root))) return;

  try {
    const dirs = await readdir(root, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillDir = resolve(root, dir.name);
      const alreadyRegistered = registry.skills.some((s) => s.target === target && s.path === skillDir);
      if (alreadyRegistered) continue;

      try {
        const normalized = await scan(skillDir, { ...options, target, targetRoot: root });
        registry.skills.push({
          name: normalized.manifest.name,
          version: normalized.manifest.version,
          path: skillDir,
          installedAt: 'discovered',
          status: 'warning',
          target,
          targetRoot: root,
          managedInPlace: target !== 'invoker',
          manifestPath: normalized.manifestPath,
          sidecarPath: normalized.sidecarPath,
          lastScannedAt: new Date().toISOString(),
          lastStatusSummary: 'discovered but not checked yet',
        });
      } catch {
        // Not a valid skill directory, skip
      }
    }
  } catch {
    // Skills dir doesn't exist or not readable
  }
}

/**
 * List all installed skills, refreshing their status via doctor.
 */
export async function listSkills(refresh = false, options: ScanOptions = {}): Promise<InstalledSkill[]> {
  const registry = await loadRegistry();
  const targets = options.target ? [options.target] : listKnownTargets();

  for (const target of targets) {
    const root = await getTargetRoot(target, options.target === target ? options.targetRoot : undefined);
    if (!root) continue;
    await discoverSkillsInTarget(registry, target, root, options);
  }

  if (refresh) {
    for (const skill of registry.skills) {
      if (options.target && skill.target !== options.target) continue;
      try {
        const normalized = await scan(skill.path, { target: skill.target, targetRoot: skill.targetRoot });
        const report = await doctor(skill.path, { target: skill.target, targetRoot: skill.targetRoot });
        skill.status = report.overall;
        skill.target = normalized.target;
        skill.targetRoot = normalized.targetRoot;
        skill.managedInPlace = normalized.target !== 'invoker';
        skill.manifestPath = normalized.manifestPath;
        skill.sidecarPath = normalized.sidecarPath;
        skill.lastScannedAt = new Date().toISOString();
        skill.lastDoctorAt = report.timestamp;
        skill.lastStatusSummary = formatDoctorSummary(report);
      } catch {
        skill.status = 'error';
        skill.lastDoctorAt = new Date().toISOString();
        skill.lastStatusSummary = 'failed to inspect skill';
      }
    }
    await saveRegistry(registry);
  }

  return options.target ? registry.skills.filter((skill) => skill.target === options.target) : registry.skills;
}

export async function getSkillInfo(skillPathOrName: string, options: ScanOptions = {}): Promise<{
  manifest: Awaited<ReturnType<typeof scan>>['manifest'];
  sidecar: Awaited<ReturnType<typeof scan>>['sidecar'];
  effectiveRequires: Awaited<ReturnType<typeof scan>>['effectiveRequires'];
  dir: string;
  manifestPath: string;
  sidecarPath?: string;
  target: RuntimeTarget;
  targetRoot?: string;
  registered: boolean;
  registryEntry?: InstalledSkill;
}> {
  const normalized = await scan(skillPathOrName, options);
  const registry = await loadRegistry();
  const registryEntry = registry.skills.find((s) => (s.name === normalized.manifest.name && s.target === normalized.target) || s.path === normalized.dir);
  const registered = !!registryEntry;
  return {
    manifest: normalized.manifest,
    sidecar: normalized.sidecar,
    effectiveRequires: normalized.effectiveRequires,
    dir: normalized.dir,
    manifestPath: normalized.manifestPath,
    sidecarPath: normalized.sidecarPath,
    target: normalized.target,
    targetRoot: normalized.targetRoot,
    registered,
    registryEntry,
  };
}

export async function getSkillsDir(target: RuntimeTarget = 'invoker'): Promise<string | undefined> {
  if (target === 'invoker') return getLegacySkillsDirPath();
  return getTargetRoot(target);
}

export function getInvokerHome(): string {
  return getInvokerHomePath();
}
