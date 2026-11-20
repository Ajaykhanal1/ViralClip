import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../../');
const storageRoot = path.isAbsolute(env.LOCAL_STORAGE_DIR)
  ? env.LOCAL_STORAGE_DIR
  : path.resolve(repoRoot, env.LOCAL_STORAGE_DIR);
const tempRoot = path.isAbsolute(env.PROCESSING_TEMP_DIR)
  ? env.PROCESSING_TEMP_DIR
  : path.resolve(repoRoot, env.PROCESSING_TEMP_DIR);

function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  return normalized;
}

export function resolveStoragePath(key: string): string {
  const full = path.resolve(storageRoot, assertSafeKey(key));
  if (!full.startsWith(storageRoot + path.sep) && full !== storageRoot) throw new Error('Invalid storage path');
  return full;
}

export function resolveTempPath(...parts: string[]): string {
  const full = path.resolve(tempRoot, ...parts);
  if (!full.startsWith(tempRoot + path.sep) && full !== tempRoot) throw new Error('Invalid temp path');
  return full;
}

import { copyFile } from 'node:fs/promises';

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function fileSizeByPath(filePath: string): Promise<number> {
  return (await stat(filePath)).size;
}

export function readKeyStream(key: string) {
  return createReadStream(resolveStoragePath(key));
}

export async function removePathSafe(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true }).catch(() => {});
}

export function newTempDir(jobId: number): string {
  return resolveTempPath(String(jobId), randomUUID());
}

export function newArtifactKey(prefix: string, ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${prefix}/${date}/${randomUUID()}${cleanExt}`;
}

export async function storeFileToKey(sourcePath: string, key: string): Promise<void> {
  const dest = resolveStoragePath(key);
  await ensureDir(path.dirname(dest));
  await copyFile(sourcePath, dest);
}

export const paths = { repoRoot, storageRoot, tempRoot };
