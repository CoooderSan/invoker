import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a requirement path relative to a skill directory.
 * Supports ~/... (home-relative), absolute paths, and relative paths.
 */
export function resolveRequirementPath(path: string, skillDir: string): string {
  if (path.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return resolve(home, path.slice(2));
  }
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(skillDir, path);
}
