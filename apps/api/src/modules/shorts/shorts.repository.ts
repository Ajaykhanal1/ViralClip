import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  ProcessingJob,
  ProcessingJobStatus,
  ShortAudioConfig,
  ShortDraft,
  ShortFramingMode,
  ShortsForSourceResult,
  ShortTextConfig,
  SuggestedSubtitleConfig,
} from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface ShortRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_video_id: number;
  recommendation_id: number | null;
  analysis_id: number | null;
  version: number;
  status: ProcessingJobStatus;
  selected: number;
  title: string;
  description: string;
  start_ms: number;
  end_ms: number;
  hook_ms: number;
  duration_ms: number;
  width: number;
  height: number;
  framing: ShortFramingMode;
  crop_x: number | string;
  crop_y: number | string;
  subtitle_config_json: string | null;
  audio_config_json: string;
  intro_json: string;
  outro_json: string;
  edit_data_json: string;
  storage_key: string | null;
  thumbnail_key: string | null;
  error_message: string | null;
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

function iso(value: Date): string {
  return new Date(value).toISOString();
}

function toDraft(row: ShortRow): ShortDraft {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    recommendationId: row.recommendation_id == null ? null : Number(row.recommendation_id),
    analysisId: row.analysis_id == null ? null : Number(row.analysis_id),
    version: Number(row.version),
    status: row.status,
    selected: !!row.selected,
    title: row.title,
    description: row.description,
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    hookMs: Number(row.hook_ms),
    durationMs: Number(row.duration_ms),
    width: Number(row.width),
    height: Number(row.height),
    framing: row.framing,
    cropX: Number(row.crop_x),
    cropY: Number(row.crop_y),
    subtitleConfig: parseJson<SuggestedSubtitleConfig | null>(row.subtitle_config_json, null),
    audioConfig: parseJson<ShortAudioConfig>(row.audio_config_json, { volume: 1, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 }),
    intro: parseJson<ShortTextConfig>(row.intro_json, { text: '', seconds: 0 }),
    outro: parseJson<ShortTextConfig>(row.outro_json, { text: '', seconds: 0 }),
    editData: parseJson<Record<string, unknown>>(row.edit_data_json, {}),
    storageKey: row.storage_key ?? null,
    thumbnailKey: row.thumbnail_key ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toJob(row: RowDataPacket): ProcessingJob {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    queueName: row.queue_name,
    jobType: row.job_type,
    bullmqJobId: row.bullmq_job_id ?? null,
    status: row.status as ProcessingJobStatus,
    progress: Number(row.progress ?? 0),
    attempt: Number(row.attempt ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    cancelRequested: !!row.cancel_requested,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    startedAt: row.started_at ? iso(row.started_at as unknown as Date) : null,
    completedAt: row.completed_at ? iso(row.completed_at as unknown as Date) : null,
    createdAt: iso(row.created_at as unknown as Date),
    updatedAt: iso(row.updated_at as unknown as Date),
  };
}

export async function findSource(userId: number, sourceVideoId: number): Promise<{ id: number; projectId: number; userId: number } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; project_id: number; user_id: number }>>(
    `SELECT id, project_id, user_id FROM source_videos WHERE id = ? AND user_id = ? LIMIT 1`,
    [sourceVideoId, userId],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), projectId: Number(row.project_id), userId: Number(row.user_id) } : null;
}

export interface SelectedClip {
  id: number;
  analysisId: number;
  startMs: number;
  endMs: number;
  hookMs: number;
  durationMs: number;
  title: string;
  description: string;
  subtitleConfig: SuggestedSubtitleConfig | null;
}

export async function listSelectedClips(userId: number, sourceVideoId: number): Promise<SelectedClip[]> {
  const [rows] = await pool.execute<Array<RowDataPacket & {
    id: number; analysis_id: number; start_ms: number; end_ms: number; hook_ms: number; duration_ms: number;
    suggested_title: string; description: string; subtitle_config_json: string | null;
  }>>(
    `SELECT id, analysis_id, start_ms, end_ms, hook_ms, duration_ms, suggested_title, description, subtitle_config_json
       FROM clip_recommendations WHERE user_id = ? AND source_video_id = ? AND status = 'selected'
      ORDER BY engagement_score DESC, start_ms ASC`,
    [userId, sourceVideoId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    analysisId: Number(row.analysis_id),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    hookMs: Number(row.hook_ms),
    durationMs: Number(row.duration_ms),
    title: row.suggested_title,
    description: row.description,
    subtitleConfig: parseJson<SuggestedSubtitleConfig | null>(row.subtitle_config_json, null),
  }));
}

export async function nextVersion(recommendationId: number | null): Promise<number> {
  if (recommendationId == null) return 1;
  const [rows] = await pool.execute<Array<RowDataPacket & { version: number }>>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM shorts_drafts WHERE recommendation_id = ?`,
    [recommendationId],
  );
  return Number(rows[0]?.version ?? 1);
}

export interface DraftInsert {
  userId: number;
  projectId: number;
  sourceVideoId: number;
  recommendationId: number | null;
  analysisId: number | null;
  version: number;
  title: string;
  description: string;
  startMs: number;
  endMs: number;
  hookMs: number;
  durationMs: number;
  width: number;
  height: number;
  framing: ShortFramingMode;
  cropX: number;
  cropY: number;
  subtitleConfig: SuggestedSubtitleConfig | null;
  audioConfig: ShortAudioConfig;
  intro: ShortTextConfig;
  outro: ShortTextConfig;
  editData: Record<string, unknown>;
}

export async function insertDraft(input: DraftInsert): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO shorts_drafts
      (user_id, project_id, source_video_id, recommendation_id, analysis_id, version, title, description,
       start_ms, end_ms, hook_ms, duration_ms, width, height, framing, crop_x, crop_y,
       subtitle_config_json, audio_config_json, intro_json, outro_json, edit_data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.projectId, input.sourceVideoId, input.recommendationId, input.analysisId, input.version,
      input.title, input.description, input.startMs, input.endMs, input.hookMs, input.durationMs,
      input.width, input.height, input.framing, input.cropX, input.cropY,
      input.subtitleConfig ? JSON.stringify(input.subtitleConfig) : null,
      JSON.stringify(input.audioConfig), JSON.stringify(input.intro), JSON.stringify(input.outro),
      JSON.stringify(input.editData),
    ],
  );
  return result.insertId;
}

export async function listForSource(userId: number, sourceVideoId: number): Promise<ShortsForSourceResult> {
  const [drafts, jobs] = await Promise.all([
    pool.execute<ShortRow[]>(
      `SELECT * FROM shorts_drafts WHERE user_id = ? AND source_video_id = ? ORDER BY id DESC`,
      [userId, sourceVideoId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT * FROM processing_jobs WHERE user_id = ? AND source_video_id = ? AND queue_name = 'video-rendering' ORDER BY id DESC LIMIT 1`,
      [userId, sourceVideoId],
    ),
  ]);
  return { drafts: drafts[0].map(toDraft), latestJob: jobs[0][0] ? toJob(jobs[0][0]) : null };
}

export async function findDraft(userId: number, id: number): Promise<ShortDraft | null> {
  const [rows] = await pool.execute<ShortRow[]>(
    `SELECT * FROM shorts_drafts WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toDraft(rows[0]) : null;
}

/** Keys are snake_case column names; callers map validated input explicitly. */
export async function updateDraft(userId: number, id: number, patch: Record<string, string | number | null>): Promise<ShortDraft | null> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!entries.length) return findDraft(userId, id);
  // Column names come from a fixed server-side map only, never from request keys.
  const params: Array<string | number | null> = entries.map(([, value]) => value);
  const sets = entries.map(([column]) => `${column} = ?`);
  params.push(id, userId);
  await pool.execute<ResultSetHeader>(
    `UPDATE shorts_drafts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  );
  return findDraft(userId, id);
}

export async function findDraftMedia(userId: number, id: number): Promise<{ storageKey: string; mimeType: string; title: string } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { storage_key: string; title: string }>>(
    `SELECT storage_key, title FROM shorts_drafts WHERE id = ? AND user_id = ? AND status = 'completed' AND storage_key IS NOT NULL LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? { storageKey: rows[0].storage_key, mimeType: 'video/mp4', title: rows[0].title } : null;
}

export async function findDraftThumbnail(userId: number, id: number): Promise<{ storageKey: string } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { thumbnail_key: string }>>(
    `SELECT thumbnail_key FROM shorts_drafts WHERE id = ? AND user_id = ? AND status = 'completed' AND thumbnail_key IS NOT NULL LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? { storageKey: rows[0].thumbnail_key } : null;
}
