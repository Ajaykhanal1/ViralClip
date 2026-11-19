import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ClipEdit, EditVersion, EditorAsset, EditorTimeline, ShortDraft, SuggestedSubtitleConfig, ShortTextConfig } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface DraftRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_video_id: number;
  start_ms: number;
  end_ms: number;
  hook_ms: number;
  width: number;
  height: number;
  subtitle_config_json: string | null;
  intro_json: string;
  outro_json: string;
}

export interface DraftForEdit {
  id: number;
  userId: number;
  projectId: number;
  sourceVideoId: number;
  startMs: number;
  endMs: number;
  hookMs: number;
  width: number;
  height: number;
  subtitleConfig: SuggestedSubtitleConfig | null;
  intro: ShortTextConfig;
  outro: ShortTextConfig;
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

export async function findDraft(userId: number, draftId: number): Promise<DraftForEdit | null> {
  const [rows] = await pool.execute<DraftRow[]>(
    `SELECT * FROM shorts_drafts WHERE id = ? AND user_id = ? LIMIT 1`,
    [draftId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    hookMs: Number(row.hook_ms),
    width: Number(row.width),
    height: Number(row.height),
    subtitleConfig: parseJson<SuggestedSubtitleConfig | null>(row.subtitle_config_json, null),
    intro: parseJson<ShortTextConfig>(row.intro_json, { text: '', seconds: 0 }),
    outro: parseJson<ShortTextConfig>(row.outro_json, { text: '', seconds: 0 }),
  };
}

export interface SegmentForEdit {
  startMs: number;
  endMs: number;
  text: string;
}

export async function findTranscriptSegments(userId: number, sourceVideoId: number): Promise<SegmentForEdit[]> {
  const [rows] = await pool.execute<Array<RowDataPacket & { start_ms: number; end_ms: number; text: string }>>(
    `SELECT seg.start_ms, seg.end_ms, seg.text
       FROM transcript_segments seg
       JOIN transcripts t ON t.id = seg.transcript_id
      WHERE t.user_id = ? AND t.source_video_id = ?
      ORDER BY seg.start_ms ASC, seg.id ASC LIMIT 1000`,
    [userId, sourceVideoId],
  );
  return rows.map((row) => ({ startMs: Number(row.start_ms), endMs: Number(row.end_ms), text: row.text ?? '' }));
}

interface EditRow extends RowDataPacket {
  id: number;
  user_id: number;
  draft_id: number;
  project_id: number;
  source_video_id: number;
  timeline_json: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function toEdit(row: EditRow): ClipEdit {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    draftId: Number(row.draft_id),
    projectId: Number(row.project_id),
    sourceVideoId: Number(row.source_video_id),
    timeline: parseJson<EditorTimeline>(row.timeline_json, { tracks: [], subtitles: [], texts: [], settings: { width: 1080, height: 1920, snapMs: 100, timelineZoom: 1 } }),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function findEditByDraft(userId: number, draftId: number): Promise<ClipEdit | null> {
  const [rows] = await pool.execute<EditRow[]>(
    `SELECT * FROM clip_edits WHERE draft_id = ? AND user_id = ? LIMIT 1`,
    [draftId, userId],
  );
  return rows[0] ? toEdit(rows[0]) : null;
}

export async function findEditById(userId: number, id: number): Promise<ClipEdit | null> {
  const [rows] = await pool.execute<EditRow[]>(
    `SELECT * FROM clip_edits WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? toEdit(rows[0]) : null;
}

export async function insertEdit(input: {
  userId: number;
  draft: DraftForEdit;
  timeline: EditorTimeline;
}): Promise<ClipEdit> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO clip_edits (user_id, draft_id, project_id, source_video_id, timeline_json, version)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [input.userId, input.draft.id, input.draft.projectId, input.draft.sourceVideoId, JSON.stringify(input.timeline)],
  );
  return (await findEditById(input.userId, result.insertId))!;
}

export async function updateTimeline(userId: number, id: number, timeline: EditorTimeline): Promise<ClipEdit | null> {
  await pool.execute(`UPDATE clip_edits SET timeline_json = ? WHERE id = ? AND user_id = ?`, [JSON.stringify(timeline), id, userId]);
  return findEditById(userId, id);
}

interface VersionRow extends RowDataPacket {
  id: number;
  edit_id: number;
  version: number;
  label: string;
  timeline_json: string;
  created_at: Date;
}

function toVersion(row: VersionRow): EditVersion {
  return {
    id: Number(row.id),
    editId: Number(row.edit_id),
    version: Number(row.version),
    label: row.label,
    timeline: parseJson<EditorTimeline>(row.timeline_json, { tracks: [], subtitles: [], texts: [], settings: { width: 1080, height: 1920, snapMs: 100, timelineZoom: 1 } }),
    createdAt: iso(row.created_at),
  };
}

export async function listVersions(editId: number): Promise<EditVersion[]> {
  const [rows] = await pool.execute<VersionRow[]>(
    `SELECT * FROM edit_versions WHERE edit_id = ? ORDER BY version DESC`,
    [editId],
  );
  return rows.map(toVersion);
}

export async function insertVersion(input: { editId: number; version: number; label: string; timeline: EditorTimeline }): Promise<EditVersion> {
  await pool.execute<ResultSetHeader>(
    `INSERT INTO edit_versions (edit_id, version, label, timeline_json) VALUES (?, ?, ?, ?)`,
    [input.editId, input.version, input.label, JSON.stringify(input.timeline)],
  );
  await pool.execute(`UPDATE clip_edits SET version = ? WHERE id = ?`, [input.version, input.editId]);
  const [rows] = await pool.execute<VersionRow[]>(
    `SELECT * FROM edit_versions WHERE edit_id = ? AND version = ? LIMIT 1`,
    [input.editId, input.version],
  );
  return toVersion(rows[0]);
}

interface AssetRow extends RowDataPacket {
  id: number;
  user_id: number;
  edit_id: number;
  kind: EditorAsset['kind'];
  label: string;
  storage_key: string | null;
  rights_id: number | null;
  config_json: string;
  created_at: Date;
}

function toAsset(row: AssetRow): EditorAsset {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    editId: Number(row.edit_id),
    kind: row.kind,
    label: row.label,
    storageKey: row.storage_key ?? null,
    rightsId: row.rights_id == null ? null : Number(row.rights_id),
    config: parseJson<Record<string, unknown>>(row.config_json, {}),
    createdAt: iso(row.created_at),
  };
}

export async function listAssets(editId: number): Promise<EditorAsset[]> {
  const [rows] = await pool.execute<AssetRow[]>(`SELECT * FROM editor_assets WHERE edit_id = ? ORDER BY id DESC`, [editId]);
  return rows.map(toAsset);
}

export async function insertAsset(input: {
  userId: number;
  editId: number;
  kind: EditorAsset['kind'];
  label: string;
  storageKey: string | null;
  rightsId: number | null;
  config: Record<string, unknown>;
}): Promise<EditorAsset> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO editor_assets (user_id, edit_id, kind, label, storage_key, rights_id, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, input.editId, input.kind, input.label, input.storageKey, input.rightsId, JSON.stringify(input.config)],
  );
  const [rows] = await pool.execute<AssetRow[]>(`SELECT * FROM editor_assets WHERE id = ? LIMIT 1`, [result.insertId]);
  return toAsset(rows[0]);
}

export async function removeAsset(userId: number, editId: number, assetId: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM editor_assets WHERE id = ? AND edit_id = ? AND user_id = ?`,
    [assetId, editId, userId],
  );
  return result.affectedRows > 0;
}

/** Only declared, verified, unexpired rights may back an imported media asset. */
export async function findVerifiedRights(userId: number, rightsId: number): Promise<{ id: number; storageKey: string | null } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; storage_key: string | null; status: string; ownership_type: string; user_confirmed: number; derivative_work: number; youtube_publication: number }>>(
    `SELECT r.id, m.storage_key, r.status, r.ownership_type, r.user_confirmed, r.derivative_work, r.youtube_publication
       FROM content_rights r
       LEFT JOIN media_assets m ON m.source_video_id = r.source_video_id AND m.kind IN ('original','authorized_source')
      WHERE r.id = ? AND r.user_id = ? LIMIT 1`,
    [rightsId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const ok = row.status !== 'rejected' && row.status !== 'expired'
    && row.ownership_type !== 'unknown'
    && !!row.user_confirmed && !!row.derivative_work && !!row.youtube_publication;
  return ok ? { id: Number(row.id), storageKey: row.storage_key ?? null } : null;
}

export async function findDraftForUser(userId: number, draftId: number): Promise<ShortDraft | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; user_id: number }>>(
    `SELECT id, user_id FROM shorts_drafts WHERE id = ? AND user_id = ? LIMIT 1`,
    [draftId, userId],
  );
  const row = rows[0];
  return row ? ({ id: Number(row.id), userId: Number(row.user_id) } as ShortDraft) : null;
}
