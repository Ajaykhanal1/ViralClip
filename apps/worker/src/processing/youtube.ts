import type { RowDataPacket } from 'mysql2/promise';
import {
  evaluatePublishingRights,
  type ContentLicense,
  type ContentRights,
  type PublishingRightsCheck,
  type YouTubeVisibility,
} from '@viralclip/shared';
import { pool } from '../db/mysql.js';

export interface UploadContext {
  upload: {
    id: number;
    userId: number;
    projectId: number;
    sourceVideoId: number;
    title: string;
    description: string;
    tags: string[];
    visibility: YouTubeVisibility;
    maxAttempts: number;
  };
  account: {
    id: number;
    status: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    tokenExpiresAt: Date | null;
  };
  storageKey: string;
}

interface ContextRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_video_id: number;
  title: string;
  description: string;
  tags_json: string | string[];
  visibility: YouTubeVisibility;
  max_attempts: number;
  account_id: number;
  account_status: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date | null;
  storage_key: string;
}

function parseTags(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function getUploadContext(uploadId: number): Promise<UploadContext | null> {
  const [rows] = await pool.execute<ContextRow[]>(
    `SELECT u.*, a.id AS account_id, a.status AS account_status, a.access_token_enc, a.refresh_token_enc,
            a.token_expires_at, rv.storage_key
       FROM youtube_uploads u
       JOIN youtube_accounts a ON a.id = u.youtube_account_id
       JOIN rendered_videos rv ON rv.id = u.rendered_video_id
      WHERE u.id = ? LIMIT 1`,
    [uploadId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    upload: {
      id: Number(row.id),
      userId: Number(row.user_id),
      projectId: Number(row.project_id),
      sourceVideoId: Number(row.source_video_id),
      title: row.title,
      description: row.description,
      tags: parseTags(row.tags_json),
      visibility: row.visibility,
      maxAttempts: Number(row.max_attempts ?? 3),
    },
    account: {
      id: Number(row.account_id),
      status: row.account_status,
      accessTokenEnc: row.access_token_enc,
      refreshTokenEnc: row.refresh_token_enc,
      tokenExpiresAt: row.token_expires_at,
    },
    storageKey: row.storage_key,
  };
}

export async function updateUpload(id: number, patch: {
  status?: string;
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

export async function updateAccountTokens(accountId: number, accessTokenEnc: string, refreshTokenEnc: string, tokenExpiresAt: Date | null): Promise<void> {
  await pool.execute(
    `UPDATE youtube_accounts SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, status = 'connected' WHERE id = ?`,
    [accessTokenEnc, refreshTokenEnc, tokenExpiresAt, accountId],
  );
}

export async function setAccountStatus(accountId: number, status: 'expired' | 'revoked'): Promise<void> {
  await pool.execute(
    `UPDATE youtube_accounts SET status = ?, access_token_enc = '', refresh_token_enc = '', token_expires_at = NULL WHERE id = ?`,
    [status, accountId],
  );
}

interface RightRow extends RowDataPacket {
  id: number;
  project_id: number;
  source_video_id: number | null;
  subject_type: ContentRights['subjectType'];
  subject_label: string;
  ownership_type: ContentRights['ownershipType'];
  status: ContentRights['status'];
  commercial_use: number;
  derivative_work: number;
  youtube_publication: number;
  music_rights_confirmed: number;
  user_confirmed: number;
  confirmed_at: Date | null;
  permission_details: string | null;
  notes: string | null;
  created_by: number;
  updated_by: number;
  created_at: Date;
  updated_at: Date;
}

interface LicenseRow extends RowDataPacket {
  id: number;
  content_rights_id: number;
  license_type: string;
  licensor: string | null;
  license_reference: string | null;
  permission_details: string | null;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date;
}

function dateStr(value: Date | string | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Fresh rights evaluation in the worker: rights may change between enqueue and upload. */
export async function checkRights(userId: number, projectId: number, sourceVideoId: number): Promise<PublishingRightsCheck> {
  const [rows] = await pool.execute<RightRow[]>(
    `SELECT * FROM content_rights
      WHERE user_id = ? AND project_id = ? AND (source_video_id = ? OR source_video_id IS NULL)`,
    [userId, projectId, sourceVideoId],
  );
  if (rows.length === 0) {
    return evaluatePublishingRights([], { sourceVideoId, context: 'upload_youtube' });
  }

  const ids = rows.map((row) => Number(row.id));
  const [licenseRows] = await pool.execute<LicenseRow[]>(
    `SELECT * FROM content_licenses WHERE content_rights_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const licensesByRight = new Map<number, ContentLicense[]>();
  for (const lic of licenseRows) {
    const list = licensesByRight.get(Number(lic.content_rights_id)) ?? [];
    list.push({
      id: Number(lic.id),
      contentRightsId: Number(lic.content_rights_id),
      licenseType: lic.license_type,
      licensor: lic.licensor,
      licenseReference: lic.license_reference,
      permissionDetails: lic.permission_details,
      startsAt: dateStr(lic.starts_at),
      expiresAt: dateStr(lic.expires_at),
      createdAt: lic.created_at.toISOString(),
    });
    licensesByRight.set(Number(lic.content_rights_id), list);
  }

  const rights: ContentRights[] = rows.map((row) => ({
    id: Number(row.id),
    projectId: Number(row.project_id),
    sourceVideoId: row.source_video_id == null ? null : Number(row.source_video_id),
    subjectType: row.subject_type,
    subjectLabel: row.subject_label,
    ownershipType: row.ownership_type,
    status: row.status,
    commercialUse: !!row.commercial_use,
    derivativeWork: !!row.derivative_work,
    youtubePublication: !!row.youtube_publication,
    musicRightsConfirmed: !!row.music_rights_confirmed,
    userConfirmed: !!row.user_confirmed,
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    permissionDetails: row.permission_details,
    notes: row.notes,
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    licenses: licensesByRight.get(Number(row.id)) ?? [],
    documents: [],
  }));
  return evaluatePublishingRights(rights, { sourceVideoId, context: 'upload_youtube' });
}
