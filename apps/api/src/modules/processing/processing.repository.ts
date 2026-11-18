import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ProcessingArtifact, ProcessingJob, ProcessingJobLog, ProcessingJobStatus } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface JobRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_video_id: number;
  queue_name: string;
  job_type: string;
  bullmq_job_id: string | null;
  status: ProcessingJobStatus;
  progress: number;
  attempt: number;
  max_attempts: number;
  cancel_requested: number;
  error_code: string | null;
  error_message: string | null;
  payload_json: string | null;
  result_json: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface LogRow extends RowDataPacket {
  id: number;
  job_id: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details_json: string | null;
  created_at: Date;
}

interface ArtifactRow extends RowDataPacket {
  id: number;
  job_id: number;
  source_video_id: number;
  kind: string;
  storage_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  metadata_json: string | null;
  created_at: Date;
}

function toJob(r: JobRow): ProcessingJob {
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    sourceVideoId: r.source_video_id,
    queueName: r.queue_name,
    jobType: r.job_type,
    bullmqJobId: r.bullmq_job_id,
    status: r.status,
    progress: Number(r.progress ?? 0),
    attempt: Number(r.attempt ?? 0),
    maxAttempts: Number(r.max_attempts ?? 3),
    cancelRequested: !!r.cancel_requested,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function toLog(r: LogRow): ProcessingJobLog {
  return {
    id: r.id,
    jobId: r.job_id,
    level: r.level,
    message: r.message,
    details: r.details_json ? (JSON.parse(r.details_json) as Record<string, unknown>) : null,
    createdAt: r.created_at.toISOString(),
  };
}

function toArtifact(r: ArtifactRow): ProcessingArtifact {
  return {
    id: r.id,
    jobId: r.job_id,
    sourceVideoId: r.source_video_id,
    kind: r.kind,
    storageKey: r.storage_key,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    metadata: r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : null,
    createdAt: r.created_at.toISOString(),
  };
}

export async function findProjectOwner(projectId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number }>>(
    `SELECT user_id FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

export async function findSource(userId: number, sourceVideoId: number): Promise<{ id: number; projectId: number; userId: number; status: string } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; project_id: number; user_id: number; status: string }>>(
    `SELECT id, project_id, user_id, status FROM source_videos WHERE id = ? AND user_id = ? LIMIT 1`,
    [sourceVideoId, userId],
  );
  return rows[0] ? { id: rows[0].id, projectId: Number(rows[0].project_id), userId: Number(rows[0].user_id), status: rows[0].status } : null;
}

export async function insertJob(input: {
  userId: number; projectId: number; sourceVideoId: number; queueName: string; jobType: string;
  maxAttempts: number; payload?: Record<string, unknown> | null;
}): Promise<ProcessingJob> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO processing_jobs
      (user_id, project_id, source_video_id, queue_name, job_type, status, progress, max_attempts, payload_json)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    [input.userId, input.projectId, input.sourceVideoId, input.queueName, input.jobType, input.maxAttempts, input.payload ? JSON.stringify(input.payload) : null],
  );
  const job = await findJobByIdForUser(input.userId, res.insertId);
  if (!job) throw new Error('Failed to read processing job');
  return job;
}

export async function setBullmqJobId(jobId: number, bullmqJobId: string): Promise<void> {
  await pool.execute(`UPDATE processing_jobs SET bullmq_job_id = ? WHERE id = ?`, [bullmqJobId, jobId]);
}

export async function findJobByIdForUser(userId: number, id: number): Promise<ProcessingJob | null> {
  const [rows] = await pool.execute<JobRow[]>(`SELECT * FROM processing_jobs WHERE id = ? AND user_id = ? LIMIT 1`, [id, userId]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function findJobById(id: number): Promise<ProcessingJob | null> {
  const [rows] = await pool.execute<JobRow[]>(`SELECT * FROM processing_jobs WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listJobs(userId: number, filters: { projectId?: number; sourceVideoId?: number; status?: ProcessingJobStatus }): Promise<ProcessingJob[]> {
  const where = ['user_id = ?'];
  const params: Array<number | string> = [userId];
  if (filters.projectId) { where.push('project_id = ?'); params.push(filters.projectId); }
  if (filters.sourceVideoId) { where.push('source_video_id = ?'); params.push(filters.sourceVideoId); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  const [rows] = await pool.execute<JobRow[]>(
    `SELECT * FROM processing_jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 200`,
    params,
  );
  return rows.map(toJob);
}

export async function requestCancel(userId: number, id: number): Promise<ProcessingJob | null> {
  await pool.execute(
    `UPDATE processing_jobs SET cancel_requested = 1, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
       completed_at = CASE WHEN status = 'queued' THEN CURRENT_TIMESTAMP ELSE completed_at END
     WHERE id = ? AND user_id = ? AND status IN ('queued','processing')`,
    [id, userId],
  );
  return findJobByIdForUser(userId, id);
}

export async function appendLog(jobId: number, level: 'debug'|'info'|'warn'|'error', message: string, details?: Record<string, unknown> | null): Promise<void> {
  await pool.execute(
    `INSERT INTO processing_job_logs (job_id, level, message, details_json) VALUES (?, ?, ?, ?)`,
    [jobId, level, message, details ? JSON.stringify(details) : null],
  );
}

export async function listLogs(userId: number, jobId: number): Promise<ProcessingJobLog[]> {
  const job = await findJobByIdForUser(userId, jobId);
  if (!job) return [];
  const [rows] = await pool.execute<LogRow[]>(
    `SELECT id, job_id, level, message, details_json, created_at FROM processing_job_logs WHERE job_id = ? ORDER BY id ASC LIMIT 500`,
    [jobId],
  );
  return rows.map(toLog);
}

export async function updateJobProgress(jobId: number, patch: {
  status?: ProcessingJobStatus; progress?: number; attempt?: number; errorCode?: string | null; errorMessage?: string | null; result?: Record<string, unknown> | null; started?: boolean; completed?: boolean;
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
  params.push(jobId);
  await pool.execute(`UPDATE processing_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function isCancelRequested(jobId: number): Promise<boolean> {
  const [rows] = await pool.execute<Array<RowDataPacket & { cancel_requested: number }>>(
    `SELECT cancel_requested FROM processing_jobs WHERE id = ? LIMIT 1`,
    [jobId],
  );
  return !!rows[0]?.cancel_requested;
}

export async function findActiveJobForSource(sourceVideoId: number, queueName?: string): Promise<ProcessingJob | null> {
  const where = ['source_video_id = ?', "status IN ('queued','processing')"];
  const params: Array<number | string> = [sourceVideoId];
  if (queueName) { where.push('queue_name = ?'); params.push(queueName); }
  const [rows] = await pool.execute<JobRow[]>(
    `SELECT * FROM processing_jobs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 1`,
    params,
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function setSourceStatus(userId: number, sourceVideoId: number, status: string, errorMessage?: string | null): Promise<void> {
  await pool.execute(
    `UPDATE source_videos SET status = ?, error_message = ? WHERE id = ? AND user_id = ?`,
    [status, errorMessage ?? null, sourceVideoId, userId],
  );
}

export async function insertArtifact(input: {
  jobId: number; sourceVideoId: number; kind: string; storageKey: string; mimeType?: string | null; sizeBytes?: number | null; metadata?: Record<string, unknown> | null;
}): Promise<ProcessingArtifact> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO processing_artifacts (job_id, source_video_id, kind, storage_key, mime_type, size_bytes, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), size_bytes = VALUES(size_bytes), metadata_json = VALUES(metadata_json)`,
    [input.jobId, input.sourceVideoId, input.kind, input.storageKey, input.mimeType ?? null, input.sizeBytes ?? null, input.metadata ? JSON.stringify(input.metadata) : null],
  );
  const id = res.insertId || 0;
  const [rows] = await pool.execute<ArtifactRow[]>(
    `SELECT * FROM processing_artifacts WHERE ${id ? 'id = ?' : 'storage_key = ?'} LIMIT 1`,
    [id || input.storageKey],
  );
  if (!rows[0]) throw new Error('Failed to read artifact');
  return toArtifact(rows[0]);
}
