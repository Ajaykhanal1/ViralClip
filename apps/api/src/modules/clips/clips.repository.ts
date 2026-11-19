import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  ClipAnalysisSummary,
  ClipRecommendation,
  ClipSignalScores,
  ClipsForSourceResult,
  ProcessingJob,
  ProcessingJobStatus,
  SuggestedSubtitleConfig,
} from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

const emptySignals: ClipSignalScores = {
  hookStrength: 0,
  emotionalIntensity: 0,
  interestingStatements: 0,
  storyCompleteness: 0,
  educationalValue: 0,
  dialogueQuality: 0,
  sceneChanges: 0,
  speakerChanges: 0,
  audioEnergy: 0,
  visualInterest: 0,
};

const emptySubtitleConfig: SuggestedSubtitleConfig = {
  enabled: true,
  position: 'bottom',
  fontSize: 32,
  textColor: '#FFFFFF',
  backgroundColor: 'rgba(0,0,0,0.6)',
  outlineColor: '#000000',
  maxWordsPerLine: 5,
  highlightKeywords: [],
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

function toSummary(row: RowDataPacket): ClipAnalysisSummary {
  return {
    id: Number(row.id),
    analysisKey: row.analysis_key,
    model: row.model,
    sourceDurationMs: Number(row.source_duration_ms),
    candidatesGenerated: Number(row.candidates_generated),
    overlappingSkipped: Number(row.overlapping_skipped),
    duplicateSkipped: Number(row.duplicate_skipped),
    weights: { ...emptySignals, ...parseJson<Partial<ClipSignalScores>>(row.weights_json, {}) },
    disclaimer: row.disclaimer,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toClip(row: RowDataPacket): ClipRecommendation {
  const startMs = Number(row.start_ms);
  const endMs = Number(row.end_ms);
  const hookMs = Number(row.hook_ms);
  return {
    id: Number(row.id),
    analysisId: Number(row.analysis_id),
    userId: Number(row.user_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    candidateId: row.candidate_id,
    startMs,
    endMs,
    durationMs: Number(row.duration_ms),
    hookMs,
    transcript: row.transcript,
    suggestedTitle: row.suggested_title,
    description: row.description,
    engagementScore: Number(row.engagement_score),
    explanation: row.explanation,
    signals: { ...emptySignals, ...parseJson<Partial<ClipSignalScores>>(row.signals_json, {}) },
    subtitleConfig: { ...emptySubtitleConfig, ...parseJson<Partial<SuggestedSubtitleConfig>>(row.subtitle_config_json, {}) },
    status: row.status,
    startTimestamp: timestamp(startMs),
    endTimestamp: timestamp(endMs),
    hookTimestamp: timestamp(hookMs),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
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
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function findSource(userId: number, sourceVideoId: number): Promise<{ id: number; projectId: number; userId: number } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; project_id: number; user_id: number }>>(
    `SELECT id, project_id, user_id FROM source_videos WHERE id = ? AND user_id = ? LIMIT 1`,
    [sourceVideoId, userId],
  );
  return rows[0] ? { id: Number(rows[0].id), projectId: Number(rows[0].project_id), userId: Number(rows[0].user_id) } : null;
}

export async function getSourceDurationMs(sourceVideoId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { duration_seconds: number | string | null }>>(
    `SELECT duration_seconds FROM media_assets WHERE source_video_id = ? AND kind IN ('original','authorized_source')
      ORDER BY CASE kind WHEN 'original' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [sourceVideoId],
  );
  const value = rows[0]?.duration_seconds;
  const seconds = value == null ? null : Number(value);
  return seconds != null && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

export async function listForSource(userId: number, sourceVideoId: number): Promise<ClipsForSourceResult> {
  const [analyses] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM clip_analyses WHERE user_id = ? AND source_video_id = ? ORDER BY id DESC LIMIT 1`,
    [userId, sourceVideoId],
  );
  const analysis = analyses[0];
  if (!analysis) {
    const [jobs] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM processing_jobs WHERE user_id = ? AND source_video_id = ? AND queue_name = 'ai-analysis' ORDER BY id DESC LIMIT 1`,
      [userId, sourceVideoId],
    );
    return { clips: [], latestAnalysis: null, latestJob: jobs[0] ? toJob(jobs[0]) : null };
  }

  const [clips, jobs] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT * FROM clip_recommendations WHERE user_id = ? AND analysis_id = ?
        ORDER BY FIELD(status, 'suggested', 'selected', 'rejected'), engagement_score DESC, start_ms ASC`,
      [userId, analysis.id],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT * FROM processing_jobs WHERE user_id = ? AND source_video_id = ? AND queue_name = 'ai-analysis' ORDER BY id DESC LIMIT 1`,
      [userId, sourceVideoId],
    ),
  ]);

  return {
    clips: clips[0].map(toClip),
    latestAnalysis: toSummary(analysis),
    latestJob: jobs[0][0] ? toJob(jobs[0][0]) : null,
  };
}

export async function findRecommendation(userId: number, id: number): Promise<ClipRecommendation | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM clip_recommendations WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toClip(rows[0]) : null;
}

export async function updateRecommendation(
  userId: number,
  id: number,
  patch: Record<string, string | number | undefined>,
): Promise<ClipRecommendation | null> {
  const sets: string[] = [];
  const params: Array<string | number> = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (!sets.length) return findRecommendation(userId, id);
  params.push(id, userId);
  await pool.execute<ResultSetHeader>(
    `UPDATE clip_recommendations SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  );
  return findRecommendation(userId, id);
}

export async function findSourceMedia(userId: number, sourceVideoId: number): Promise<{ storageKey: string; mimeType: string | null; originalFilename: string } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { storage_key: string; mime_type: string | null; original_filename: string }>>(
    `SELECT a.storage_key, a.mime_type, a.original_filename
       FROM media_assets a
       JOIN source_videos s ON s.id = a.source_video_id
      WHERE s.id = ? AND s.user_id = ? AND a.kind IN ('original','authorized_source')
      ORDER BY CASE a.kind WHEN 'original' THEN 0 ELSE 1 END, a.id DESC LIMIT 1`,
    [sourceVideoId, userId],
  );
  return rows[0]
    ? { storageKey: rows[0].storage_key, mimeType: rows[0].mime_type ?? null, originalFilename: rows[0].original_filename }
    : null;
}
