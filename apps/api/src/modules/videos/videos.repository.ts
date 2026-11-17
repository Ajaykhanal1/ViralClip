import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Video, VideoStatus } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';
import type { CreateVideoInput } from './videos.schemas.js';

interface VideoRow extends RowDataPacket {
  id: number;
  project_id: number;
  original_filename: string;
  storage_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  status: VideoStatus;
  created_at: Date;
}

function toVideo(row: VideoRow): Video {
  return {
    id: row.id,
    projectId: row.project_id,
    originalFilename: row.original_filename,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findProjectOwnerId(projectId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number }>>(
    `SELECT user_id FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

export async function insertVideo(input: CreateVideoInput): Promise<Video> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO videos
       (project_id, original_filename, storage_key, mime_type, size_bytes, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.projectId,
      input.originalFilename,
      input.storageKey,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      input.durationSeconds ?? null,
    ],
  );

  const [rows] = await pool.query<VideoRow[]>(
    `SELECT id, project_id, original_filename, storage_key, mime_type,
            size_bytes, duration_seconds, status, created_at
       FROM videos WHERE id = ?`,
    [result.insertId],
  );

  const row = rows[0];
  if (!row) throw new Error(`Video ${result.insertId} was inserted but could not be read back`);
  return toVideo(row);
}
