import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/mysql.js';

export async function appendLog(jobId: number, level: 'debug'|'info'|'warn'|'error', message: string, details?: Record<string, unknown> | null) {
  await pool.execute(
    `INSERT INTO processing_job_logs (job_id, level, message, details_json) VALUES (?, ?, ?, ?)`,
    [jobId, level, message, details ? JSON.stringify(details) : null],
  ).catch(() => {});
}

export async function updateJob(jobId: number, patch: {
  status?: string; progress?: number; attempt?: number; errorCode?: string | null; errorMessage?: string | null; result?: Record<string, unknown> | null; started?: boolean; completed?: boolean;
}) {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.progress !== undefined) { sets.push('progress = ?'); params.push(Math.max(0, Math.min(100, Math.round(patch.progress)))); }
  if (patch.attempt !== undefined) { sets.push('attempt = ?'); params.push(patch.attempt); }
  if (patch.errorCode !== undefined) { sets.push('error_code = ?'); params.push(patch.errorCode); }
  if (patch.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(patch.errorMessage); }
  if (patch.result !== undefined) { sets.push('result_json = ?'); params.push(patch.result ? JSON.stringify(patch.result) : null); }
  if (patch.started) sets.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)');
  if (patch.completed) sets.push('completed_at = CURRENT_TIMESTAMP');
  if (!sets.length) return;
  params.push(jobId);
  await pool.execute(`UPDATE processing_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function isCancelled(jobId: number): Promise<boolean> {
  const [rows] = await pool.execute<Array<RowDataPacket & { cancel_requested: number; status: string }>>(
    `SELECT cancel_requested, status FROM processing_jobs WHERE id = ? LIMIT 1`,
    [jobId],
  );
  const r = rows[0];
  return !r || !!r.cancel_requested || r.status === 'cancelled';
}

export async function setSourceStatus(userId: number, sourceVideoId: number, status: string, errorMessage?: string | null) {
  await pool.execute(`UPDATE source_videos SET status = ?, error_message = ? WHERE id = ? AND user_id = ?`, [status, errorMessage ?? null, sourceVideoId, userId]);
}

export async function getSourceAsset(sourceVideoId: number): Promise<{ storageKey: string; originalFilename: string } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { storage_key: string; original_filename: string }>>(
    `SELECT storage_key, original_filename FROM media_assets
      WHERE source_video_id = ? AND kind IN ('original','authorized_source')
      ORDER BY CASE kind WHEN 'original' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [sourceVideoId],
  );
  return rows[0] ? { storageKey: rows[0].storage_key, originalFilename: rows[0].original_filename } : null;
}

export async function insertArtifact(input: {
  jobId: number; sourceVideoId: number; kind: string; storageKey: string; mimeType?: string | null; sizeBytes?: number | null; metadata?: Record<string, unknown> | null;
}) {
  await pool.execute(
    `INSERT INTO processing_artifacts (job_id, source_video_id, kind, storage_key, mime_type, size_bytes, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), size_bytes = VALUES(size_bytes), metadata_json = VALUES(metadata_json)`,
    [input.jobId, input.sourceVideoId, input.kind, input.storageKey, input.mimeType ?? null, input.sizeBytes ?? null, input.metadata ? JSON.stringify(input.metadata) : null],
  );
}

export async function artifactExists(sourceVideoId: number, kind: string): Promise<boolean> {
  const [rows] = await pool.execute<Array<RowDataPacket & { c: number }>>(
    `SELECT COUNT(*) as c FROM processing_artifacts WHERE source_video_id = ? AND kind = ?`,
    [sourceVideoId, kind],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

export async function markJobRunning(jobId: number, attempt: number) {
  await updateJob(jobId, { status: 'processing', started: true, attempt, progress: 1 });
}
