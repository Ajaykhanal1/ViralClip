import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MediaAsset, SourceVideo, SourceVideoStatus, SourceVideoType } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface SourceRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_type: SourceVideoType;
  status: SourceVideoStatus;
  title: string;
  original_filename: string | null;
  source_url: string | null;
  youtube_video_id: string | null;
  thumbnail_url: string | null;
  error_message: string | null;
  created_at: Date;
}

interface AssetRow extends RowDataPacket {
  id: number;
  source_video_id: number;
  kind: 'original' | 'authorized_source';
  storage_key: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | string | null;
  width: number | null;
  height: number | null;
  frame_rate: number | string | null;
  video_codec: string | null;
  audio_codec: string | null;
  audio_channels: number | null;
  audio_sample_rate: number | null;
  created_at: Date;
}

function toAsset(row: AssetRow): MediaAsset {
  const dur = row.duration_seconds == null ? null : Number(row.duration_seconds);
  const fps = row.frame_rate == null ? null : Number(row.frame_rate);
  return {
    id: row.id,
    sourceVideoId: row.source_video_id,
    kind: row.kind,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    durationSeconds: dur != null && Number.isFinite(dur) ? dur : null,
    width: row.width,
    height: row.height,
    frameRate: fps != null && Number.isFinite(fps) ? fps : null,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    audioChannels: row.audio_channels,
    audioSampleRate: row.audio_sample_rate,
    createdAt: row.created_at.toISOString(),
  };
}

function toSource(row: SourceRow, assets: MediaAsset[]): SourceVideo {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    status: row.status,
    title: row.title,
    originalFilename: row.original_filename,
    sourceUrl: row.source_url,
    youtubeVideoId: row.youtube_video_id,
    thumbnailUrl: row.thumbnail_url,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    assets,
  };
}

export async function findProjectOwner(projectId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number }>>(
    `SELECT user_id FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

export async function listSources(userId: number, projectId?: number): Promise<SourceVideo[]> {
  const params: number[] = [userId];
  let where = 'WHERE s.user_id = ?';
  if (projectId) {
    where += ' AND s.project_id = ?';
    params.push(projectId);
  }
  const [rows] = await pool.execute<SourceRow[]>(
    `SELECT id, user_id, project_id, source_type, status, title, original_filename, source_url,
            youtube_video_id, thumbnail_url, error_message, created_at
       FROM source_videos s ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    params,
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [assetRows] = await pool.query<AssetRow[]>(
    `SELECT id, source_video_id, kind, storage_key, original_filename, mime_type, size_bytes,
            duration_seconds, width, height, frame_rate, video_codec, audio_codec, audio_channels,
            audio_sample_rate, created_at
       FROM media_assets WHERE source_video_id IN (?) ORDER BY id ASC`,
    [ids],
  );
  const bySource = new Map<number, MediaAsset[]>();
  for (const a of assetRows) {
    const list = bySource.get(a.source_video_id) ?? [];
    list.push(toAsset(a));
    bySource.set(a.source_video_id, list);
  }
  return rows.map((r) => toSource(r, bySource.get(r.id) ?? []));
}

export async function createYouTubeSource(input: {
  userId: number;
  projectId: number;
  title: string;
  sourceUrl: string;
  youtubeVideoId: string;
  thumbnailUrl: string | null;
  metadataJson: string | null;
}): Promise<SourceVideo> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO source_videos
      (user_id, project_id, source_type, status, title, source_url, youtube_video_id, thumbnail_url, metadata_json)
     VALUES (?, ?, 'youtube', 'awaiting_authorized_source', ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.projectId,
      input.title,
      input.sourceUrl,
      input.youtubeVideoId,
      input.thumbnailUrl,
      input.metadataJson,
    ],
  );
  const source = await findSourceById(input.userId, result.insertId);
  if (!source) throw new Error('Failed to read created source');
  return source;
}

export async function createUploadedSource(input: {
  userId: number;
  projectId: number;
  title: string;
  originalFilename: string;
}): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO source_videos
      (user_id, project_id, source_type, status, title, original_filename)
     VALUES (?, ?, 'upload', 'pending', ?, ?)`,
    [input.userId, input.projectId, input.title, input.originalFilename],
  );
  return result.insertId;
}

export async function insertAsset(input: {
  userId: number;
  sourceVideoId: number;
  kind: 'original' | 'authorized_source';
  storageKey: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO media_assets
      (user_id, source_video_id, kind, storage_key, original_filename, mime_type, size_bytes,
       duration_seconds, width, height, frame_rate, video_codec, audio_codec, audio_channels, audio_sample_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.sourceVideoId,
      input.kind,
      input.storageKey,
      input.originalFilename,
      input.mimeType,
      input.sizeBytes,
      input.durationSeconds,
      input.width,
      input.height,
      input.frameRate,
      input.videoCodec,
      input.audioCodec,
      input.audioChannels,
      input.audioSampleRate,
    ],
  );
}

export async function markSourceReady(userId: number, sourceId: number): Promise<void> {
  await pool.execute(`UPDATE source_videos SET status = 'ready', error_message = NULL WHERE id = ? AND user_id = ?`, [
    sourceId,
    userId,
  ]);
}

export async function markSourceFailed(userId: number, sourceId: number, message: string): Promise<void> {
  await pool.execute(`UPDATE source_videos SET status = 'failed', error_message = ? WHERE id = ? AND user_id = ?`, [
    message.slice(0, 255),
    sourceId,
    userId,
  ]);
}

export async function findSourceById(userId: number, id: number): Promise<SourceVideo | null> {
  const [rows] = await pool.execute<SourceRow[]>(
    `SELECT id, user_id, project_id, source_type, status, title, original_filename, source_url,
            youtube_video_id, thumbnail_url, error_message, created_at
       FROM source_videos WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  if (!rows[0]) return null;
  const [assetRows] = await pool.execute<AssetRow[]>(
    `SELECT id, source_video_id, kind, storage_key, original_filename, mime_type, size_bytes,
            duration_seconds, width, height, frame_rate, video_codec, audio_codec, audio_channels,
            audio_sample_rate, created_at
       FROM media_assets WHERE source_video_id = ? ORDER BY id ASC`,
    [id],
  );
  return toSource(rows[0], assetRows.map(toAsset));
}
