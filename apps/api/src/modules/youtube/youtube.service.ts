import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import {
  QUEUE_NAMES,
  type YouTubeAccount,
  type YouTubeStateResult,
  type YouTubeUpload,
  type YouTubeUploadInput,
} from '@viralclip/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../http/errors.js';
import { decryptToken, encryptToken } from '../../security/token-crypto.js';
import * as processingRepo from '../processing/processing.repository.js';
import * as processing from '../processing/processing.service.js';
import * as renderRepo from '../render/render.repository.js';
import { runPublishingCheck } from '../rights/rights.service.js';
import { assertWithinLimit } from '../usage/usage.service.js';
import * as repo from './youtube.repository.js';

/** Minimum scopes: upload Shorts and read channel identity at connect time. */
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

type Output = { success: boolean; message: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function oauthClient() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function generateState(): string {
  return randomBytes(24).toString('hex');
}

export function buildAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    scope: YOUTUBE_SCOPES,
    state,
    // Required to obtain a refresh token on every connect.
    prompt: 'consent',
    include_granted_scopes: true,
  });
}

export async function handleCallback(userId: number, code: string): Promise<void> {
  const client = oauthClient();
  let tokens;
  try {
    const response = await client.getToken(code);
    tokens = response.tokens;
  } catch (error) {
    throw new AppError(400, 'OAUTH_TOKEN_EXCHANGE_FAILED', `Failed to exchange authorization code: ${message(error)}`);
  }
  if (!tokens.access_token) {
    throw new AppError(400, 'OAUTH_ACCESS_TOKEN_MISSING', 'Google did not return an access token');
  }
  // Without a refresh token the connection cannot survive access-token expiry.
  if (!tokens.refresh_token) {
    throw new AppError(400, 'OAUTH_REFRESH_TOKEN_MISSING', 'Google did not return a refresh token; reconnect and grant access again.');
  }

  client.setCredentials(tokens);
  let channel: { channelId: string; channelTitle: string; channelHandle: string | null; thumbnailUrl: string | null };
  try {
    const youtube = google.youtube({ version: 'v3', auth: client });
    const response = await youtube.channels.list({ part: ['snippet'], mine: true });
    const item = response.data.items?.[0];
    if (!item?.id) throw new Error('No channel found for this Google account');
    channel = {
      channelId: item.id,
      channelTitle: item.snippet?.title ?? 'YouTube channel',
      channelHandle: item.snippet?.customUrl ?? null,
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
    };
  } catch (error) {
    throw new AppError(400, 'YOUTUBE_CHANNEL_FETCH_FAILED', `Failed to read YouTube channel: ${message(error)}`);
  }

  await repo.upsertAccount({
    userId,
    ...channel,
    scopes: (tokens.scope ?? YOUTUBE_SCOPES.join(' ')).split(' ').filter(Boolean),
    accessTokenEnc: encryptToken(tokens.access_token),
    refreshTokenEnc: encryptToken(tokens.refresh_token),
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  });
}

export function account(userId: number): Promise<YouTubeAccount | null> {
  return repo.findAccount(userId);
}

export async function disconnect(userId: number): Promise<Output> {
  const row = await repo.findAccountTokens(userId);
  if (row) {
    try {
      await oauthClient().revokeToken(decryptToken(row.refresh_token_enc));
    } catch {
      // Best-effort remote revocation: the local disconnect must still succeed.
    }
  }
  await repo.setAccountStatus(userId, 'disconnected');
  return { success: true, message: 'YouTube account disconnected' };
}

export async function state(userId: number): Promise<YouTubeStateResult> {
  const [acct, uploads] = await Promise.all([repo.findAccount(userId), repo.listUploads(userId)]);
  return { account: acct, uploads };
}

export async function getUpload(userId: number, id: number): Promise<YouTubeUpload> {
  const upload = await repo.findUpload(userId, id);
  if (!upload) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
  return upload;
}

export async function createUpload(userId: number, input: YouTubeUploadInput): Promise<YouTubeUpload> {
  const acct = await repo.findAccount(userId);
  if (!acct || acct.status !== 'connected') {
    throw new AppError(409, 'YOUTUBE_NOT_CONNECTED', 'Connect a YouTube account first');
  }
  const video = await renderRepo.findRenderedVideo(userId, input.renderedVideoId);
  if (!video) throw new AppError(404, 'RENDERED_VIDEO_NOT_FOUND', 'Rendered video not found');

  const active = await processingRepo.findActiveJobForSource(video.sourceVideoId, QUEUE_NAMES.youtubeUpload);
  if (active) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'An upload is already in progress for this source video');

  const rights = await runPublishingCheck(userId, {
    projectId: video.projectId,
    sourceVideoId: video.sourceVideoId,
    context: 'upload_youtube',
  });
  if (!rights.allowed) {
    throw new AppError(403, 'RIGHTS_REQUIRED', `Upload blocked by rights check: ${rights.reasons.join(' ')}`, { reasons: rights.reasons });
  }
  await assertWithinLimit(userId, 'youtubeUploads');

  const upload = await repo.insertUpload({
    userId,
    youtubeAccountId: acct.id,
    renderedVideoId: video.id,
    projectId: video.projectId,
    sourceVideoId: video.sourceVideoId,
    draftId: video.draftId,
    title: input.title,
    description: input.description,
    tags: input.tags,
    visibility: input.visibility,
    rightsCheck: rights,
  });
  return enqueueUpload(userId, upload);
}

export async function retryUpload(userId: number, id: number): Promise<YouTubeUpload> {
  const existing = await getUpload(userId, id);
  if (existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new AppError(409, 'UPLOAD_NOT_RETRYABLE', 'Only failed or cancelled uploads can be retried');
  }
  const acct = await repo.findAccount(userId);
  if (!acct || acct.status !== 'connected') {
    throw new AppError(409, 'YOUTUBE_NOT_CONNECTED', 'Connect a YouTube account first');
  }
  const rights = await runPublishingCheck(userId, {
    projectId: existing.projectId,
    sourceVideoId: existing.sourceVideoId,
    context: 'upload_youtube',
  });
  if (!rights.allowed) {
    throw new AppError(403, 'RIGHTS_REQUIRED', `Upload blocked by rights check: ${rights.reasons.join(' ')}`, { reasons: rights.reasons });
  }
  await repo.updateUpload(id, {
    status: 'queued', progress: 0, errorCode: null, errorMessage: null, videoId: null, videoUrl: null,
  });
  return enqueueUpload(userId, existing);
}

async function enqueueUpload(userId: number, upload: YouTubeUpload): Promise<YouTubeUpload> {
  try {
    const job = await processing.createJobForSource({
      userId,
      projectId: upload.projectId,
      sourceVideoId: upload.sourceVideoId,
      queueName: QUEUE_NAMES.youtubeUpload,
      jobType: 'youtube-upload',
      payload: {
        uploadId: upload.id,
        youtubeAccountId: upload.youtubeAccountId,
        renderedVideoId: upload.renderedVideoId,
      },
    });
    await repo.linkProcessingJob(upload.id, job.id);
    return (await repo.findUpload(userId, upload.id))!;
  } catch (error) {
    await repo.updateUpload(upload.id, {
      status: 'failed', errorCode: 'ENQUEUE_FAILED', errorMessage: message(error), completed: true,
    }).catch(() => {});
    throw error;
  }
}
