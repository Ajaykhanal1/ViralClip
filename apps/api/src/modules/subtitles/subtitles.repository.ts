import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { SubtitleSegment, SubtitleStyle, SubtitleTrack, Transcript, TranscriptSegment, TranscriptWord } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

function parseJson<T>(v: string | null): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function toTranscript(r: RowDataPacket): Transcript {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    projectId: Number(r.project_id),
    sourceVideoId: Number(r.source_video_id),
    processingJobId: r.processing_job_id == null ? null : Number(r.processing_job_id),
    language: r.language ?? null,
    detectedLanguage: r.detected_language ?? null,
    model: r.model ?? null,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    status: r.status,
    isOriginal: !!r.is_original,
    errorMessage: r.error_message ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toTranscriptSegment(r: RowDataPacket): TranscriptSegment {
  return {
    id: Number(r.id),
    transcriptId: Number(r.transcript_id),
    segmentIndex: Number(r.segment_index),
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    text: r.text ?? '',
    speaker: r.speaker ?? null,
    words: parseJson<TranscriptWord[]>(r.words_json ?? null),
  };
}

function toTrack(r: RowDataPacket): SubtitleTrack {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    projectId: Number(r.project_id),
    sourceVideoId: Number(r.source_video_id),
    transcriptId: r.transcript_id == null ? null : Number(r.transcript_id),
    name: r.name,
    language: r.language ?? null,
    isDefault: !!r.is_default,
    style: parseJson<SubtitleStyle>(r.style_json ?? null),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toSegment(r: RowDataPacket): SubtitleSegment {
  return {
    id: Number(r.id),
    trackId: Number(r.track_id),
    segmentIndex: Number(r.segment_index),
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    text: r.text ?? '',
    speaker: r.speaker ?? null,
  };
}

export async function findProjectOwner(projectId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number }>>(`SELECT user_id FROM projects WHERE id = ? LIMIT 1`, [projectId]);
  return rows[0] ? Number(rows[0].user_id) : null;
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
  const v = rows[0]?.duration_seconds;
  const n = v == null ? null : Number(v);
  return n != null && Number.isFinite(n) ? Math.round(n * 1000) : null;
}

export async function listTranscripts(userId: number, sourceVideoId: number): Promise<Transcript[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM transcripts WHERE user_id = ? AND source_video_id = ? ORDER BY id DESC`,
    [userId, sourceVideoId],
  );
  return rows.map(toTranscript);
}

export async function getTranscript(userId: number, transcriptId: number): Promise<Transcript | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM transcripts WHERE id = ? AND user_id = ? LIMIT 1`, [transcriptId, userId]);
  if (!rows[0]) return null;
  const t = toTranscript(rows[0]);
  const [segs] = await pool.execute<RowDataPacket[]>(`SELECT * FROM transcript_segments WHERE transcript_id = ? ORDER BY segment_index ASC, id ASC`, [transcriptId]);
  t.segments = segs.map(toTranscriptSegment);
  return t;
}

export async function listTracks(userId: number, sourceVideoId: number): Promise<SubtitleTrack[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM subtitle_tracks WHERE user_id = ? AND source_video_id = ? ORDER BY is_default DESC, id DESC`,
    [userId, sourceVideoId],
  );
  return rows.map(toTrack);
}

export async function getTrack(userId: number, trackId: number): Promise<SubtitleTrack | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM subtitle_tracks WHERE id = ? AND user_id = ? LIMIT 1`, [trackId, userId]);
  if (!rows[0]) return null;
  const track = toTrack(rows[0]);
  const [segs] = await pool.execute<RowDataPacket[]>(`SELECT * FROM subtitle_segments WHERE track_id = ? ORDER BY segment_index ASC, id ASC`, [trackId]);
  track.segments = segs.map(toSegment);
  return track;
}

export async function findTrack(userId: number, trackId: number): Promise<SubtitleTrack | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM subtitle_tracks WHERE id = ? AND user_id = ? LIMIT 1`, [trackId, userId]);
  return rows[0] ? toTrack(rows[0]) : null;
}

export async function updateTrack(trackId: number, userId: number, patch: { name?: string; language?: string | null; style?: SubtitleStyle | null }): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
  if (patch.language !== undefined) { sets.push('language = ?'); params.push(patch.language); }
  if (patch.style !== undefined) { sets.push('style_json = ?'); params.push(patch.style ? JSON.stringify(patch.style) : null); }
  if (!sets.length) return;
  params.push(trackId, userId);
  await pool.execute(`UPDATE subtitle_tracks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
}

export async function replaceSegments(trackId: number, segments: Array<{ startMs: number; endMs: number; text: string; speaker?: string | null }>): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM subtitle_segments WHERE track_id = ?`, [trackId]);
    if (segments.length) {
      const chunkSize = 200;
      for (let i = 0; i < segments.length; i += chunkSize) {
        const chunk = segments.slice(i, i + chunkSize);
        const values: string[] = [];
        const params: Array<number | string | null> = [];
        for (let j = 0; j < chunk.length; j++) {
          const s = chunk[j]!;
          values.push('(?, ?, ?, ?, ?, ?)');
          params.push(trackId, i + j, s.startMs, s.endMs, s.text, s.speaker ?? null);
        }
        await conn.execute(`INSERT INTO subtitle_segments (track_id, segment_index, start_ms, end_ms, text, speaker) VALUES ${values.join(',')}`, params);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function getTrackSegments(userId: number, trackId: number): Promise<SubtitleSegment[] | null> {
  const track = await findTrack(userId, trackId);
  if (!track) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM subtitle_segments WHERE track_id = ? ORDER BY segment_index ASC, id ASC`, [trackId]);
  return rows.map(toSegment);
}
