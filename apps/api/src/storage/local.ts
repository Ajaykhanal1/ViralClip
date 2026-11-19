import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env.js';

const storageRoot = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);

function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  return normalized;
}

export function resolveStoragePath(key: string): string {
  const safe = assertSafeKey(key);
  const full = path.resolve(storageRoot, safe);
  if (!full.startsWith(storageRoot + path.sep) && full !== storageRoot) {
    throw new Error('Invalid storage path');
  }
  return full;
}

export function newStorageKey(prefix: string, filename: string): string {
  const ext = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10).toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}/${date}/${randomUUID()}${ext}`;
}

export async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeStreamToKey(key: string, stream: NodeJS.ReadableStream): Promise<{ bytes: number }> {
  const full = resolveStoragePath(key);
  await ensureParent(full);
  const hash = createHash('sha256');
  let bytes = 0;
  stream.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    hash.update(chunk);
  });
  await pipeline(stream, createWriteStream(full, { flags: 'wx' }));
  return { bytes };
}

export async function moveFile(from: string, toKey: string): Promise<void> {
  const dest = resolveStoragePath(toKey);
  await ensureParent(dest);
  await rename(from, dest);
}

export async function removeKey(key: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

export async function fileSize(key: string): Promise<number> {
  return (await stat(resolveStoragePath(key))).size;
}

export function readKeyStream(key: string, options?: { start?: number; end?: number }) {
  return createReadStream(resolveStoragePath(key), options);
}

export async function removePath(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // ignore cleanup errors
  }
}
