import type { ContentRights, PublishingRightsCheck } from './index.js';

/** Pure publishing-rights gate, shared by the API and the upload worker. */
export function evaluatePublishingRights(
  rights: ContentRights[],
  input: { sourceVideoId?: number; context: 'publish' | 'render' | 'upload_youtube' | 'manual' },
): PublishingRightsCheck {
  const reasons: string[] = [];
  const checks: Array<{ code: string; ok: boolean; message: string }> = [];

  if (rights.length === 0) {
    reasons.push('No rights declaration found. Declare source ownership and required permissions before publishing.');
  }

  const relevant = input.sourceVideoId ? rights.filter((r) => r.sourceVideoId === input.sourceVideoId || r.sourceVideoId == null) : rights;
  const sourceDecls = relevant.filter((r) => r.subjectType === 'source_video');
  if (input.sourceVideoId && sourceDecls.length === 0) {
    reasons.push('Source rights are not declared for this video.');
  }

  const requirePerms = input.context === 'publish' || input.context === 'upload_youtube' || input.context === 'render';
  for (const r of relevant) {
    reasons.push(...rightsEffectiveProblems(r, requirePerms));
  }

  const music = relevant.filter((r) => r.subjectType === 'music' || r.subjectType === 'audio_asset');
  for (const m of music) {
    if (!m.musicRightsConfirmed && m.ownershipType !== 'original') {
      reasons.push(`${label(m)}: music/audio rights not confirmed.`);
    }
  }

  const declaredOk = relevant.length > 0;
  checks.push({ code: 'rights_declared', ok: declaredOk, message: declaredOk ? 'Rights declarations present.' : 'Rights declaration is missing.' });
  checks.push({ code: 'no_unknown_or_rejected', ok: !reasons.some((r) => r.includes('unknown') || r.includes('rejected')), message: 'Unknown or rejected rights block publishing.' });
  checks.push({ code: 'licenses_valid', ok: !reasons.some((r) => r.includes('license')), message: 'Required licenses must be present and unexpired.' });
  checks.push({ code: 'user_confirmed', ok: !reasons.some((r) => r.includes('not confirmed by user')), message: 'User must confirm the rights declaration.' });
  checks.push({ code: 'permissions', ok: !reasons.some((r) => r.includes('permission')), message: 'Commercial, derivative, and YouTube permissions must be granted as required.' });

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    allowed: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    checks,
  };
}

function rightsEffectiveProblems(r: ContentRights, requirePermissions: boolean): string[] {
  const problems: string[] = [];
  if (r.status === 'rejected') problems.push(`${label(r)}: rights declaration rejected.`);
  if (r.status === 'expired') problems.push(`${label(r)}: rights declaration expired.`);
  if (r.ownershipType === 'unknown') problems.push(`${label(r)}: ownership is unknown and not authorized for publishing.`);
  if (!r.userConfirmed) problems.push(`${label(r)}: rights declaration not confirmed by user.`);
  if (requirePermissions) {
    if (!r.derivativeWork) problems.push(`${label(r)}: derivative-work permission not granted.`);
    if (!r.youtubePublication) problems.push(`${label(r)}: YouTube publication permission not granted.`);
    if (!r.commercialUse) problems.push(`${label(r)}: commercial-use permission not granted.`);
  }
  for (const lic of r.licenses) {
    if (isExpiredDate(lic.expiresAt)) problems.push(`${label(r)}: license "${lic.licenseType}" is expired.`);
  }
  if (r.ownershipType === 'licensed' && r.licenses.length === 0) {
    problems.push(`${label(r)}: licensed content requires license information.`);
  }
  return problems;
}

function isExpiredDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return dateStr < new Date().toISOString().slice(0, 10);
}

function label(r: ContentRights): string {
  return `${r.subjectType === 'source_video' ? 'Source' : 'Asset'} "${r.subjectLabel}"`;
}
