import { open } from 'node:fs/promises';
import path from 'node:path';

export const ALLOWED_VIDEO_TYPES = [
  { ext: '.mp4', mime: 'video/mp4' },
  { ext: '.mov', mime: 'video/quicktime' },
  { ext: '.m4v', mime: 'video/x-m4v' },
  { ext: '.webm', mime: 'video/webm' },
] as const;

const allowedMimes = new Set<string>(ALLOWED_VIDEO_TYPES.map((t) => t.mime));
const allowedExts = new Set<string>(ALLOWED_VIDEO_TYPES.map((t) => t.ext));

export function normalizeMime(mime?: string | null): string | null {
  if (!mime) return null;
  return mime.split(';')[0].trim().toLowerCase() || null;
}

export function isAllowedFilename(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return allowedExts.has(ext);
}

export function isAllowedMime(mime?: string | null): boolean {
  const m = normalizeMime(mime);
  return !!m && (allowedMimes.has(m) || m === 'application/mp4');
}

async function readHead(filePath: string, len: number): Promise<Buffer> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function detectVideoKind(filePath: string): Promise<'mp4' | 'webm' | null> {
  const head = await readHead(filePath, 64);
  if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return 'webm';
  }
  return null;
}

export async function validateVideoFile(filePath: string, filename: string, mime?: string | null): Promise<void> {
  if (!isAllowedFilename(filename)) {
    throw new Error('Unsupported file type. Allowed: MP4, MOV, M4V, WebM.');
  }
  if (mime && !isAllowedMime(mime)) {
    throw new Error('Unsupported MIME type.');
  }
  const kind = await detectVideoKind(filePath);
  if (!kind) {
    throw new Error('File content is not a supported video format.');
  }
  const ext = path.extname(filename).toLowerCase();
  if (kind === 'webm' && ext !== '.webm') {
    throw new Error('File content does not match the file extension.');
  }
  if (kind === 'mp4' && ext === '.webm') {
    throw new Error('File content does not match the file extension.');
  }
}
