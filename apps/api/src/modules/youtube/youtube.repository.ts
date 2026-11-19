import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { PublishingRightsCheck, YouTubeAccount, YouTubeAccountStatus, YouTubeUpload, YouTubeUploadStatus, YouTubeVisibility } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface AccountRow extends RowDataPacket {
  id: number;
  user_id: number;
  channel_id: string;
  channel_title: string;
  channel_handle: string | null;
  thumbnail_url: string | null;
  scopes_json: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date | null;
  status: YouTubeAccountStatus;
  connected_at: Date;
  updated_at: Date;
}

interface UploadRow extends RowDataPacket {
  id: number;
  user_id: number;
  youtube_account_id: number;
  rendered_video_id: number;
  processing_job_id: number | null;
  project_id: number;
  source_video_id: number;
  draft_id: number;
  status: YouTubeUploadStatus;
  progress: number;
  title: string;
  description: string;
  tags_json: string;
  visibility: YouTubeVisibility;
  rights_confirmed: number;
  rights_check_json: string | null;
  video_id: string | null;
  video_url: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt: number;
  max_attempts: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toAccount(row: AccountRow): YouTubeAccount {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    channelHandle: row.channel_handle,
    thumbnailUrl: row.thumbnail_url,
    scopes: parseJson<string[]>(row.scopes_json, []),
    tokenExpiresAt: row.token_expires_at ? row.token_expires_at.toISOString() : null,
    status: row.status,
    connectedAt: row.connected_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toUpload(row: UploadRow): YouTubeUpload {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    youtubeAccountId: Number(row.youtube_account_id),
    renderedVideoId: Number(row.rendered_video_id),
    processingJobId: row.processing_job_id == null ? null : Number(row.processing_job_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    draftId: Number(row.draft_id),
    status: row.status,
    progress: Number(row.progress ?? 0),
    title: row.title,
    description: row.description,
    tags: parseJson<string[]>(row.tags_json, []),
    visibility: row.visibility,
    rightsConfirmed: !!row.rights_confirmed,
    videoId: row.video_id,
    videoUrl: row.video_url,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attempt: Number(row.attempt ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findAccount(userId: number): Promise<YouTubeAccount | null> {
  const [rows] = await pool.execute<AccountRow[]>(
    `SELECT * FROM youtube_accounts WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function findAccountTokens(userId: number): Promise<AccountRow | null> {
  const [rows] = await pool.execute<AccountRow[]>(
    `SELECT * FROM youtube_accounts WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertAccount(input: {
  userId: number;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  thumbnailUrl: string | null;
  scopes: string[];
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Date | null;
}): Promise<YouTubeAccount> {
  await pool.execute(
    `INSERT INTO youtube_accounts
      (user_id, channel_id, channel_title, channel_handle, thumbnail_url, scopes_json,
       access_token_enc, refresh_token_enc, token_expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected')
     ON DUPLICATE KEY UPDATE
       channel_id = VALUES(channel_id), channel_title = VALUES(channel_title),
       channel_handle = VALUES(channel_handle), thumbnail_url = VALUES(thumbnail_url),
       scopes_json = VALUES(scopes_json), access_token_enc = VALUES(access_token_enc),
       refresh_token_enc = VALUES(refresh_token_enc), token_expires_at = VALUES(token_expires_at),
       status = 'connected', connected_at = CURRENT_TIMESTAMP`,
    [
      input.userId, input.channelId, input.channelTitle, input.channelHandle, input.thumbnailUrl,
      JSON.stringify(input.scopes), input.accessTokenEnc, input.refreshTokenEnc, input.tokenExpiresAt,
    ],
  );
  return (await findAccount(input.userId))!;
}

export async function updateTokens(accountId: number, input: {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Date | null;
}): Promise<void> {
  await pool.execute(
    `UPDATE youtube_accounts SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, status = 'connected' WHERE id = ?`,
    [input.accessTokenEnc, input.refreshTokenEnc, input.tokenExpiresAt, accountId],
  );
}

export async function setAccountStatus(userId: number, status: 'disconnected' | 'revoked' | 'expired'): Promise<void> {
  // Tokens are cleared on disconnect/revoke so a stale row cannot be reused.
  await pool.execute(
    `UPDATE youtube_accounts SET status = ?, access_token_enc = '', refresh_token_enc = '', token_expires_at = NULL WHERE user_id = ?`,
    [status, userId],
  );
}

export async function insertUpload(input: {
  userId: number;
  youtubeAccountId: number;
  renderedVideoId: number;
  projectId: number;
  sourceVideoId: number;
  draftId: number;
  title: string;
  description: string;
  tags: string[];
  visibility: YouTubeVisibility;
  rightsCheck: PublishingRightsCheck;
}): Promise<YouTubeUpload> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO youtube_uploads
      (user_id, youtube_account_id, rendered_video_id, project_id, source_video_id, draft_id,
       title, description, tags_json, visibility, rights_confirmed, rights_check_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      input.userId, input.youtubeAccountId, input.renderedVideoId, input.projectId, input.sourceVideoId,
      input.draftId, input.title, input.description, JSON.stringify(input.tags), input.visibility,
      JSON.stringify(input.rightsCheck),
    ],
  );
  return (await findUpload(input.userId, result.insertId))!;
}

export async function findUpload(userId: number, id: number): Promise<YouTubeUpload | null> {
  const [rows] = await pool.execute<UploadRow[]>(
    `SELECT * FROM youtube_uploads WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toUpload(rows[0]) : null;
}

export async function listUploads(userId: number): Promise<YouTubeUpload[]> {
  const [rows] = await pool.execute<UploadRow[]>(
    `SELECT * FROM youtube_uploads WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    [userId],
  );
  return rows.map(toUpload);
}

export async function linkProcessingJob(id: number, processingJobId: number): Promise<void> {
  await pool.execute(`UPDATE youtube_uploads SET processing_job_id = ? WHERE id = ?`, [processingJobId, id]);
}

export async function updateUpload(id: number, patch: {
  status?: YouTubeUploadStatus;
  progress?: number;
  attempt?: number;
  videoId?: string | null;
  videoUrl?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  started?: boolean;
  completed?: boolean;
}): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.progress !== undefined) { sets.push('progress = ?'); params.push(Math.max(0, Math.min(100, Math.round(patch.progress)))); }
  if (patch.attempt !== undefined) { sets.push('attempt = ?'); params.push(patch.attempt); }
  if (patch.videoId !== undefined) { sets.push('video_id = ?'); params.push(patch.videoId); }
  if (patch.videoUrl !== undefined) { sets.push('video_url = ?'); params.push(patch.videoUrl); }
  if (patch.errorCode !== undefined) { sets.push('error_code = ?'); params.push(patch.errorCode); }
  if (patch.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(patch.errorMessage); }
  if (patch.started) sets.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)');
  if (patch.completed) sets.push('completed_at = CURRENT_TIMESTAMP');
  if (!sets.length) return;
  await pool.execute(`UPDATE youtube_uploads SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}
