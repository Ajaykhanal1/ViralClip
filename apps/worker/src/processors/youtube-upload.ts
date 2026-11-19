import { open, stat } from 'node:fs/promises';
import type { Job } from 'bullmq';
import { google } from 'googleapis';
import type { YoutubeUploadJob } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { appendLog, isCancelled, markJobRunning, updateJob } from '../processing/jobs.js';
import { emitEvent } from '../processing/notifications.js';
import {
  checkRights,
  getUploadContext,
  setAccountStatus,
  updateAccountTokens,
  updateUpload,
} from '../processing/youtube.js';
import { encryptToken, decryptToken } from '../security/token-crypto.js';
import { resolveStoragePath } from '../storage/local.js';

const CHUNK_BYTES = 5 * 1024 * 1024;
const RESUME_INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus';

export class CancelledError extends Error {
  constructor() { super('Upload cancelled'); this.name = 'CancelledError'; }
}

/** A failure we should not retry (rights, auth revocation, account/video restrictions). */
class UploadFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UploadFailure';
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

export function quotaReason(reason: string, status: number): boolean {
  return status === 429 || ['quotaExceeded', 'rateLimitExceeded', 'dailyLimitExceeded', 'userRateLimitExceeded', 'sharingRateLimitExceeded'].includes(reason);
}

async function readGoogleError(res: Response): Promise<{ message: string; reason: string; status: number }> {
  let body: GoogleErrorBody | null = null;
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    // Non-JSON error body; fall back to the status text.
  }
  const error = body?.error;
  return {
    message: error?.message ?? res.statusText ?? `YouTube API error (${res.status})`,
    reason: error?.errors?.[0]?.reason ?? error?.status ?? '',
    status: res.status,
  };
}

export function classifyError(detail: { message: string; reason: string; status: number }): UploadFailure | Error {
  const { message, reason, status } = detail;
  if (quotaReason(reason, status)) {
    return new Error(`YouTube quota/rate limit reached: ${message}`);
  }
  if (status === 401 || ['invalid_grant', 'expired', 'authError', 'invalidCredentials'].includes(reason)) {
    return new UploadFailure('YOUTUBE_AUTH_ERROR', `YouTube authorization failed: ${message}`);
  }
  if (status === 403) {
    return new UploadFailure('YOUTUBE_FORBIDDEN', `YouTube upload not permitted for this account/video: ${message}`);
  }
  return new UploadFailure('YOUTUBE_API_ERROR', `YouTube API error (${status}): ${message}`);
}

export function nextOffsetFromRange(range: string | null, fallback: number): number {
  if (!range) return fallback;
  const match = /bytes=(\d+)-(\d+)/.exec(range);
  return match ? Number(match[2]) + 1 : fallback;
}

/** Official resumable upload protocol: initiate a session, then PUT byte ranges until YouTube accepts the file. */
async function resumableUpload(
  metadata: Record<string, unknown>,
  filePath: string,
  size: number,
  authHeader: string,
  onProgress: (percent: number) => Promise<void>,
  isCancelledNow: () => Promise<boolean>,
): Promise<string> {
  const init = await fetch(RESUME_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) throw classifyError(await readGoogleError(init));
  if (init.status === 200 || init.status === 201) {
    const body = (await init.json()) as { id?: string };
    if (body.id) return body.id;
  }
  const sessionUrl = init.headers.get('location');
  if (!sessionUrl) throw new UploadFailure('YOUTUBE_UPLOAD_SESSION_MISSING', 'YouTube did not return a resumable upload session URL');

  const handle = await open(filePath, 'r');
  let offset = 0;
  try {
    while (offset < size) {
      if (await isCancelledNow()) throw new CancelledError();
      const length = Math.min(CHUNK_BYTES, size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) throw new UploadFailure('YOUTUBE_FILE_READ_FAILED', 'Rendered video could not be read');

      let response: Response;
      try {
        response = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${offset}-${offset + bytesRead - 1}/${size}`,
          },
          body: buffer.subarray(0, bytesRead),
        });
      } catch (error) {
        // Network interruption: ask YouTube how much it already received, then continue.
        const status = await querySession(sessionUrl, authHeader);
        if (status === null) throw error;
        offset = status;
        await onProgress(Math.min(99, Math.round((offset / size) * 100)));
        continue;
      }

      if (response.status === 308 || response.status === 309) {
        offset = nextOffsetFromRange(response.headers.get('range'), offset + bytesRead);
        await onProgress(Math.min(99, Math.round((offset / size) * 100)));
        continue;
      }
      if (response.ok) {
        const body = (await response.json()) as { id?: string };
        if (!body.id) throw new UploadFailure('YOUTUBE_VIDEO_ID_MISSING', 'YouTube did not return a video ID');
        await onProgress(100);
        return body.id;
      }
      if (quotaReason('', response.status)) throw classifyError(await readGoogleError(response));
      const detail = await readGoogleError(response);
      if (response.status >= 500) {
        const status = await querySession(sessionUrl, authHeader);
        if (status !== null) {
          offset = status;
          await onProgress(Math.min(99, Math.round((offset / size) * 100)));
          continue;
        }
      }
      throw classifyError(detail);
    }
  } finally {
    await handle.close();
  }
  throw new UploadFailure('YOUTUBE_UPLOAD_INCOMPLETE', 'Resumable upload ended without a video ID');
}

/** PUT with an empty Content-Range asks YouTube how many bytes it already received. */
async function querySession(sessionUrl: string, authHeader: string): Promise<number | null> {
  try {
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': 'video/mp4', 'Content-Range': 'bytes */*' },
    });
    if (res.status === 308 || res.status === 309) {
      return nextOffsetFromRange(res.headers.get('range'), 0);
    }
    return null;
  } catch {
    return null;
  }
}

export async function processYoutubeUpload(job: Job<YoutubeUploadJob>): Promise<{ ok: true; videoId?: string }> {
  const { processingJobId, uploadId, youtubeAccountId, userId, sourceVideoId } = job.data;
  const attempt = job.attemptsMade + 1;
  const finalAttempt = attempt >= (job.opts.attempts ?? 3);
  const cancelled = async () => isCancelled(processingJobId);

  if (await cancelled()) {
    await updateUpload(uploadId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    return { ok: true };
  }

  try {
    await markJobRunning(processingJobId, attempt);
    await updateUpload(uploadId, {
      status: 'uploading', attempt, progress: 1, started: true, errorCode: null, errorMessage: null,
    });
    await appendLog(processingJobId, 'info', 'YouTube upload started', { attempt, uploadId });

    const context = await getUploadContext(uploadId);
    if (!context) throw new UploadFailure('UPLOAD_NOT_FOUND', 'Upload record no longer exists');
    if (context.account.id !== youtubeAccountId || context.upload.userId !== userId || context.upload.sourceVideoId !== sourceVideoId) {
      throw new UploadFailure('UPLOAD_CONTEXT_MISMATCH', 'Upload job data does not match the stored upload');
    }
    if (context.account.status !== 'connected') {
      throw new UploadFailure('YOUTUBE_NOT_CONNECTED', 'YouTube account is no longer connected');
    }

    const rights = await checkRights(context.upload.userId, context.upload.projectId, context.upload.sourceVideoId);
    if (!rights.allowed) {
      throw new UploadFailure('RIGHTS_REQUIRED', `Upload blocked by rights check: ${rights.reasons.join(' ')}`);
    }
    await updateUpload(uploadId, { progress: 5 });
    await updateJob(processingJobId, { progress: 5 });

    const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({
      access_token: decryptToken(context.account.accessTokenEnc),
      refresh_token: decryptToken(context.account.refreshTokenEnc),
      expiry_date: context.account.tokenExpiresAt?.getTime() ?? undefined,
    });
    client.on('tokens', (tokens) => {
      // Persist rotated refresh tokens so a later upload can still authenticate.
      void updateAccountTokens(
        context.account.id,
        encryptToken(tokens.access_token ?? ''),
        encryptToken(tokens.refresh_token ?? context.account.refreshTokenEnc),
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      ).catch((error: unknown) => logger.warn({ error }, 'failed to persist rotated YouTube tokens'));
    });
    const authHeader = (await client.getRequestHeaders(RESUME_INIT_URL)).get('Authorization') ?? '';
    if (!authHeader) throw new UploadFailure('YOUTUBE_AUTH_UNAVAILABLE', 'Unable to authorize the YouTube upload');

    const filePath = resolveStoragePath(context.storageKey);
    const videoSize = (await stat(filePath)).size;
    if (!Number.isFinite(videoSize) || videoSize <= 0) {
      throw new UploadFailure('RENDERED_VIDEO_EMPTY', 'Rendered video file is empty');
    }

    const metadata = {
      snippet: {
        title: context.upload.title,
        description: context.upload.description,
        tags: context.upload.tags,
        categoryId: '22',
      },
      status: { privacyStatus: context.upload.visibility },
    };

    const videoId = await resumableUpload(
      metadata,
      filePath,
      videoSize,
      authHeader,
      async (percent) => {
        await updateUpload(uploadId, { progress: percent }).catch(() => {});
        await updateJob(processingJobId, { progress: percent }).catch(() => {});
      },
      cancelled,
    );
    const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

    await updateUpload(uploadId, {
      status: 'completed', progress: 100, videoId, videoUrl, errorCode: null, errorMessage: null, completed: true,
    });
    await updateJob(processingJobId, {
      status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null,
      result: { uploadId, videoId, videoUrl },
    });
    await appendLog(processingJobId, 'info', 'YouTube upload completed', { uploadId, videoId });
    await emitEvent({
      userId,
      type: 'youtube_upload_completed',
      title: 'YouTube upload completed',
      message: `Your Short is live on YouTube: ${videoUrl}`,
      severity: 'success',
      data: { projectId: job.data.projectId, sourceVideoId, uploadId, videoId, videoUrl },
      usage: { metric: 'youtubeUploads', amount: 1, key: `youtube-upload:${uploadId}` },
    });
    return { ok: true, videoId };
  } catch (error) {
    if (error instanceof CancelledError || (await cancelled())) {
      await updateUpload(uploadId, { status: 'cancelled', completed: true, errorMessage: 'Upload cancelled' }).catch(() => {});
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Upload cancelled' }).catch(() => {});
      await appendLog(processingJobId, 'info', 'YouTube upload cancelled').catch(() => {});
      return { ok: true };
    }

    const message = error instanceof Error ? error.message : String(error);
    const isPermanent = error instanceof UploadFailure;
    const code = error instanceof UploadFailure ? error.code : 'YOUTUBE_UPLOAD_FAILED';

    if (code === 'YOUTUBE_AUTH_ERROR') {
      await setAccountStatus(youtubeAccountId, 'expired').catch(() => {});
    }
    if (isPermanent || finalAttempt) {
      await updateUpload(uploadId, {
        status: 'failed', errorCode: code, errorMessage: message, completed: true,
      }).catch(() => {});
      await updateJob(processingJobId, {
        status: 'failed', errorCode: code, errorMessage: message, completed: true, result: null,
      }).catch(() => {});
      await emitEvent({
        userId,
        type: 'youtube_upload_failed',
        title: 'YouTube upload failed',
        message: `Upload #${uploadId} failed: ${message}`,
        severity: 'error',
        data: { projectId: job.data.projectId, sourceVideoId, uploadId, errorCode: code, error: message },
      });
    } else {
      await updateUpload(uploadId, { status: 'queued', errorCode: code, errorMessage: message }).catch(() => {});
      await updateJob(processingJobId, { status: 'queued', errorCode: code, errorMessage: message }).catch(() => {});
    }
    await appendLog(processingJobId, 'error', 'YouTube upload failed', { error: message, attempt, finalAttempt, permanent: isPermanent }).catch(() => {});
    logger.error({ error, processingJobId, uploadId }, 'youtube upload failed');

    // Permanent failures and final retry attempts are recorded in the DB; do not loop in BullMQ.
    if (isPermanent || finalAttempt) return { ok: true };
    throw error;
  }
}
