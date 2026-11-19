import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../http/errors.js';
import { probeMedia } from '../../media/probe.js';
import { isAllowedFilename, isAllowedMime, normalizeMime, validateVideoFile } from '../../lib/upload-validation.js';
import { ensureParent, fileSize, newStorageKey, removeKey, resolveStoragePath } from '../../storage/local.js';
import * as notifications from '../notifications/notifications.service.js';
import * as sources from '../sources/sources.repository.js';
import * as usage from '../usage/usage.service.js';
import * as processing from '../processing/processing.service.js';
import * as repo from './uploads.repository.js';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function cleanupExpired(userId?: number): Promise<void> {
  const keys = await repo.expireOldSessions(userId);
  await Promise.all(keys.map((k) => removeKey(k).catch(() => {})));
}

export async function createUploadSession(
  userId: number,
  input: {
    projectId: number;
    filename: string;
    mimeType?: string;
    sizeBytes?: number;
    sourceVideoId?: number;
  },
): Promise<{ session: Awaited<ReturnType<typeof repo.findSessionById>>; uploadToken: string }> {
  await cleanupExpired(userId);
  const owner = await repo.findProjectOwner(input.projectId);
  if (owner !== userId) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${input.projectId} does not exist`);

  if (!isAllowedFilename(input.filename)) {
    throw new AppError(400, 'UNSUPPORTED_FILE_TYPE', 'Supported formats: MP4, MOV, M4V, WebM.');
  }
  const mime = normalizeMime(input.mimeType);
  if (mime && !isAllowedMime(mime)) {
    throw new AppError(400, 'UNSUPPORTED_MIME_TYPE', 'Unsupported MIME type.');
  }
  if (input.sizeBytes != null && input.sizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', `Maximum upload size is ${env.MAX_UPLOAD_BYTES} bytes.`);
  }
  if (input.sourceVideoId) {
    const src = await sources.findSourceById(userId, input.sourceVideoId);
    if (!src || src.projectId !== input.projectId) {
      throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
    }
  }

  await usage.assertWithinLimit(userId, 'uploadedVideos');
  if (input.sizeBytes != null) await usage.assertWithinLimit(userId, 'uploadedStorageBytes', input.sizeBytes);

  const token = randomBytes(32).toString('hex');
  const storageKey = newStorageKey('uploads', input.filename);
  const expiresAt = new Date(Date.now() + env.UPLOAD_SESSION_TTL_MINUTES * 60_000);
  const session = await repo.createSession({
    userId,
    projectId: input.projectId,
    originalFilename: input.filename,
    mimeType: mime,
    declaredSizeBytes: input.sizeBytes ?? null,
    storageKey,
    tokenHash: tokenHash(token),
    expiresAt,
  });
  return { session, uploadToken: token };
}

export async function getUploadSession(userId: number, id: number) {
  await cleanupExpired(userId);
  const session = await repo.findSessionById(userId, id);
  if (!session) throw new AppError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
  return session;
}

export async function cancelUploadSession(userId: number, id: number) {
  const session = await repo.findSessionById(userId, id);
  if (!session) throw new AppError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
  if (session.status === 'uploaded') throw new AppError(409, 'UPLOAD_ALREADY_COMPLETED', 'Upload already completed');
  if (session.storageKey) await removeKey(session.storageKey).catch(() => {});
  await repo.markStatus(id, 'canceled', { errorMessage: 'Canceled by user' });
  return repo.findSessionById(userId, id);
}

async function writeLimited(stream: Readable, destPath: string, maxBytes: number): Promise<number> {
  await ensureParent(destPath);
  let bytes = 0;
  let failed = false;
  stream.on('data', (chunk: Buffer) => {
    if (failed) return;
    bytes += chunk.length;
    if (bytes > maxBytes) {
      failed = true;
      stream.destroy(new AppError(413, 'FILE_TOO_LARGE', `Maximum upload size is ${maxBytes} bytes.`));
    }
  });
  await pipeline(stream, createWriteStream(destPath, { flags: 'w' }));
  return bytes;
}

export async function receiveUploadContent(opts: {
  sessionId: number;
  token: string;
  body: Readable;
  sourceVideoId?: number;
}) {
  const session = await repo.findSessionForUpload(opts.sessionId);
  if (!session) throw new AppError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
  if (!session.uploadTokenHash || !session.storageKey) {
    throw new AppError(400, 'UPLOAD_SESSION_INVALID', 'Upload session is invalid');
  }
  if (session.uploadTokenHash !== tokenHash(opts.token)) {
    throw new AppError(403, 'INVALID_UPLOAD_TOKEN', 'Invalid upload token');
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await repo.markStatus(session.id, 'expired');
    throw new AppError(410, 'UPLOAD_SESSION_EXPIRED', 'Upload session expired');
  }
  if (session.status === 'canceled') throw new AppError(409, 'UPLOAD_CANCELED', 'Upload was canceled');
  if (session.status === 'uploaded') throw new AppError(409, 'UPLOAD_ALREADY_COMPLETED', 'Upload already completed');
  if (session.status === 'uploading') throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'Upload already in progress');

  await repo.markStatus(session.id, 'uploading');
  const dest = resolveStoragePath(session.storageKey);
  let bytes = 0;
  try {
    bytes = await writeLimited(opts.body, dest, env.MAX_UPLOAD_BYTES);
    if (bytes === 0) throw new AppError(400, 'EMPTY_UPLOAD', 'Uploaded file is empty');
    await validateVideoFile(dest, session.originalFilename, session.mimeType);
    const meta = await probeMedia(dest);
    const actualSize = await fileSize(session.storageKey).catch(() => bytes);

    let sourceId = opts.sourceVideoId ?? null;
    if (sourceId) {
      const src = await sources.findSourceById(session.userId, sourceId);
      if (!src || src.projectId !== session.projectId) {
        throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
      }
      await sources.insertAsset({
        userId: session.userId,
        sourceVideoId: sourceId,
        kind: src.sourceType === 'youtube' ? 'authorized_source' : 'original',
        storageKey: session.storageKey,
        originalFilename: session.originalFilename,
        mimeType: normalizeMime(session.mimeType),
        sizeBytes: actualSize,
        ...meta,
      });
    } else {
      sourceId = await sources.createUploadedSource({
        userId: session.userId,
        projectId: session.projectId,
        title: session.originalFilename.replace(/\.[^.]+$/, '') || session.originalFilename,
        originalFilename: session.originalFilename,
      });
      await sources.insertAsset({
        userId: session.userId,
        sourceVideoId: sourceId,
        kind: 'original',
        storageKey: session.storageKey,
        originalFilename: session.originalFilename,
        mimeType: normalizeMime(session.mimeType),
        sizeBytes: actualSize,
        ...meta,
      });
    }

    await repo.markStatus(session.id, 'uploaded', { bytesReceived: actualSize, errorMessage: null });
    await Promise.all([
      usage.recordUsage(session.userId, 'uploadedVideos', 1, `video:${sourceId}`),
      usage.recordUsage(session.userId, 'uploadedStorageBytes', actualSize, `storage:${session.storageKey}`),
      notifications.notify(session.userId, {
        type: 'video_upload_completed',
        title: 'Video uploaded',
        message: `${session.originalFilename} was uploaded successfully.`,
        severity: 'success',
        data: { projectId: session.projectId, sourceVideoId: sourceId, bytes: actualSize },
      }),
    ]).catch((error) => logger.warn({ error, sessionId: session.id }, 'upload tracking failed'));
    try {
      await processing.enqueueIngestionForSource(session.userId, sourceId);
    } catch (queueError) {
      const message = queueError instanceof Error ? queueError.message : 'Failed to queue processing';
      await sources.markSourceFailed(session.userId, sourceId, message);
    }
    const source = await sources.findSourceById(session.userId, sourceId);
    return { session: await repo.findSessionById(session.userId, session.id), source };
  } catch (e) {
    await removeKey(session.storageKey).catch(() => {});
    const message = e instanceof AppError ? e.message : 'Upload failed';
    const status = e instanceof AppError && e.code === 'FILE_TOO_LARGE' ? 'failed' : 'failed';
    await repo.markStatus(session.id, status, { bytesReceived: bytes, errorMessage: message });
    throw e;
  }
}
