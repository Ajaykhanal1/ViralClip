import { evaluatePublishingRights, type PublishingRightsCheck } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { newStorageKey, removeKey, resolveStoragePath, ensureParent } from '../../storage/local.js';
import * as notifications from '../notifications/notifications.service.js';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import * as repo from './rights.repository.js';
import type { z } from 'zod';
import type { createClaimSchema, createRightsSchema, licenseSchema, updateClaimSchema, updateRightsSchema } from './rights.schemas.js';

type CreateRights = z.infer<typeof createRightsSchema>;
type UpdateRights = z.infer<typeof updateRightsSchema>;
type LicenseInput = z.infer<typeof licenseSchema>;

async function assertProject(userId: number, projectId: number) {
  const owner = await repo.findProjectOwner(projectId);
  if (owner !== userId) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${projectId} does not exist`);
}
async function assertSource(userId: number, sourceVideoId: number, projectId?: number) {
  const info = await repo.findSourceOwnerProject(sourceVideoId);
  if (!info || info.userId !== userId) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
  if (projectId && info.projectId !== projectId) throw new AppError(400, 'SOURCE_PROJECT_MISMATCH', 'Source does not belong to project');
  return info;
}

export { evaluatePublishingRights } from '@viralclip/shared';

export async function createRightsDeclaration(userId: number, input: CreateRights) {
  await assertProject(userId, input.projectId);
  if (input.sourceVideoId) await assertSource(userId, input.sourceVideoId, input.projectId);
  const id = await repo.createRights({
    userId,
    projectId: input.projectId,
    sourceVideoId: input.sourceVideoId ?? null,
    subjectType: input.subjectType,
    subjectLabel: input.subjectLabel,
    ownershipType: input.ownershipType,
    status: input.status,
    commercialUse: input.commercialUse,
    derivativeWork: input.derivativeWork,
    youtubePublication: input.youtubePublication,
    musicRightsConfirmed: input.musicRightsConfirmed,
    userConfirmed: input.userConfirmed,
    permissionDetails: input.permissionDetails ?? null,
    notes: input.notes ?? null,
    actorId: userId,
  });
  if (input.license) {
    await repo.insertLicense({
      contentRightsId: id,
      licenseType: input.license.licenseType,
      licensor: input.license.licensor ?? null,
      licenseReference: input.license.licenseReference ?? null,
      permissionDetails: input.license.permissionDetails ?? null,
      startsAt: input.license.startsAt ?? null,
      expiresAt: input.license.expiresAt ?? null,
      createdBy: userId,
    });
  }
  await repo.insertEvent({
    userId, projectId: input.projectId, sourceVideoId: input.sourceVideoId ?? null, contentRightsId: id,
    eventType: 'rights_created', actorId: userId,
    details: { ownershipType: input.ownershipType, subjectType: input.subjectType, status: input.status },
  });
  const rights = await repo.findRightsById(userId, id);
  if (!rights) throw new Error('Failed to read rights');
  return rights;
}

export async function updateRightsDeclaration(userId: number, id: number, input: UpdateRights) {
  const current = await repo.findRightsById(userId, id);
  if (!current) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  const ok = await repo.updateRights(userId, id, userId, input);
  if (!ok) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  await repo.insertEvent({
    userId, projectId: current.projectId, sourceVideoId: current.sourceVideoId, contentRightsId: id,
    eventType: 'rights_updated', actorId: userId, details: input as Record<string, unknown>,
  });
  const rights = await repo.findRightsById(userId, id);
  if (!rights) throw new Error('Failed to read rights');
  return rights;
}

export async function addLicense(userId: number, rightsId: number, input: LicenseInput) {
  const rights = await repo.findRightsById(userId, rightsId);
  if (!rights) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  await repo.insertLicense({
    contentRightsId: rightsId,
    licenseType: input.licenseType,
    licensor: input.licensor ?? null,
    licenseReference: input.licenseReference ?? null,
    permissionDetails: input.permissionDetails ?? null,
    startsAt: input.startsAt ?? null,
    expiresAt: input.expiresAt ?? null,
    createdBy: userId,
  });
  await repo.insertEvent({
    userId, projectId: rights.projectId, sourceVideoId: rights.sourceVideoId, contentRightsId: rightsId,
    eventType: 'license_added', actorId: userId, details: { licenseType: input.licenseType, expiresAt: input.expiresAt ?? null },
  });
  return repo.findRightsById(userId, rightsId);
}

export async function editLicense(userId: number, rightsId: number, licenseId: number, input: LicenseInput) {
  const rights = await repo.findRightsById(userId, rightsId);
  if (!rights) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  const ok = await repo.updateLicense(licenseId, rightsId, input);
  if (!ok) throw new AppError(404, 'LICENSE_NOT_FOUND', 'License not found');
  await repo.insertEvent({
    userId, projectId: rights.projectId, sourceVideoId: rights.sourceVideoId, contentRightsId: rightsId,
    eventType: 'license_updated', actorId: userId, details: { licenseId, licenseType: input.licenseType },
  });
  return repo.findRightsById(userId, rightsId);
}

const allowedDocMimes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
export async function uploadRightsDocument(opts: { userId: number; rightsId: number; filename: string; mimeType: string | null; body: Readable }) {
  const rights = await repo.findRightsById(opts.userId, opts.rightsId);
  if (!rights) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  const mime = (opts.mimeType || '').split(';')[0].trim().toLowerCase() || null;
  if (!mime || !allowedDocMimes.has(mime)) {
    throw new AppError(400, 'UNSUPPORTED_DOCUMENT_TYPE', 'Allowed document types: PDF, PNG, JPG, WEBP.');
  }
  const safeName = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'document';
  const key = newStorageKey('rights-docs', safeName);
  const dest = resolveStoragePath(key);
  await ensureParent(dest);
  let bytes = 0;
  const max = 15 * 1024 * 1024;
  opts.body.on('data', (c: Buffer) => {
    bytes += c.length;
    if (bytes > max) opts.body.destroy(new AppError(413, 'FILE_TOO_LARGE', 'Document exceeds 15 MB limit.'));
  });
  try {
    await pipeline(opts.body, createWriteStream(dest, { flags: 'w' }));
  } catch (e) {
    await removeKey(key).catch(() => {});
    throw e;
  }
  const doc = await repo.insertDocument({
    contentRightsId: opts.rightsId, userId: opts.userId, storageKey: key, originalFilename: safeName, mimeType: mime, sizeBytes: bytes, createdBy: opts.userId,
  });
  await repo.insertEvent({
    userId: opts.userId, projectId: rights.projectId, sourceVideoId: rights.sourceVideoId, contentRightsId: opts.rightsId,
    eventType: 'document_uploaded', actorId: opts.userId, details: { documentId: doc.id, filename: safeName },
  });
  return doc;
}

export async function removeRightsDocument(userId: number, rightsId: number, docId: number) {
  const rights = await repo.findRightsById(userId, rightsId);
  if (!rights) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  const key = await repo.deleteDocument(userId, rightsId, docId);
  if (!key) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
  await removeKey(key).catch(() => {});
  await repo.insertEvent({
    userId, projectId: rights.projectId, sourceVideoId: rights.sourceVideoId, contentRightsId: rightsId,
    eventType: 'document_removed', actorId: userId, details: { documentId: docId },
  });
}

export async function listRights(userId: number, filters: { projectId?: number; sourceVideoId?: number }) {
  if (filters.projectId) await assertProject(userId, filters.projectId);
  return repo.listRights(userId, filters);
}

export async function getRights(userId: number, id: number) {
  const rights = await repo.findRightsById(userId, id);
  if (!rights) throw new AppError(404, 'RIGHTS_NOT_FOUND', 'Rights declaration not found');
  return rights;
}

export async function runPublishingCheck(
  userId: number,
  input: { projectId: number; sourceVideoId?: number; context: 'publish' | 'render' | 'upload_youtube' | 'manual' },
): Promise<PublishingRightsCheck> {
  await assertProject(userId, input.projectId);
  if (input.sourceVideoId) await assertSource(userId, input.sourceVideoId, input.projectId);
  const rights = await repo.listRightsForCheck(userId, input.projectId, input.sourceVideoId);
  const result = evaluatePublishingRights(rights, { sourceVideoId: input.sourceVideoId, context: input.context });
  await repo.insertCheck({ userId, projectId: input.projectId, sourceVideoId: input.sourceVideoId ?? null, context: input.context, result: result.allowed ? 'pass' : 'blocked', reasons: result.reasons, checkedBy: userId });
  await repo.insertEvent({ userId, projectId: input.projectId, sourceVideoId: input.sourceVideoId ?? null, eventType: 'rights_check', actorId: userId, details: { context: input.context, allowed: result.allowed, reasons: result.reasons } });
  if (!result.allowed) {
    await notifications.notify(userId, {
      type: 'copyright_review_required',
      title: 'Copyright review required',
      message: `Publishing was blocked for project ${input.projectId}: ${result.reasons.join(' ')}`,
      severity: 'warning',
      data: { projectId: input.projectId, sourceVideoId: input.sourceVideoId ?? null, reasons: result.reasons },
    }).catch(() => {});
  }
  return result;
}

export async function assertPublishingAllowed(userId: number, projectId: number, sourceVideoId: number | undefined, context: 'publish' | 'render' | 'upload_youtube') {
  const result = await runPublishingCheck(userId, { projectId, sourceVideoId, context });
  if (!result.allowed) {
    throw new AppError(403, 'RIGHTS_REQUIRED', 'Publishing blocked: required rights are missing, rejected, expired, or unconfirmed.', { reasons: result.reasons, checks: result.checks });
  }
  return result;
}

export async function history(userId: number, filters: { projectId?: number; sourceVideoId?: number }) {
  if (filters.projectId) await assertProject(userId, filters.projectId);
  const [events, checks] = await Promise.all([
    repo.listEvents(userId, filters),
    filters.projectId ? repo.listChecks(userId, filters.projectId) : Promise.resolve([]),
  ]);
  return { events, checks };
}

export async function createClaim(userId: number, input: z.infer<typeof createClaimSchema>) {
  await assertProject(userId, input.projectId);
  if (input.sourceVideoId) await assertSource(userId, input.sourceVideoId, input.projectId);
  const id = await repo.createClaim({
    userId, projectId: input.projectId, sourceVideoId: input.sourceVideoId ?? null, claimant: input.claimant,
    claimReference: input.claimReference ?? null, status: input.status, description: input.description ?? null, createdBy: userId,
  });
  await repo.insertEvent({ userId, projectId: input.projectId, sourceVideoId: input.sourceVideoId ?? null, eventType: 'claim_created', actorId: userId, details: { claimId: id } });
  return (await repo.listClaims(userId, input.projectId)).find((c) => c.id === id)!;
}
export async function updateClaim(userId: number, id: number, input: z.infer<typeof updateClaimSchema>) {
  const ok = await repo.updateClaim(userId, id, input);
  if (!ok) throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found');
  const claims = await repo.listClaims(userId);
  const claim = claims.find((c) => c.id === id)!;
  await repo.insertEvent({ userId, projectId: claim.projectId, sourceVideoId: claim.sourceVideoId, eventType: 'claim_updated', actorId: userId, details: { claimId: id, status: input.status } });
  return claim;
}
export async function listClaims(userId: number, projectId?: number) {
  if (projectId) await assertProject(userId, projectId);
  return repo.listClaims(userId, projectId);
}
