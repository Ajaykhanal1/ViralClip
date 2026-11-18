import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { UploadSession, UploadSessionStatus } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface SessionRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  original_filename: string;
  mime_type: string | null;
  declared_size_bytes: number | null;
  status: UploadSessionStatus;
  storage_key: string | null;
  upload_token_hash: string | null;
  bytes_received: number | string;
  error_message: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface UploadSessionRecord extends UploadSession {
  userId: number;
  storageKey: string | null;
  uploadTokenHash: string | null;
  errorMessage: string | null;
}

function toSession(row: SessionRow): UploadSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    declaredSizeBytes: row.declared_size_bytes == null ? null : Number(row.declared_size_bytes),
    status: row.status,
    storageKey: row.storage_key,
    uploadTokenHash: row.upload_token_hash,
    bytesReceived: Number(row.bytes_received ?? 0),
    errorMessage: row.error_message,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export async function findProjectOwner(projectId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number }>>(
    `SELECT user_id FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

export async function createSession(input: {
  userId: number;
  projectId: number;
  originalFilename: string;
  mimeType: string | null;
  declaredSizeBytes: number | null;
  storageKey: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<UploadSessionRecord> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO upload_sessions
      (user_id, project_id, original_filename, mime_type, declared_size_bytes, status, storage_key, upload_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      input.userId,
      input.projectId,
      input.originalFilename,
      input.mimeType,
      input.declaredSizeBytes,
      input.storageKey,
      input.tokenHash,
      input.expiresAt,
    ],
  );
  const session = await findSessionById(input.userId, result.insertId);
  if (!session) throw new Error('Failed to read upload session');
  return session;
}

export async function findSessionById(userId: number, id: number): Promise<UploadSessionRecord | null> {
  const [rows] = await pool.execute<SessionRow[]>(
    `SELECT id, user_id, project_id, original_filename, mime_type, declared_size_bytes, status,
            storage_key, upload_token_hash, bytes_received, error_message, expires_at, created_at
       FROM upload_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function findSessionForUpload(id: number): Promise<UploadSessionRecord | null> {
  const [rows] = await pool.execute<SessionRow[]>(
    `SELECT id, user_id, project_id, original_filename, mime_type, declared_size_bytes, status,
            storage_key, upload_token_hash, bytes_received, error_message, expires_at, created_at
       FROM upload_sessions WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function markStatus(
  id: number,
  status: UploadSessionStatus,
  patch: { bytesReceived?: number; errorMessage?: string | null } = {},
): Promise<void> {
  const sets = ['status = ?'];
  const params: Array<string | number | null> = [status];
  if (patch.bytesReceived !== undefined) {
    sets.push('bytes_received = ?');
    params.push(patch.bytesReceived);
  }
  if (patch.errorMessage !== undefined) {
    sets.push('error_message = ?');
    params.push(patch.errorMessage);
  }
  if (status === 'uploaded') sets.push('completed_at = CURRENT_TIMESTAMP');
  params.push(id);
  await pool.execute(`UPDATE upload_sessions SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function expireOldSessions(userId?: number): Promise<string[]> {
  const where = userId ? 'user_id = ? AND' : '';
  const params = userId ? [userId] : [];
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; storage_key: string | null }>>(
    `SELECT id, storage_key FROM upload_sessions
      WHERE ${where} status IN ('pending','uploading') AND expires_at < NOW()`,
    params,
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  await pool.query(`UPDATE upload_sessions SET status = 'expired' WHERE id IN (?)`, [ids]);
  return rows.map((r) => r.storage_key).filter((k): k is string => !!k);
}
