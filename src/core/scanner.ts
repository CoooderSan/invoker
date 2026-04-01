import { parse as parseYaml } from 'yaml';
import { resolve, dirname, relative } from 'node:path';
import { readTextFile, fileExists } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { getDefaultHostRoots, getEffectiveHostRoot, getConfiguredHostRoots } from './host-config.js';
import type {
  SkillManifest,
  CliRequirement,
  TokenRequirement,
  EnvRequirement,
  ResourceRequirement,
  SkillDependencyRequirement,
  InvokerSidecar,
  SkillRequirements,
  NormalizedSkill,
  RequirementSource,
  RequirementMetadata,
  RuntimeTarget,
  ResolvedSkillLocation,
  ScanOptions,
} from '../types.js';

const MANIFEST_NAMES = ['skill.yaml', 'skill.yml'];
const SIDECAR_NAMES = ['invoker.skill.yaml', 'invoker.skill.yml'];

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

export function getDefaultTargetRoots(): Record<RuntimeTarget, string | undefined> {
  return getDefaultHostRoots();
}

export async function getConfiguredTargetRoots(): Promise<Record<RuntimeTarget, string | undefined>> {
  return getConfiguredHostRoots();
}

export async function getTargetRoot(target: RuntimeTarget, override?: string): Promise<string | undefined> {
  return getEffectiveHostRoot(target, override);
}

export function listKnownTargets(): RuntimeTarget[] {
  return ['claude', 'codex', 'invoker'];
}

async function inferTargetFromPath(skillDir: string): Promise<{ target: RuntimeTarget; targetRoot?: string }> {
  const roots = await getConfiguredTargetRoots();
  for (const target of listKnownTargets()) {
    const root = roots[target];
    if (!root) continue;
    const rel = relative(root, skillDir);
    if (rel && !rel.startsWith('..') && !rel.includes('/..') && !rel.includes('\\..')) {
      return { target, targetRoot: root };
    }
  }

  return { target: 'unknown', targetRoot: undefined };
}

async function findManifestInDirectory(skillDir: string): Promise<string | null> {
  for (const name of MANIFEST_NAMES) {
    const candidate = resolve(skillDir, name);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

export async function resolveSkillLocation(skillPathOrName: string, options: ScanOptions = {}): Promise<ResolvedSkillLocation | null> {
  if (skillPathOrName.endsWith('.yaml') || skillPathOrName.endsWith('.yml')) {
    const abs = resolve(skillPathOrName);
    if (!(await fileExists(abs))) return null;
    const skillDir = dirname(abs);
    const inferred = await inferTargetFromPath(skillDir);
    return {
      manifestPath: abs,
      skillDir,
      source: 'direct_path',
      target: options.target ?? inferred.target,
      targetRoot: options.targetRoot ?? inferred.targetRoot,
    };
  }

  const directDir = resolve(skillPathOrName);
  const directManifest = await findManifestInDirectory(directDir);
  if (directManifest) {
    const inferred = await inferTargetFromPath(directDir);
    return {
      manifestPath: directManifest,
      skillDir: directDir,
      source: 'direct_path',
      target: options.target ?? inferred.target,
      targetRoot: options.targetRoot ?? inferred.targetRoot,
    };
  }

  const cwdDir = resolve(process.cwd(), skillPathOrName);
  const cwdManifest = await findManifestInDirectory(cwdDir);
  if (cwdManifest) {
    const inferred = await inferTargetFromPath(cwdDir);
    return {
      manifestPath: cwdManifest,
      skillDir: cwdDir,
      source: 'cwd',
      target: options.target ?? inferred.target,
      targetRoot: options.targetRoot ?? inferred.targetRoot,
    };
  }

  const targets = options.target ? [options.target] : listKnownTargets();
  for (const target of targets) {
    const root = await getTargetRoot(target, options.targetRoot);
    if (!root) continue;
    const manifestPath = await findManifestInDirectory(resolve(root, skillPathOrName));
    if (manifestPath) {
      return {
        manifestPath,
        skillDir: dirname(manifestPath),
        source: 'target_dir',
        target,
        targetRoot: root,
      };
    }
  }

  return null;
}

/**
 * Locate skill.yaml in a directory or by skill name in a registry path.
 */
export async function findManifest(skillPathOrName: string, options: ScanOptions = {}): Promise<string | null> {
  const resolved = await resolveSkillLocation(skillPathOrName, options);
  return resolved?.manifestPath ?? null;
}

export async function findSidecar(skillDir: string): Promise<string | null> {
  for (const name of SIDECAR_NAMES) {
    const candidate = resolve(skillDir, name);
    if (await fileExists(candidate)) return candidate;
  }

  return null;
}

/**
 * Parse a skill.yaml file into a SkillManifest.
 */
export async function parseManifest(manifestPath: string): Promise<SkillManifest> {
  const doc = await parseYamlDocument(manifestPath, 'skill.yaml');

  const manifest: SkillManifest = {
    name: doc.name ?? 'unknown',
    description: doc.description ?? '',
    version: doc.version ?? '0.0.0',
    entrypoint: doc.entrypoint,
    requires: normalizeRequirements(doc.requires, 'manifest'),
    intents: doc.intents,
  };

  return manifest;
}

export async function parseSidecar(sidecarPath: string): Promise<InvokerSidecar> {
  const doc = await parseYamlDocument(sidecarPath, 'invoker.skill.yaml');

  return {
    schemaVersion: doc.schemaVersion ?? doc.schema_version,
    requires: normalizeRequirements(doc.requires, 'sidecar'),
    notes: normalizeNotes(doc.notes),
  };
}

async function parseYamlDocument(path: string, label: string): Promise<Record<string, any>> {
  const raw = await readTextFile(path);
  const doc = parseYaml(raw);

  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid ${label} at ${path}: empty or not an object`);
  }

  return doc as Record<string, any>;
}

function normalizeNotes(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return [raw];
  return undefined;
}

/**
 * Normalize the `requires` block from YAML into strongly typed objects.
 * Supports both shorthand (string array) and verbose (object array) formats.
 */
function normalizeRequirements(raw: unknown, source: RequirementSource): SkillRequirements | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const r = raw as Record<string, unknown>;

  return cleanRequirements({
    cli: normalizeCli(r.cli, source),
    tokens: normalizeTokens(r.tokens, source),
    env: normalizeEnv(r.env, source),
    resources: normalizeResources(r.resources, source),
    skills: normalizeSkills(r.skills, source),
    permissions: Array.isArray(r.permissions) ? Array.from(new Set(r.permissions.map(String))) : undefined,
  });
}

function normalizeCli(raw: unknown, source: RequirementSource): CliRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, command: item, source } as CliRequirement;
    }

    return {
      name: item.name,
      command: item.command ?? item.name,
      versionCommand: item.versionCommand ?? item.version_command,
      versionPattern: item.versionPattern ?? item.version_pattern,
      minVersion: item.minVersion ?? item.min_version,
      installHint: item.installHint ?? item.install_hint,
      installCommand: item.installCommand ?? item.install_command,
      source,
    } as CliRequirement;
  });
}

function normalizeTokens(raw: unknown, source: RequirementSource): TokenRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, envVar: item, required: true, source } as TokenRequirement;
    }

    return {
      name: item.name,
      envVar: item.envVar ?? item.env_var ?? item.env,
      description: item.description,
      required: item.required ?? true,
      validationUrl: item.validationUrl ?? item.validation_url,
      source,
    } as TokenRequirement;
  });
}

function normalizeEnv(raw: unknown, source: RequirementSource): EnvRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, envVar: item, required: true, source } as EnvRequirement;
    }

    return {
      name: item.name,
      envVar: item.envVar ?? item.env_var ?? item.env,
      description: item.description,
      required: item.required ?? true,
      defaultValue: item.defaultValue ?? item.default_value ?? item.default,
      source,
    } as EnvRequirement;
  });
}

function normalizeResources(raw: unknown, source: RequirementSource): ResourceRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, source } as ResourceRequirement;
    }

    return {
      name: item.name,
      path: item.path,
      description: item.description,
      templateUrl: item.templateUrl ?? item.template_url,
      template: item.template,
      source,
    } as ResourceRequirement;
  });
}

function normalizeSkills(raw: unknown, source: RequirementSource): SkillDependencyRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, required: true, source } as SkillDependencyRequirement;
    }

    return {
      name: item.name,
      path: item.path,
      description: item.description,
      required: item.required ?? true,
      source,
    } as SkillDependencyRequirement;
  });
}

function cleanRequirements(requirements: SkillRequirements): SkillRequirements | undefined {
  const cleaned: SkillRequirements = {
    cli: requirements.cli?.length ? requirements.cli : undefined,
    tokens: requirements.tokens?.length ? requirements.tokens : undefined,
    env: requirements.env?.length ? requirements.env : undefined,
    resources: requirements.resources?.length ? requirements.resources : undefined,
    skills: requirements.skills?.length ? requirements.skills : undefined,
    permissions: requirements.permissions?.length ? requirements.permissions : undefined,
  };

  return hasRequirements(cleaned) ? cleaned : undefined;
}

function mergeRequirements(manifest?: SkillRequirements, sidecar?: SkillRequirements): SkillRequirements | undefined {
  if (!manifest && !sidecar) return undefined;
  if (!manifest) return cleanRequirements({ ...(sidecar as SkillRequirements) });
  if (!sidecar) return cleanRequirements({ ...(manifest as SkillRequirements) });

  return cleanRequirements({
    cli: mergeRequirementList(manifest.cli, sidecar.cli, (item) => item.name),
    tokens: mergeRequirementList(manifest.tokens, sidecar.tokens, (item) => item.envVar ?? item.name),
    env: mergeRequirementList(manifest.env, sidecar.env, (item) => item.envVar),
    resources: mergeRequirementList(manifest.resources, sidecar.resources, (item) => item.path ?? item.name),
    skills: mergeRequirementList(manifest.skills, sidecar.skills, (item) => item.path ?? item.name),
    permissions: mergePermissions(manifest.permissions, sidecar.permissions),
  });
}

function mergeRequirementList<T extends RequirementMetadata>(
  manifestItems: T[] | undefined,
  sidecarItems: T[] | undefined,
  getKey: (item: T) => string,
): T[] | undefined {
  if (!manifestItems?.length && !sidecarItems?.length) return undefined;

  const merged = new Map<string, T>();

  for (const item of manifestItems ?? []) {
    merged.set(getKey(item), { ...item });
  }

  for (const item of sidecarItems ?? []) {
    const key = getKey(item);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, ...item, source: 'merged' } as T);
    } else {
      merged.set(key, { ...item });
    }
  }

  return Array.from(merged.values());
}

function mergePermissions(manifest: string[] | undefined, sidecar: string[] | undefined): string[] | undefined {
  if (!manifest?.length && !sidecar?.length) return undefined;
  return Array.from(new Set([...(manifest ?? []), ...(sidecar ?? [])]));
}

export function hasRequirements(requires?: SkillRequirements): boolean {
  return Boolean(
    requires?.cli?.length ||
      requires?.tokens?.length ||
      requires?.env?.length ||
      requires?.resources?.length ||
      requires?.skills?.length ||
      requires?.permissions?.length,
  );
}

/**
 * High-level scan: find manifest, parse sidecar, merge requirements, and return a normalized skill view.
 */
export async function scan(skillPathOrName: string, options: ScanOptions = {}): Promise<NormalizedSkill> {
  const location = await resolveSkillLocation(skillPathOrName, options);
  if (!location) {
    throw new Error(
      `Cannot find skill.yaml for "${skillPathOrName}". Searched in current directory, explicit path, and configured runtime targets.`,
    );
  }

  logger.debug(`Found manifest at ${location.manifestPath}`);
  const manifest = await parseManifest(location.manifestPath);
  const dir = location.skillDir;
  const sidecarPath = await findSidecar(dir);
  const sidecar = sidecarPath ? await parseSidecar(sidecarPath) : undefined;
  const effectiveRequires = mergeRequirements(manifest.requires, sidecar?.requires);

  return {
    manifest,
    sidecar,
    effectiveRequires,
    manifestPath: location.manifestPath,
    sidecarPath: sidecarPath ?? undefined,
    dir,
    target: location.target,
    targetRoot: location.targetRoot,
    resolutionSource: location.source,
    location,
  };
}
