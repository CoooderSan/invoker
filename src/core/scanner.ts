import { parse as parseYaml } from 'yaml';
import { resolve, dirname, relative, basename } from 'node:path';
import { readdir } from 'node:fs/promises';
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
  SettingRequirement,
  HostConfigRequirement,
  InvokerSidecar,
  SkillRequirements,
  NormalizedSkill,
  RequirementSource,
  RequirementMetadata,
  RuntimeTarget,
  ResolvedSkillLocation,
  ScanOptions,
  TrustConfig,
  TrustCheckerConfig,
  ScanWarning,
  SkillDocumentFormat,
} from '../types.js';

const PRIMARY_DOC_NAMES = ['SKILL.md'];
const MANIFEST_NAMES = ['skill.yaml', 'skill.yml'];
const SIDECAR_NAMES = ['invoker.skill.yaml', 'invoker.skill.yml'];

interface ParsedPrimaryDocument {
  manifest: SkillManifest;
  sidecar?: InvokerSidecar;
}

interface PrimaryDocumentLocation {
  path: string;
  format: SkillDocumentFormat;
}

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

function inferDocumentFormat(path: string): SkillDocumentFormat {
  return basename(path) === 'SKILL.md' ? 'markdown' : 'yaml';
}

function isDirectSkillDocumentPath(skillPathOrName: string): boolean {
  return basename(skillPathOrName) === 'SKILL.md' || skillPathOrName.endsWith('.yaml') || skillPathOrName.endsWith('.yml');
}

export async function findPrimaryDocInDirectory(skillDir: string): Promise<PrimaryDocumentLocation | null> {
  for (const name of PRIMARY_DOC_NAMES) {
    const candidate = resolve(skillDir, name);
    if (await fileExists(candidate)) {
      return { path: candidate, format: 'markdown' };
    }
  }

  for (const name of MANIFEST_NAMES) {
    const candidate = resolve(skillDir, name);
    if (await fileExists(candidate)) {
      return { path: candidate, format: 'yaml' };
    }
  }

  return null;
}

async function findManifestInDirectory(skillDir: string): Promise<string | null> {
  const primary = await findPrimaryDocInDirectory(skillDir);
  return primary?.path ?? null;
}

async function findLegacyManifest(skillDir: string): Promise<string | null> {
  for (const name of MANIFEST_NAMES) {
    const candidate = resolve(skillDir, name);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => resolve(path, entry.name));
  } catch {
    return [];
  }
}

async function getClaudeInstalledPluginRoots(): Promise<string[]> {
  const home = getHomeDir();
  if (!home) return [];

  const installedPluginsPath = resolve(home, '.claude', 'plugins', 'installed_plugins.json');
  if (await fileExists(installedPluginsPath)) {
    try {
      const raw = await readTextFile(installedPluginsPath);
      const parsed = JSON.parse(raw) as { plugins?: Record<string, Array<{ installPath?: string }>> };
      const roots = new Set<string>();

      for (const installs of Object.values(parsed.plugins ?? {})) {
        for (const install of installs ?? []) {
          if (install?.installPath) roots.add(resolve(install.installPath));
        }
      }

      if (roots.size > 0) return Array.from(roots);
    } catch {
      logger.debug(`Failed to parse Claude installed plugins index at ${installedPluginsPath}; falling back to cache scan.`);
    }
  }

  const cacheRoot = resolve(home, '.claude', 'plugins', 'cache');
  const marketplaceDirs = await listDirectories(cacheRoot);
  const pluginRoots: string[] = [];
  for (const marketplaceDir of marketplaceDirs) {
    for (const pluginDir of await listDirectories(marketplaceDir)) {
      pluginRoots.push(...(await listDirectories(pluginDir)));
    }
  }
  return pluginRoots;
}

async function getCodexInstalledPluginRoots(): Promise<string[]> {
  const home = getHomeDir();
  if (!home) return [];

  const candidateRoots = [
    resolve(home, '.codex', '.tmp', 'plugins', 'plugins'),
    resolve(home, '.codex', 'plugins', 'cache'),
  ];
  const pluginRoots: string[] = [];
  for (const candidateRoot of candidateRoots) {
    pluginRoots.push(...(await listDirectories(candidateRoot)));
  }
  return pluginRoots;
}

async function getInstalledPluginRoots(target: RuntimeTarget): Promise<string[]> {
  if (target === 'claude') return getClaudeInstalledPluginRoots();
  if (target === 'codex') return getCodexInstalledPluginRoots();
  return [];
}

async function resolveInstalledPluginSkill(skillName: string, target: RuntimeTarget): Promise<ResolvedSkillLocation | null> {
  const pluginRoots = await getInstalledPluginRoots(target);
  for (const pluginRoot of pluginRoots) {
    const skillDir = resolve(pluginRoot, 'skills', skillName);
    const primary = await findPrimaryDocInDirectory(skillDir);
    if (!primary) continue;

    return {
      manifestPath: primary.path,
      primaryDocPath: primary.path,
      primaryDocFormat: primary.format,
      skillDir,
      source: 'plugin_cache',
      target,
      targetRoot: pluginRoot,
    };
  }

  return null;
}

export async function resolveSkillLocation(skillPathOrName: string, options: ScanOptions = {}): Promise<ResolvedSkillLocation | null> {
  if (isDirectSkillDocumentPath(skillPathOrName)) {
    const abs = resolve(skillPathOrName);
    if (!(await fileExists(abs))) return null;
    const skillDir = dirname(abs);
    const inferred = await inferTargetFromPath(skillDir);
    const format = inferDocumentFormat(abs);
    return {
      manifestPath: abs,
      primaryDocPath: abs,
      primaryDocFormat: format,
      skillDir,
      source: 'direct_path',
      target: options.target ?? inferred.target,
      targetRoot: options.targetRoot ?? inferred.targetRoot,
    };
  }

  const directDir = resolve(skillPathOrName);
  const directPrimary = await findPrimaryDocInDirectory(directDir);
  if (directPrimary) {
    const inferred = await inferTargetFromPath(directDir);
    return {
      manifestPath: directPrimary.path,
      primaryDocPath: directPrimary.path,
      primaryDocFormat: directPrimary.format,
      skillDir: directDir,
      source: 'direct_path',
      target: options.target ?? inferred.target,
      targetRoot: options.targetRoot ?? inferred.targetRoot,
    };
  }

  const cwdDir = resolve(process.cwd(), skillPathOrName);
  const cwdPrimary = await findPrimaryDocInDirectory(cwdDir);
  if (cwdPrimary) {
    const inferred = await inferTargetFromPath(cwdDir);
    return {
      manifestPath: cwdPrimary.path,
      primaryDocPath: cwdPrimary.path,
      primaryDocFormat: cwdPrimary.format,
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
    const primary = await findPrimaryDocInDirectory(resolve(root, skillPathOrName));
    if (primary) {
      return {
        manifestPath: primary.path,
        primaryDocPath: primary.path,
        primaryDocFormat: primary.format,
        skillDir: dirname(primary.path),
        source: 'target_dir',
        target,
        targetRoot: root,
      };
    }
  }

  if (!options.targetRoot) {
    for (const target of targets) {
      const resolved = await resolveInstalledPluginSkill(skillPathOrName, target);
      if (resolved) return resolved;
    }
  }

  return null;
}

/**
 * Locate the primary skill document in a directory or by skill name in a registry path.
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
 * Parse the primary skill document into a SkillManifest.
 */
export async function parseManifest(manifestPath: string): Promise<SkillManifest> {
  const parsed = await parsePrimaryDocument(manifestPath, inferDocumentFormat(manifestPath));
  return parsed.manifest;
}

export async function parseSidecar(sidecarPath: string): Promise<InvokerSidecar> {
  const doc = await parseYamlDocument(sidecarPath, 'invoker.skill.yaml');

  return {
    schemaVersion: doc.schemaVersion ?? doc.schema_version,
    requires: normalizeRequirements(doc.requires, 'sidecar'),
    trust: normalizeTrust(doc.trust),
    notes: normalizeNotes(doc.notes),
  };
}

async function parsePrimaryDocument(path: string, format: SkillDocumentFormat): Promise<ParsedPrimaryDocument> {
  if (format === 'markdown') {
    return parseMarkdownSkillDocument(path);
  }

  const doc = await parseYamlDocument(path, 'skill.yaml');
  return {
    manifest: normalizeManifestDocument(doc),
  };
}

async function parseMarkdownSkillDocument(path: string): Promise<ParsedPrimaryDocument> {
  const doc = await parseFrontmatterDocument(path);
  const manifest = normalizeManifestDocument(doc);
  const trust = normalizeTrust(doc.trust);
  const notes = normalizeNotes(doc.notes);

  return {
    manifest,
    sidecar: trust || notes ? { trust, notes } : undefined,
  };
}

function normalizeManifestDocument(doc: Record<string, any>): SkillManifest {
  return {
    name: doc.name ?? 'unknown',
    description: doc.description ?? '',
    version: doc.version ?? '0.0.0',
    entrypoint: doc.entrypoint,
    requires: normalizeRequirements(doc.requires, 'manifest'),
    intents: doc.intents,
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

async function parseFrontmatterDocument(path: string): Promise<Record<string, any>> {
  const raw = (await readTextFile(path)).replace(/^\uFEFF/, '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    throw new Error(`Invalid SKILL.md at ${path}: missing YAML frontmatter`);
  }

  const doc = parseYaml(match[1]);
  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid SKILL.md at ${path}: frontmatter is empty or not an object`);
  }

  return doc as Record<string, any>;
}

function normalizeNotes(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return [raw];
  return undefined;
}

function normalizeTrust(raw: unknown): TrustConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const trust = raw as Record<string, unknown>;
  const checkers = normalizeTrustCheckers(trust.checkers);
  if (!checkers?.length) return undefined;
  return { checkers };
}

function normalizeTrustCheckers(raw: unknown): TrustCheckerConfig[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, skill: item, required: false } as TrustCheckerConfig;
    }

    return {
      name: item.name,
      skill: item.skill ?? item.name,
      target: item.target,
      args: Array.isArray(item.args) ? item.args.map(String) : undefined,
      required: item.required ?? false,
      timeoutMs: item.timeoutMs ?? item.timeout_ms,
    } as TrustCheckerConfig;
  });
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
    settings: normalizeSettings(r.settings, source),
    hostConfig: normalizeHostConfig(r.hostConfig ?? r.host_config, source),
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

function normalizeSettings(raw: unknown, source: RequirementSource): SettingRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { key: item, required: true, source } as SettingRequirement;
    }

    return {
      key: item.key,
      host: item.host,
      description: item.description,
      required: item.required ?? true,
      expectedValue: item.expectedValue ?? item.expected_value,
      source,
    } as SettingRequirement;
  });
}

function normalizeHostConfig(raw: unknown, source: RequirementSource): HostConfigRequirement[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;

  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, kind: 'root_exists', required: true, source } as HostConfigRequirement;
    }

    return {
      name: item.name ?? item.kind ?? 'host-config',
      host: item.host,
      kind: item.kind ?? 'root_exists',
      description: item.description,
      required: item.required ?? true,
      source,
    } as HostConfigRequirement;
  });
}

function cleanRequirements(requirements: SkillRequirements): SkillRequirements | undefined {
  const cleaned: SkillRequirements = {
    cli: requirements.cli?.length ? requirements.cli : undefined,
    tokens: requirements.tokens?.length ? requirements.tokens : undefined,
    env: requirements.env?.length ? requirements.env : undefined,
    resources: requirements.resources?.length ? requirements.resources : undefined,
    skills: requirements.skills?.length ? requirements.skills : undefined,
    settings: requirements.settings?.length ? requirements.settings : undefined,
    hostConfig: requirements.hostConfig?.length ? requirements.hostConfig : undefined,
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
    settings: mergeRequirementList(manifest.settings, sidecar.settings, (item) => `${item.host ?? 'any'}:${item.key}`),
    hostConfig: mergeRequirementList(manifest.hostConfig, sidecar.hostConfig, (item) => `${item.host ?? 'any'}:${item.kind}:${item.name}`),
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
      requires?.settings?.length ||
      requires?.hostConfig?.length ||
      requires?.permissions?.length,
  );
}

function mergeNotes(primaryNotes: string[] | undefined, sidecarNotes: string[] | undefined): string[] | undefined {
  if (!primaryNotes?.length && !sidecarNotes?.length) return undefined;
  return Array.from(new Set([...(primaryNotes ?? []), ...(sidecarNotes ?? [])]));
}

function mergeSidecars(primarySidecar: InvokerSidecar | undefined, yamlSidecar: InvokerSidecar | undefined): InvokerSidecar | undefined {
  if (!primarySidecar && !yamlSidecar) return undefined;

  return {
    schemaVersion: yamlSidecar?.schemaVersion,
    requires: yamlSidecar?.requires,
    trust: primarySidecar?.trust ?? yamlSidecar?.trust,
    notes: mergeNotes(primarySidecar?.notes, yamlSidecar?.notes),
  };
}

function buildScanWarnings(
  primaryDocPath: string,
  primaryDocFormat: SkillDocumentFormat,
  legacyManifestPath: string | null,
  sidecarPath: string | null,
): ScanWarning[] {
  const warnings: ScanWarning[] = [];

  if (primaryDocFormat === 'yaml') {
    warnings.push({
      code: 'legacy_yaml',
      message: 'Using legacy YAML skill document. Prefer SKILL.md frontmatter as the primary skill document.',
      paths: [primaryDocPath, ...(sidecarPath ? [sidecarPath] : [])],
    });
  }

  if (primaryDocFormat === 'markdown' && legacyManifestPath) {
    warnings.push({
      code: 'duplicate_primary_doc',
      message: 'SKILL.md takes precedence over legacy skill.yaml/skill.yml files; legacy YAML is ignored except for compatibility review.',
      paths: [primaryDocPath, legacyManifestPath],
    });
  }

  return warnings;
}

/**
 * High-level scan: find the primary skill document, parse metadata, and return a normalized skill view.
 */
export async function scan(skillPathOrName: string, options: ScanOptions = {}): Promise<NormalizedSkill> {
  const location = await resolveSkillLocation(skillPathOrName, options);
  if (!location) {
    throw new Error(
      `Cannot find skill document (SKILL.md, skill.yaml, or skill.yml) for "${skillPathOrName}". Searched in current directory, explicit path, and configured runtime targets.`,
    );
  }

  logger.debug(`Found primary skill document at ${location.primaryDocPath}`);
  const parsedPrimary = await parsePrimaryDocument(location.primaryDocPath, location.primaryDocFormat);
  const dir = location.skillDir;
  const legacyManifestPath = location.primaryDocFormat === 'markdown' ? await findLegacyManifest(dir) : null;
  const sidecarPath = await findSidecar(dir);
  const yamlSidecar = sidecarPath ? await parseSidecar(sidecarPath) : undefined;
  const sidecar = mergeSidecars(parsedPrimary.sidecar, yamlSidecar);
  const effectiveRequires = mergeRequirements(parsedPrimary.manifest.requires, yamlSidecar?.requires);

  return {
    manifest: parsedPrimary.manifest,
    sidecar,
    effectiveRequires,
    trust: sidecar?.trust,
    manifestPath: location.manifestPath,
    sidecarPath: sidecarPath ?? undefined,
    primaryDocPath: location.primaryDocPath,
    primaryDocFormat: location.primaryDocFormat,
    warnings: buildScanWarnings(location.primaryDocPath, location.primaryDocFormat, legacyManifestPath, sidecarPath),
    dir,
    target: location.target,
    targetRoot: location.targetRoot,
    resolutionSource: location.source,
    location,
  };
}
