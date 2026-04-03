import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rename, rm, cp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { URL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { run } from '../utils/exec.js';
import { fileExists } from '../utils/fs.js';
import { parseManifest as parseSkillManifest } from './scanner.js';
import type { RemoteInstallRequest, RemoteSkillPackage, RemoteSourceConfig } from '../types.js';

interface RemotePackagePreview {
  pkg: RemoteSkillPackage;
  skillDir: string;
  cleanup: () => Promise<void>;
}

export interface RemoteInstallResult {
  package: RemoteSkillPackage;
  targetDir: string;
  status: 'installed' | 'updated' | 'noop';
}

const MANIFEST_FILES = ['SKILL.md', 'skill.yaml', 'skill.yml'];

export async function resolveRemoteSkillPackage(
  skill: string,
  version: string | undefined,
  source: RemoteSourceConfig,
): Promise<RemoteSkillPackage> {
  if (source.type !== 'http_index') {
    throw new Error(`Unsupported source type "${source.type}" for source "${source.name}"`);
  }

  const metadataUrl = buildMetadataUrl(source.indexUrlTemplate, skill, version);
  const payload = await fetchJson(metadataUrl, source);
  const normalized = normalizeRemotePackage(payload, { requestedSkill: skill, requestedVersion: version, metadataUrl });

  if (normalized.name !== skill) {
    throw new Error(
      `Remote package name mismatch for source "${source.name}": requested "${skill}" but got "${normalized.name}"`,
    );
  }

  return normalized;
}

export async function previewRemoteSkill(
  request: RemoteInstallRequest,
  source: RemoteSourceConfig,
): Promise<RemotePackagePreview> {
  const pkg = await resolveRemoteSkillPackage(request.skill, request.version, source);
  const tempRoot = await mkdtemp(join(tmpdir(), 'invoker-remote-preview-'));
  const archivePath = join(tempRoot, archiveFileName(pkg.downloadUrl));
  const extractRoot = join(tempRoot, 'extract');

  try {
    await downloadToFile(pkg.downloadUrl, archivePath, source);

    if (pkg.sha256) {
      const digest = await computeSha256(archivePath);
      if (digest !== pkg.sha256.toLowerCase()) {
        throw new Error(
          `Checksum mismatch for "${request.skill}": expected ${pkg.sha256.toLowerCase()} but got ${digest}`,
        );
      }
    }

    await mkdir(extractRoot, { recursive: true });
    await extractArchive(archivePath, extractRoot);
    const skillDir = await locateSkillDirectory(extractRoot, request.skill);

    return {
      pkg,
      skillDir,
      cleanup: async () => {
        await rm(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function installRemoteSkill(
  request: RemoteInstallRequest,
  source: RemoteSourceConfig,
): Promise<RemoteInstallResult> {
  const preview = await previewRemoteSkill(request, source);
  const targetDir = resolve(request.targetRoot, request.skill);
  const stagingDir = resolve(request.targetRoot, `.${request.skill}.staging-${randomUUID()}`);

  try {
    await mkdir(request.targetRoot, { recursive: true });

    const targetExists = await fileExists(targetDir);
    const existingManifestPath = await findManifestPath(targetDir);

    if (targetExists && !existingManifestPath && !request.force) {
      throw new Error(
        `Target path ${targetDir} already exists and does not look like a managed skill directory. Use --force to replace it.`,
      );
    }

    if (existingManifestPath) {
      const existingManifest = await parseManifest(existingManifestPath);
      if (existingManifest.name !== request.skill) {
        if (!request.force) {
          throw new Error(
            `Target path already exists with manifest name "${existingManifest.name}". Use --force to replace it.`,
          );
        }
      } else if (existingManifest.version === preview.pkg.version) {
        await preview.cleanup();
        return {
          package: preview.pkg,
          targetDir,
          status: 'noop',
        };
      } else if (!request.force) {
        throw new Error(
          `Skill "${request.skill}" already exists at ${targetDir} with version ${existingManifest.version}. Use --force to replace it with ${preview.pkg.version}.`,
        );
      }
    }

    await cp(preview.skillDir, stagingDir, { recursive: true });

    if (targetExists) {
      const backupDir = resolve(request.targetRoot, `.${request.skill}.backup-${randomUUID()}`);
      await rename(targetDir, backupDir);
      try {
        await rename(stagingDir, targetDir);
        await rm(backupDir, { recursive: true, force: true });
      } catch (error) {
        await rename(backupDir, targetDir).catch(() => {
          // best effort rollback
        });
        throw error;
      }

      return {
        package: preview.pkg,
        targetDir,
        status: 'updated',
      };
    }

    await rename(stagingDir, targetDir);
    return {
      package: preview.pkg,
      targetDir,
      status: 'installed',
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {
      // ignore staging cleanup failure
    });
    await preview.cleanup();
  }
}

function buildMetadataUrl(template: string, skill: string, version?: string): string {
  if (template.includes('{version}') && !version) {
    throw new Error('Source indexUrlTemplate requires {version}, but --version was not provided');
  }

  return template
    .replaceAll('{name}', encodeURIComponent(skill))
    .replaceAll('{version}', encodeURIComponent(version ?? ''));
}

async function fetchJson(url: string, source: RemoteSourceConfig): Promise<unknown> {
  const response = await fetchWithTimeout(url, source, { headers: buildSourceHeaders(source) });
  if (!response.ok) {
    throw new Error(`Failed to fetch remote metadata from ${url}: HTTP ${response.status}`);
  }

  return response.json();
}

function normalizeRemotePackage(
  raw: unknown,
  context: { requestedSkill: string; requestedVersion?: string; metadataUrl: string },
): RemoteSkillPackage {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid remote metadata at ${context.metadataUrl}: expected JSON object`);
  }

  const payload = raw as Record<string, unknown>;
  const direct = normalizePackageCandidate(payload, payload.name, context.metadataUrl);
  if (direct) {
    return validateRequestedVersion(direct, context.requestedVersion);
  }

  const versions = Array.isArray(payload.versions) ? payload.versions : undefined;
  if (versions?.length) {
    const normalized = versions
      .map((item) => normalizePackageCandidate(item as Record<string, unknown>, payload.name, context.metadataUrl))
      .filter((item): item is RemoteSkillPackage => Boolean(item));

    if (!normalized.length) {
      throw new Error(`Invalid versions[] in remote metadata at ${context.metadataUrl}`);
    }

    const selected = context.requestedVersion
      ? normalized.find((item) => item.version === context.requestedVersion)
      : normalized[0];

    if (!selected) {
      throw new Error(
        `Version "${context.requestedVersion}" was not found in remote metadata for "${context.requestedSkill}"`,
      );
    }

    return selected;
  }

  throw new Error(`Invalid remote metadata at ${context.metadataUrl}: missing downloadUrl`);
}

function normalizePackageCandidate(
  raw: Record<string, unknown> | undefined,
  fallbackName: unknown,
  metadataUrl: string,
): RemoteSkillPackage | null {
  if (!raw) return null;

  const name = typeof raw.name === 'string' ? raw.name : typeof fallbackName === 'string' ? fallbackName : undefined;
  const version = typeof raw.version === 'string' ? raw.version : undefined;
  const downloadUrlRaw = typeof raw.downloadUrl === 'string' ? raw.downloadUrl : undefined;
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : undefined;

  if (!name || !version || !downloadUrlRaw) return null;

  return {
    name,
    version,
    downloadUrl: new URL(downloadUrlRaw, metadataUrl).toString(),
    sha256,
  };
}

function validateRequestedVersion(pkg: RemoteSkillPackage, requestedVersion?: string): RemoteSkillPackage {
  if (requestedVersion && pkg.version !== requestedVersion) {
    throw new Error(`Version mismatch: requested ${requestedVersion} but remote source returned ${pkg.version}`);
  }
  return pkg;
}

async function fetchWithTimeout(
  url: string,
  source: RemoteSourceConfig,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = source.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildSourceHeaders(source: RemoteSourceConfig): HeadersInit {
  if (!source.tokenEnv) return {};

  const token = process.env[source.tokenEnv];
  if (!token) return {};

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function downloadToFile(url: string, filePath: string, source: RemoteSourceConfig): Promise<void> {
  const response = await fetchWithTimeout(url, source, { headers: buildSourceHeaders(source) });
  if (!response.ok) {
    throw new Error(`Failed to download package from ${url}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, bytes);
}

function archiveFileName(downloadUrl: string): string {
  const url = new URL(downloadUrl);
  const name = basename(url.pathname) || 'package.tgz';
  return name.endsWith('.tar') || name.endsWith('.tgz') || name.endsWith('.tar.gz') ? name : `${name}.tgz`;
}

async function computeSha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function extractArchive(archivePath: string, extractRoot: string): Promise<void> {
  const isTar = archivePath.endsWith('.tar');
  const isTarGz = archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz');

  if (!isTar && !isTarGz) {
    throw new Error(`Unsupported package format for ${archivePath}. Only .tar, .tar.gz, and .tgz are supported`);
  }

  const listArgs = isTarGz ? ['-tzf', archivePath] : ['-tf', archivePath];
  const list = await run('tar', listArgs);
  if (list.exitCode !== 0) {
    throw new Error(`Failed to inspect archive ${archivePath}: ${list.stderr || list.stdout}`);
  }

  const entries = list.stdout
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const unsafeEntry = entries.find((entry) => !isSafeArchiveEntry(entry));
  if (unsafeEntry) {
    throw new Error(`Unsafe archive entry detected: ${unsafeEntry}`);
  }

  const extractArgs = isTarGz ? ['-xzf', archivePath, '-C', extractRoot] : ['-xf', archivePath, '-C', extractRoot];
  const extracted = await run('tar', extractArgs);
  if (extracted.exitCode !== 0) {
    throw new Error(`Failed to extract archive ${archivePath}: ${extracted.stderr || extracted.stdout}`);
  }
}

function isSafeArchiveEntry(entry: string): boolean {
  const normalized = entry.replaceAll('\\', '/');
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.includes('..')) {
    const parts = normalized.split('/');
    if (parts.some((part) => part === '..')) return false;
  }
  if (/^[A-Za-z]:/.test(normalized)) return false;
  return true;
}

async function locateSkillDirectory(root: string, expectedSkillName: string): Promise<string> {
  const manifests = await findManifestFiles(root, 0, 5);
  if (!manifests.length) {
    throw new Error(`Downloaded package does not contain a skill document`);
  }

  for (const manifestPath of manifests) {
    const manifest = await parseManifest(manifestPath);
    if (manifest.name === expectedSkillName) {
      return resolve(manifestPath, '..');
    }
  }

  throw new Error(
    `Downloaded package does not contain requested skill "${expectedSkillName}". Found ${manifests.length} skill document(s) but none match.`,
  );
}

async function findManifestPath(skillDir: string): Promise<string | undefined> {
  if (!(await fileExists(skillDir))) return undefined;

  for (const file of MANIFEST_FILES) {
    const manifestPath = join(skillDir, file);
    if (await fileExists(manifestPath)) return manifestPath;
  }

  return undefined;
}

async function findManifestFiles(dir: string, depth: number, maxDepth: number): Promise<string[]> {
  if (depth > maxDepth) return [];

  const manifests: string[] = [];
  for (const file of MANIFEST_FILES) {
    const candidate = join(dir, file);
    if (await fileExists(candidate)) {
      manifests.push(candidate);
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    manifests.push(...(await findManifestFiles(join(dir, entry.name), depth + 1, maxDepth)));
  }

  return manifests;
}

interface ParsedManifest {
  name: string;
  version: string;
}

async function parseManifest(manifestPath: string): Promise<ParsedManifest> {
  const manifest = await parseSkillManifest(manifestPath);

  return {
    name: manifest.name,
    version: manifest.version,
  };
}
