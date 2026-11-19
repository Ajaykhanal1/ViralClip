import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { RenderQuality } from '@viralclip/shared';
import { pool } from '../db/mysql.js';

export async function isRenderCancelled(renderJobId: number): Promise<boolean> {
  const [rows] = await pool.execute<Array<RowDataPacket & { cancel_requested: number; status: string }>>(
    `SELECT cancel_requested, status FROM render_jobs WHERE id = ? LIMIT 1`,
    [renderJobId],
  );
  const row = rows[0];
  return !!row && (!!row.cancel_requested || row.status === 'cancelled');
}

export async function updateRenderJob(renderJobId: number, patch: {
  status?: string;
  progress?: number;
  attempt?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
  started?: boolean;
  completed?: boolean;
}): Promise<void> {
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
  params.push(renderJobId);
  await pool.execute(`UPDATE render_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function insertRenderedVideo(input: {
  userId: number;
  renderJobId: number;
  editId: number;
  draftId: number;
  projectId: number;
  sourceVideoId: number;
  storageKey: string;
  thumbnailKey: string | null;
  width: number;
  height: number;
  durationMs: number;
  fileSize: number;
  configurationVersion: number;
  quality: RenderQuality;
}): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO rendered_videos
      (user_id, render_job_id, edit_id, draft_id, project_id, source_video_id, storage_key, thumbnail_key,
       width, height, duration_ms, file_size, configuration_version, quality_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.renderJobId, input.editId, input.draftId, input.projectId, input.sourceVideoId,
      input.storageKey, input.thumbnailKey, input.width, input.height, input.durationMs, input.fileSize,
      input.configurationVersion, JSON.stringify(input.quality),
    ],
  );
  return result.insertId;
}
