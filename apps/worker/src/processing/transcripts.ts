import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/mysql.js';

export interface TranscriptInsertSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
  words?: unknown[] | null;
}

export async function getAudioArtifactKey(sourceVideoId: number): Promise<string | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { storage_key: string }>>(
    `SELECT storage_key FROM processing_artifacts WHERE source_video_id = ? AND kind = 'audio' ORDER BY id DESC LIMIT 1`,
    [sourceVideoId],
  );
  return rows[0]?.storage_key ?? null;
}

export async function getSourceDurationSeconds(sourceVideoId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { duration_seconds: number | string | null }>>(
    `SELECT duration_seconds FROM media_assets
      WHERE source_video_id = ? AND kind IN ('original','authorized_source')
      ORDER BY CASE kind WHEN 'original' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [sourceVideoId],
  );
  const v = rows[0]?.duration_seconds;
  const n = v == null ? null : Number(v);
  return n != null && Number.isFinite(n) ? n : null;
}

export async function insertTranscript(input: {
  userId: number;
  projectId: number;
  sourceVideoId: number;
  processingJobId: number;
  language: string | null;
  detectedLanguage: string | null;
  model: string | null;
  durationSeconds: number | null;
  originalPayload: unknown;
}): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO transcripts
      (user_id, project_id, source_video_id, processing_job_id, language, detected_language, model, duration_seconds, status, is_original, original_payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 1, ?)`,
    [
      input.userId,
      input.projectId,
      input.sourceVideoId,
      input.processingJobId,
      input.language,
      input.detectedLanguage,
      input.model,
      input.durationSeconds,
      JSON.stringify(input.originalPayload ?? null),
    ],
  );
  return res.insertId;
}

export async function insertTranscriptSegments(transcriptId: number, segments: TranscriptInsertSegment[]): Promise<void> {
  if (!segments.length) return;
  // insert in batches to keep queries reasonable
  const chunkSize = 200;
  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunk = segments.slice(i, i + chunkSize);
    const values: string[] = [];
    const params: Array<number | string | null> = [];
    for (const s of chunk) {
      values.push('(?, ?, ?, ?, ?, ?, ?)');
      params.push(
        transcriptId,
        s.index,
        s.startMs,
        s.endMs,
        s.text,
        s.speaker ?? null,
        s.words ? JSON.stringify(s.words) : null,
      );
    }
    await pool.execute(
      `INSERT INTO transcript_segments (transcript_id, segment_index, start_ms, end_ms, text, speaker, words_json)
       VALUES ${values.join(',')}`,
      params,
    );
  }
}

export async function createSubtitleTrack(input: {
  userId: number;
  projectId: number;
  sourceVideoId: number;
  transcriptId: number | null;
  name: string;
  language: string | null;
  isDefault: boolean;
  style?: Record<string, unknown> | null;
}): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO subtitle_tracks (user_id, project_id, source_video_id, transcript_id, name, language, is_default, style_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, input.projectId, input.sourceVideoId, input.transcriptId, input.name, input.language, input.isDefault ? 1 : 0, input.style ? JSON.stringify(input.style) : null],
  );
  return res.insertId;
}

export async function clearSubtitleSegments(trackId: number): Promise<void> {
  await pool.execute(`DELETE FROM subtitle_segments WHERE track_id = ?`, [trackId]);
}

export async function insertSubtitleSegments(trackId: number, segments: Array<{ index: number; startMs: number; endMs: number; text: string; speaker?: string | null }>): Promise<void> {
  if (!segments.length) return;
  const chunkSize = 200;
  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunk = segments.slice(i, i + chunkSize);
    const values: string[] = [];
    const params: Array<number | string | null> = [];
    for (const s of chunk) {
      values.push('(?, ?, ?, ?, ?, ?)');
      params.push(trackId, s.index, s.startMs, s.endMs, s.text, s.speaker ?? null);
    }
    await pool.execute(
      `INSERT INTO subtitle_segments (track_id, segment_index, start_ms, end_ms, text, speaker)
       VALUES ${values.join(',')}`,
      params,
    );
  }
}

export async function updateSubtitleTrackTranscript(trackId: number, transcriptId: number, language: string | null): Promise<void> {
  await pool.execute(`UPDATE subtitle_tracks SET transcript_id = ?, language = ? WHERE id = ?`, [transcriptId, language, trackId]);
}

export async function unsetDefaultTracks(sourceVideoId: number): Promise<void> {
  await pool.execute(`UPDATE subtitle_tracks SET is_default = 0 WHERE source_video_id = ?`, [sourceVideoId]);
}

export async function findOwnedSubtitleTrack(trackId: number, userId: number): Promise<{ id: number; sourceVideoId: number } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; source_video_id: number }>>(
    `SELECT id, source_video_id FROM subtitle_tracks WHERE id = ? AND user_id = ? LIMIT 1`,
    [trackId, userId],
  );
  return rows[0] ? { id: rows[0].id, sourceVideoId: Number(rows[0].source_video_id) } : null;
}
