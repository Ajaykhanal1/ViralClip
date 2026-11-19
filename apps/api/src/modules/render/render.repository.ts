import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ProcessingJobStatus, RenderedVideo, RenderJob, RenderQuality } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface JobRow extends RowDataPacket {
  id: number;
  user_id: number;
  edit_id: number;
  draft_id: number;
  project_id: number;
  source_video_id: number;
  processing_job_id: number | null;
  status: ProcessingJobStatus;
  progress: number;
  attempt: number;
  max_attempts: number;
  configuration_version: number;
  error_code: string | null;
  error_message: string | null;
  payload_json: string;
  result_json: string | null;
  cancel_requested: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface VideoRow extends RowDataPacket {
  id: number;
  user_id: number;
  render_job_id: number;
  edit_id: number;
  draft_id: number;
  project_id: number;
  source_video_id: number;
  storage_key: string;
  thumbnail_key: string | null;
  container: string;
  video_codec: string;
  audio_codec: string;
  width: number;
  height: number;
  duration_ms: number;
  file_size: number;
  configuration_version: number;
  quality_json: string;
  created_at: Date;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toJob(row: JobRow): RenderJob {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    editId: Number(row.edit_id),
    draftId: Number(row.draft_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    processingJobId: row.processing_job_id == null ? null : Number(row.processing_job_id),
    status: row.status,
    progress: Number(row.progress ?? 0),
    attempt: Number(row.attempt ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    configurationVersion: Number(row.configuration_version),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    result: parseJson<Record<string, unknown> | null>(row.result_json, null),
    cancelRequested: !!row.cancel_requested,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toVideo(row: VideoRow): RenderedVideo {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    renderJobId: Number(row.render_job_id),
    editId: Number(row.edit_id),
    draftId: Number(row.draft_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    storageKey: row.storage_key,
    thumbnailKey: row.thumbnail_key,
    container: row.container,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    width: Number(row.width),
    height: Number(row.height),
    durationMs: Number(row.duration_ms),
    fileSize: Number(row.file_size),
    configurationVersion: Number(row.configuration_version),
    quality: parseJson<RenderQuality>(row.quality_json, { fileExists: false, readable: false, correctAspectRatio: false, correctDimensions: false, audioPresent: false, durationValid: false, ok: false, reasons: [] }),
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertRenderJob(input: {
  userId: number;
  editId: number;
  draftId: number;
  projectId: number;
  sourceVideoId: number;
  configurationVersion: number;
  payload: Record<string, unknown>;
}): Promise<RenderJob> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO render_jobs
      (user_id, edit_id, draft_id, project_id, source_video_id, configuration_version, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.editId, input.draftId, input.projectId, input.sourceVideoId,
      input.configurationVersion, JSON.stringify(input.payload),
    ],
  );
  return (await findRenderJob(input.userId, result.insertId))!;
}

export async function findRenderJob(userId: number, id: number): Promise<RenderJob | null> {
  const [rows] = await pool.execute<JobRow[]>(
    `SELECT * FROM render_jobs WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listRenderJobs(userId: number, editId?: number): Promise<RenderJob[]> {
  const [rows] = await pool.execute<JobRow[]>(
    `SELECT * FROM render_jobs WHERE user_id = ? ${editId ? 'AND edit_id = ?' : ''} ORDER BY id DESC LIMIT 100`,
    editId ? [userId, editId] : [userId],
  );
  return rows.map(toJob);
}

export async function listRenderedVideos(userId: number, editId?: number): Promise<RenderedVideo[]> {
  const [rows] = await pool.execute<VideoRow[]>(
    `SELECT * FROM rendered_videos WHERE user_id = ? ${editId ? 'AND edit_id = ?' : ''} ORDER BY id DESC LIMIT 100`,
    editId ? [userId, editId] : [userId],
  );
  return rows.map(toVideo);
}

export async function findRenderedVideo(userId: number, id: number): Promise<RenderedVideo | null> {
  const [rows] = await pool.execute<VideoRow[]>(
    `SELECT * FROM rendered_videos WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toVideo(rows[0]) : null;
}

export async function linkProcessingJob(id: number, processingJobId: number): Promise<void> {
  await pool.execute(`UPDATE render_jobs SET processing_job_id = ? WHERE id = ?`, [processingJobId, id]);
}

export async function updateRenderJob(id: number, patch: {
  status?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  completed?: boolean;
}): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.errorCode !== undefined) { sets.push('error_code = ?'); params.push(patch.errorCode); }
  if (patch.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(patch.errorMessage); }
  if (patch.completed) sets.push('completed_at = CURRENT_TIMESTAMP');
  if (!sets.length) return;
  await pool.execute(`UPDATE render_jobs SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export async function requestCancel(userId: number, id: number): Promise<void> {
  await pool.execute(
    `UPDATE render_jobs SET cancel_requested = 1, status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status IN ('queued','processing')`,
    [id, userId],
  );
}
