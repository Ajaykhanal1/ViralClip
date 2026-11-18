import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  ContentLicense,
  ContentRights,
  CopyrightCheck,
  CopyrightCheckContext,
  CopyrightCheckResult,
  CopyrightClaim,
  CopyrightEvent,
  RightsDocument,
  RightsOwnershipType,
  RightsStatus,
  RightsSubjectType,
} from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface RightsRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_video_id: number | null;
  subject_type: RightsSubjectType;
  subject_label: string;
  ownership_type: RightsOwnershipType;
  status: RightsStatus;
  commercial_use: number;
  derivative_work: number;
  youtube_publication: number;
  music_rights_confirmed: number;
  user_confirmed: number;
  confirmed_at: Date | null;
  permission_details: string | null;
  notes: string | null;
  created_by: number;
  updated_by: number;
  created_at: Date;
  updated_at: Date;
}
interface LicenseRow extends RowDataPacket {
  id: number;
  content_rights_id: number;
  license_type: string;
  licensor: string | null;
  license_reference: string | null;
  permission_details: string | null;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date;
}
interface DocRow extends RowDataPacket {
  id: number;
  content_rights_id: number;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_key: string;
  created_at: Date;
}
interface CheckRow extends RowDataPacket {
  id: number;
  project_id: number;
  source_video_id: number | null;
  context: CopyrightCheckContext;
  result: CopyrightCheckResult;
  reasons_json: string | null;
  checked_by: number;
  created_at: Date;
}
interface ClaimRow extends RowDataPacket {
  id: number;
  project_id: number;
  source_video_id: number | null;
  claimant: string;
  claim_reference: string | null;
  status: CopyrightClaim['status'];
  description: string | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}
interface EventRow extends RowDataPacket {
  id: number;
  project_id: number;
  source_video_id: number | null;
  content_rights_id: number | null;
  event_type: string;
  actor_id: number;
  details_json: string | null;
  created_at: Date;
}

function dateStr(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}
function toLicense(r: LicenseRow): ContentLicense {
  return {
    id: r.id,
    contentRightsId: r.content_rights_id,
    licenseType: r.license_type,
    licensor: r.licensor,
    licenseReference: r.license_reference,
    permissionDetails: r.permission_details,
    startsAt: dateStr(r.starts_at),
    expiresAt: dateStr(r.expires_at),
    createdAt: r.created_at.toISOString(),
  };
}
function toDoc(r: DocRow): RightsDocument {
  return {
    id: r.id,
    contentRightsId: r.content_rights_id,
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    createdAt: r.created_at.toISOString(),
  };
}
function toRights(r: RightsRow, licenses: ContentLicense[], documents: RightsDocument[]): ContentRights {
  return {
    id: r.id,
    projectId: r.project_id,
    sourceVideoId: r.source_video_id,
    subjectType: r.subject_type,
    subjectLabel: r.subject_label,
    ownershipType: r.ownership_type,
    status: r.status,
    commercialUse: !!r.commercial_use,
    derivativeWork: !!r.derivative_work,
    youtubePublication: !!r.youtube_publication,
    musicRightsConfirmed: !!r.music_rights_confirmed,
    userConfirmed: !!r.user_confirmed,
    confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null,
    permissionDetails: r.permission_details,
    notes: r.notes,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    licenses,
    documents,
  };
}

export async function findProjectOwner(projectId: number): Promise<number | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number }>>(
    `SELECT user_id FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}
export async function findSourceOwnerProject(sourceVideoId: number): Promise<{ userId: number; projectId: number } | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { user_id: number; project_id: number }>>(
    `SELECT user_id, project_id FROM source_videos WHERE id = ? LIMIT 1`,
    [sourceVideoId],
  );
  return rows[0] ? { userId: Number(rows[0].user_id), projectId: Number(rows[0].project_id) } : null;
}

export async function insertEvent(input: {
  userId: number; projectId: number; sourceVideoId?: number | null; contentRightsId?: number | null;
  eventType: string; actorId: number; details?: Record<string, unknown> | null;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO copyright_events (user_id, project_id, source_video_id, content_rights_id, event_type, actor_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.projectId, input.sourceVideoId ?? null, input.contentRightsId ?? null,
      input.eventType, input.actorId, input.details ? JSON.stringify(input.details) : null,
    ],
  );
}

export async function createRights(input: {
  userId: number; projectId: number; sourceVideoId: number | null; subjectType: RightsSubjectType;
  subjectLabel: string; ownershipType: RightsOwnershipType; status: RightsStatus;
  commercialUse: boolean; derivativeWork: boolean; youtubePublication: boolean; musicRightsConfirmed: boolean;
  userConfirmed: boolean; permissionDetails: string | null; notes: string | null; actorId: number;
}): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO content_rights
      (user_id, project_id, source_video_id, subject_type, subject_label, ownership_type, status,
       commercial_use, derivative_work, youtube_publication, music_rights_confirmed, user_confirmed,
       confirmed_at, permission_details, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.projectId, input.sourceVideoId, input.subjectType, input.subjectLabel,
      input.ownershipType, input.status, input.commercialUse ? 1 : 0, input.derivativeWork ? 1 : 0,
      input.youtubePublication ? 1 : 0, input.musicRightsConfirmed ? 1 : 0, input.userConfirmed ? 1 : 0,
      input.userConfirmed ? new Date() : null, input.permissionDetails, input.notes, input.actorId, input.actorId,
    ],
  );
  return result.insertId;
}

export async function updateRights(
  userId: number, id: number, actorId: number,
  patch: Partial<{ subjectLabel: string; ownershipType: RightsOwnershipType; status: RightsStatus;
    commercialUse: boolean; derivativeWork: boolean; youtubePublication: boolean; musicRightsConfirmed: boolean;
    userConfirmed: boolean; permissionDetails: string | null; notes: string | null }>,
): Promise<boolean> {
  const sets: string[] = ['updated_by = ?'];
  const params: Array<string | number | null> = [actorId];
  if (patch.subjectLabel !== undefined) { sets.push('subject_label = ?'); params.push(patch.subjectLabel); }
  if (patch.ownershipType !== undefined) { sets.push('ownership_type = ?'); params.push(patch.ownershipType); }
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.commercialUse !== undefined) { sets.push('commercial_use = ?'); params.push(patch.commercialUse ? 1 : 0); }
  if (patch.derivativeWork !== undefined) { sets.push('derivative_work = ?'); params.push(patch.derivativeWork ? 1 : 0); }
  if (patch.youtubePublication !== undefined) { sets.push('youtube_publication = ?'); params.push(patch.youtubePublication ? 1 : 0); }
  if (patch.musicRightsConfirmed !== undefined) { sets.push('music_rights_confirmed = ?'); params.push(patch.musicRightsConfirmed ? 1 : 0); }
  if (patch.permissionDetails !== undefined) { sets.push('permission_details = ?'); params.push(patch.permissionDetails); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); params.push(patch.notes); }
  if (patch.userConfirmed !== undefined) {
    sets.push('user_confirmed = ?'); params.push(patch.userConfirmed ? 1 : 0);
    sets.push(`confirmed_at = ${patch.userConfirmed ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
  }
  params.push(id, userId);
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE content_rights SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  );
  return res.affectedRows > 0;
}

export async function findRightsById(userId: number, id: number): Promise<ContentRights | null> {
  const [rows] = await pool.execute<RightsRow[]>(`SELECT * FROM content_rights WHERE id = ? AND user_id = ? LIMIT 1`, [id, userId]);
  if (!rows[0]) return null;
  return hydrateRights([rows[0]]).then((r) => r[0] ?? null);
}

async function hydrateRights(rows: RightsRow[]): Promise<ContentRights[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [licRows] = await pool.query<LicenseRow[]>(
    `SELECT id, content_rights_id, license_type, licensor, license_reference, permission_details, starts_at, expires_at, created_at
       FROM content_licenses WHERE content_rights_id IN (?) ORDER BY id ASC`, [ids],
  );
  const [docRows] = await pool.query<DocRow[]>(
    `SELECT id, content_rights_id, original_filename, mime_type, size_bytes, storage_key, created_at
       FROM rights_documents WHERE content_rights_id IN (?) ORDER BY id ASC`, [ids],
  );
  const lmap = new Map<number, ContentLicense[]>();
  for (const l of licRows) { (lmap.get(l.content_rights_id) ?? lmap.set(l.content_rights_id, []).get(l.content_rights_id)!).push(toLicense(l)); }
  const dmap = new Map<number, RightsDocument[]>();
  for (const d of docRows) { (dmap.get(d.content_rights_id) ?? dmap.set(d.content_rights_id, []).get(d.content_rights_id)!).push(toDoc(d)); }
  return rows.map((r) => toRights(r, lmap.get(r.id) ?? [], dmap.get(r.id) ?? []));
}

export async function listRights(userId: number, filters: { projectId?: number; sourceVideoId?: number }): Promise<ContentRights[]> {
  const where = ['user_id = ?'];
  const params: number[] = [userId];
  if (filters.projectId) { where.push('project_id = ?'); params.push(filters.projectId); }
  if (filters.sourceVideoId) { where.push('source_video_id = ?'); params.push(filters.sourceVideoId); }
  const [rows] = await pool.execute<RightsRow[]>(
    `SELECT * FROM content_rights WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC`,
    params,
  );
  return hydrateRights(rows);
}

export async function insertLicense(input: {
  contentRightsId: number; licenseType: string; licensor: string | null; licenseReference: string | null;
  permissionDetails: string | null; startsAt: string | null; expiresAt: string | null; createdBy: number;
}): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO content_licenses (content_rights_id, license_type, licensor, license_reference, permission_details, starts_at, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.contentRightsId, input.licenseType, input.licensor, input.licenseReference, input.permissionDetails, input.startsAt, input.expiresAt, input.createdBy],
  );
  return res.insertId;
}

export async function updateLicense(licenseId: number, contentRightsId: number, patch: {
  licenseType?: string; licensor?: string | null; licenseReference?: string | null; permissionDetails?: string | null; startsAt?: string | null; expiresAt?: string | null;
}): Promise<boolean> {
  const sets: string[] = []; const params: Array<string | number | null> = [];
  if (patch.licenseType !== undefined) { sets.push('license_type = ?'); params.push(patch.licenseType); }
  if (patch.licensor !== undefined) { sets.push('licensor = ?'); params.push(patch.licensor); }
  if (patch.licenseReference !== undefined) { sets.push('license_reference = ?'); params.push(patch.licenseReference); }
  if (patch.permissionDetails !== undefined) { sets.push('permission_details = ?'); params.push(patch.permissionDetails); }
  if (patch.startsAt !== undefined) { sets.push('starts_at = ?'); params.push(patch.startsAt); }
  if (patch.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(patch.expiresAt); }
  if (sets.length === 0) return false;
  params.push(licenseId, contentRightsId);
  const [res] = await pool.execute<ResultSetHeader>(`UPDATE content_licenses SET ${sets.join(', ')} WHERE id = ? AND content_rights_id = ?`, params);
  return res.affectedRows > 0;
}

export async function insertDocument(input: {
  contentRightsId: number; userId: number; storageKey: string; originalFilename: string; mimeType: string | null; sizeBytes: number | null; createdBy: number;
}): Promise<RightsDocument> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO rights_documents (content_rights_id, user_id, storage_key, original_filename, mime_type, size_bytes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.contentRightsId, input.userId, input.storageKey, input.originalFilename, input.mimeType, input.sizeBytes, input.createdBy],
  );
  const [rows] = await pool.execute<DocRow[]>(`SELECT id, content_rights_id, original_filename, mime_type, size_bytes, storage_key, created_at FROM rights_documents WHERE id = ?`, [res.insertId]);
  return toDoc(rows[0]!);
}

export async function findDocument(userId: number, contentRightsId: number, docId: number): Promise<(RightsDocument & { storageKey: string }) | null> {
  const [rows] = await pool.execute<DocRow[]>(`SELECT id, content_rights_id, original_filename, mime_type, size_bytes, storage_key, created_at FROM rights_documents WHERE id = ? AND content_rights_id = ? AND user_id = ? LIMIT 1`, [docId, contentRightsId, userId]);
  if (!rows[0]) return null;
  return { ...toDoc(rows[0]), storageKey: rows[0].storage_key };
}

export async function deleteDocument(userId: number, contentRightsId: number, docId: number): Promise<string | null> {
  const doc = await findDocument(userId, contentRightsId, docId);
  if (!doc) return null;
  await pool.execute(`DELETE FROM rights_documents WHERE id = ?`, [docId]);
  return doc.storageKey;
}

export async function insertCheck(input: {
  userId: number; projectId: number; sourceVideoId: number | null; context: CopyrightCheckContext; result: CopyrightCheckResult; reasons: string[]; checkedBy: number;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO copyright_checks (user_id, project_id, source_video_id, context, result, reasons_json, checked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, input.projectId, input.sourceVideoId, input.context, input.result, JSON.stringify(input.reasons), input.checkedBy],
  );
}

export async function listChecks(userId: number, projectId: number): Promise<CopyrightCheck[]> {
  const [rows] = await pool.execute<CheckRow[]>(
    `SELECT id, project_id, source_video_id, context, result, reasons_json, checked_by, created_at
       FROM copyright_checks WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    [userId, projectId],
  );
  return rows.map((r) => ({
    id: r.id, projectId: r.project_id, sourceVideoId: r.source_video_id, context: r.context, result: r.result,
    reasons: r.reasons_json ? (JSON.parse(r.reasons_json) as string[]) : [], checkedBy: r.checked_by, createdAt: r.created_at.toISOString(),
  }));
}

export async function createClaim(input: {
  userId: number; projectId: number; sourceVideoId: number | null; claimant: string; claimReference: string | null; status: string; description: string | null; createdBy: number;
}): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO copyright_claims (user_id, project_id, source_video_id, claimant, claim_reference, status, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, input.projectId, input.sourceVideoId, input.claimant, input.claimReference, input.status, input.description, input.createdBy],
  );
  return res.insertId;
}
export async function updateClaim(userId: number, id: number, patch: { status?: string; description?: string | null; claimReference?: string | null }): Promise<boolean> {
  const sets: string[] = []; const params: Array<string | null> = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
  if (patch.claimReference !== undefined) { sets.push('claim_reference = ?'); params.push(patch.claimReference); }
  if (!sets.length) return false;
  params.push(String(id), String(userId));
  const [res] = await pool.execute<ResultSetHeader>(`UPDATE copyright_claims SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  return res.affectedRows > 0;
}
export async function listClaims(userId: number, projectId?: number): Promise<CopyrightClaim[]> {
  const where = ['user_id = ?']; const params: number[] = [userId];
  if (projectId) { where.push('project_id = ?'); params.push(projectId); }
  const [rows] = await pool.execute<ClaimRow[]>(`SELECT * FROM copyright_claims WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params);
  return rows.map((r) => ({
    id: r.id, projectId: r.project_id, sourceVideoId: r.source_video_id, claimant: r.claimant, claimReference: r.claim_reference,
    status: r.status, description: r.description, createdBy: r.created_by, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  }));
}

export async function listEvents(userId: number, filters: { projectId?: number; sourceVideoId?: number }): Promise<CopyrightEvent[]> {
  const where = ['user_id = ?']; const params: number[] = [userId];
  if (filters.projectId) { where.push('project_id = ?'); params.push(filters.projectId); }
  if (filters.sourceVideoId) { where.push('source_video_id = ?'); params.push(filters.sourceVideoId); }
  const [rows] = await pool.execute<EventRow[]>(`SELECT * FROM copyright_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 100`, params);
  return rows.map((r) => ({
    id: r.id, projectId: r.project_id, sourceVideoId: r.source_video_id, contentRightsId: r.content_rights_id,
    eventType: r.event_type, actorId: r.actor_id, details: r.details_json ? (JSON.parse(r.details_json) as Record<string, unknown>) : null,
    createdAt: r.created_at.toISOString(),
  }));
}

// For publishing checks: all rights records relevant to project/source owned by user.
export async function listRightsForCheck(userId: number, projectId: number, sourceVideoId?: number): Promise<ContentRights[]> {
  return listRights(userId, { projectId, sourceVideoId });
}
