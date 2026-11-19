import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ClipSignalScores, SuggestedSubtitleConfig } from '@viralclip/shared';
import { pool } from '../db/mysql.js';

export interface AiClip {
  candidateId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  hookMs: number;
  transcript: string;
  suggestedTitle: string;
  description: string;
  engagementScore: number;
  explanation: string;
  signals: ClipSignalScores;
  subtitleConfig: SuggestedSubtitleConfig;
}

export interface AiAnalysis {
  analysisKey: string;
  model: string;
  sourceDurationMs: number;
  candidatesGenerated: number;
  overlappingSkipped: number;
  duplicateSkipped: number;
  weights: ClipSignalScores;
  disclaimer: string;
  clips: AiClip[];
}

export interface TranscriptSegmentForAnalysis {
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.round(value)));
}

/** AI output is untrusted: every timestamp is clamped to the real source duration. */
export function normalizeClips(raw: unknown, durationMs: number): AiClip[] {
  if (!Array.isArray(raw)) return [];
  const clips: AiClip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const clip = item as Partial<AiClip>;
    if (!clip.candidateId || !clip.transcript || !clip.suggestedTitle || !clip.description) continue;
    const rawStart = Number(clip.startMs);
    const rawEnd = Number(clip.endMs);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    const startMs = clamp(rawStart, 0, durationMs);
    const endMs = clamp(rawEnd, startMs + 1, durationMs);
    if (endMs <= startMs) continue;
    clips.push({
      candidateId: String(clip.candidateId),
      startMs,
      endMs,
      durationMs: endMs - startMs,
      hookMs: clamp(Number(clip.hookMs ?? startMs), startMs, endMs),
      transcript: String(clip.transcript),
      suggestedTitle: String(clip.suggestedTitle),
      description: String(clip.description),
      engagementScore: Math.max(0, Math.min(100, Number(clip.engagementScore) || 0)),
      explanation: String(clip.explanation ?? ''),
      signals: (clip.signals ?? {}) as ClipSignalScores,
      subtitleConfig: (clip.subtitleConfig ?? {}) as SuggestedSubtitleConfig,
    });
  }
  return clips;
}

export async function getLatestTranscriptForAnalysis(userId: number, sourceVideoId: number): Promise<{
  segments: TranscriptSegmentForAnalysis[];
  durationMs: number | null;
} | null> {
  const [transcripts] = await pool.execute<Array<RowDataPacket & { id: number; duration_seconds: number | string | null }>>(
    `SELECT id, duration_seconds FROM transcripts
      WHERE user_id = ? AND source_video_id = ? ORDER BY id DESC LIMIT 1`,
    [userId, sourceVideoId],
  );
  const transcript = transcripts[0];
  if (!transcript) return null;

  const [rows] = await pool.execute<Array<RowDataPacket & { start_ms: number; end_ms: number; text: string; speaker: string | null }>>(
    `SELECT start_ms, end_ms, text, speaker FROM transcript_segments
      WHERE transcript_id = ? ORDER BY start_ms ASC, id ASC`,
    [transcript.id],
  );
  const segments = rows.map((row) => ({
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: row.text ?? '',
    speaker: row.speaker ?? null,
  }));
  const seconds = transcript.duration_seconds == null ? null : Number(transcript.duration_seconds);
  return {
    segments,
    durationMs: seconds != null && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
  };
}

export async function persistAnalysis(input: {
  userId: number;
  projectId: number;
  sourceVideoId: number;
  processingJobId: number;
  analysis: AiAnalysis;
}): Promise<number> {
  const { analysis } = input;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO clip_analyses
        (user_id, project_id, source_video_id, processing_job_id, analysis_key, model, source_duration_ms,
         candidates_generated, overlapping_skipped, duplicate_skipped, weights_json, disclaimer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.projectId,
        input.sourceVideoId,
        input.processingJobId,
        analysis.analysisKey,
        analysis.model,
        analysis.sourceDurationMs,
        analysis.candidatesGenerated,
        analysis.overlappingSkipped,
        analysis.duplicateSkipped,
        JSON.stringify(analysis.weights),
        analysis.disclaimer,
      ],
    );
    const analysisId = result.insertId;

    for (const clip of analysis.clips) {
      await conn.execute(
        `INSERT INTO clip_recommendations
          (analysis_id, user_id, project_id, source_video_id, candidate_id, start_ms, end_ms, duration_ms,
           hook_ms, transcript, suggested_title, description, engagement_score, explanation, signals_json,
           subtitle_config_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested')`,
        [
          analysisId,
          input.userId,
          input.projectId,
          input.sourceVideoId,
          clip.candidateId,
          clip.startMs,
          clip.endMs,
          clip.durationMs,
          clip.hookMs,
          clip.transcript,
          clip.suggestedTitle,
          clip.description,
          clip.engagementScore,
          clip.explanation,
          JSON.stringify(clip.signals),
          JSON.stringify(clip.subtitleConfig),
        ],
      );
    }

    await conn.commit();
    return analysisId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
