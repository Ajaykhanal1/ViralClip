import { type EditorTimeline, type EditorTrack, type SubtitleStyle } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import * as render from '../render/render.service.js';
import * as repo from './editor.repository.js';
import { validateTimeline } from './editor.timeline.js';

type Timeline = EditorTimeline;

function assertEdit<T extends { userId: number } | null>(edit: T, userId: number): NonNullable<T> {
  if (!edit || edit.userId !== userId) throw new AppError(404, 'EDIT_NOT_FOUND', 'Editor project not found');
  return edit;
}

function defaultTimeline(draft: repo.DraftForEdit, segments: repo.SegmentForEdit[]): Timeline {
  const duration = draft.endMs - draft.startMs;
  const label = 'Source clip';
  const baseClip = {
    id: 'clip-source', assetId: null, label,
    sourceStartMs: draft.startMs, sourceEndMs: draft.endMs,
    startMs: 0, durationMs: duration,
    cropX: 0, cropY: 0, zoom: 1, rotation: 0, speed: 1,
    volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, transitionMs: 0,
  };
  const tracks: EditorTrack[] = [
    { id: 'track-video', kind: 'video', name: 'Video', visible: true, locked: false, clips: [{ ...baseClip, trackId: 'track-video' }] },
    { id: 'track-audio', kind: 'audio', name: 'Source audio', visible: true, locked: false, clips: [{ ...baseClip, trackId: 'track-audio' }] },
    { id: 'track-subtitles', kind: 'subtitle', name: 'Subtitles', visible: true, locked: false, clips: [] },
    { id: 'track-text', kind: 'text', name: 'Text', visible: true, locked: false, clips: [] },
  ];
  const style: SubtitleStyle = draft.subtitleConfig
    ? {
        fontFamily: 'Arial',
        fontSize: draft.subtitleConfig.fontSize,
        textColor: draft.subtitleConfig.textColor,
        background: draft.subtitleConfig.backgroundColor,
        outline: draft.subtitleConfig.outlineColor,
        position: draft.subtitleConfig.position,
        alignment: 'center',
        highlightedWords: draft.subtitleConfig.highlightKeywords.length > 0,
        activeWordAnimation: 'pop',
      }
    : { fontFamily: 'Arial', fontSize: 48, textColor: '#FFFFFF', position: 'bottom', alignment: 'center' };

  const subtitles = segments
    .map((segment) => ({
      id: `cue-${segment.startMs}-${segment.endMs}`,
      startMs: Math.max(0, Math.min(duration, segment.startMs - draft.startMs)),
      endMs: Math.max(1, Math.min(duration, segment.endMs - draft.startMs)),
      text: segment.text,
      style,
    }))
    .filter((cue) => cue.endMs > cue.startMs);

  const texts = [
    { text: draft.intro.text, startMs: 0, endMs: Math.round(draft.intro.seconds * 1000), id: 'text-intro' },
    { text: draft.outro.text, startMs: Math.max(0, duration - Math.round(draft.outro.seconds * 1000)), endMs: duration, id: 'text-outro' },
  ]
    .filter((item) => item.text && item.endMs > item.startMs)
    .map((item) => ({ ...item, x: 0.5, y: 0.5, fontSize: 56, color: '#FFFFFF', animation: 'fade' as const }));

  return {
    tracks,
    subtitles,
    texts,
    settings: { width: draft.width, height: draft.height, snapMs: 100, timelineZoom: 1 },
  };
}

export async function load(userId: number, draftId: number) {
  const draft = await repo.findDraft(userId, draftId);
  if (!draft) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Shorts draft not found');
  let edit = await repo.findEditByDraft(userId, draftId);
  if (!edit) {
    const segments = await repo.findTranscriptSegments(userId, draft.sourceVideoId);
    edit = await repo.insertEdit({ userId, draft, timeline: defaultTimeline(draft, segments) });
  }
  const [versions, assets] = await Promise.all([repo.listVersions(edit.id), repo.listAssets(edit.id)]);
  return { edit, versions, assets, draft };
}

export async function save(userId: number, editId: number, timeline: Timeline) {
  const edit = assertEdit(await repo.findEditById(userId, editId), userId);
  const draft = await repo.findDraft(userId, edit.draftId);
  if (!draft) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Shorts draft not found');
  validateTimeline(timeline, draft.endMs - draft.startMs);
  const updated = await repo.updateTimeline(userId, editId, timeline);
  return { edit: updated };
}

export async function createVersion(userId: number, editId: number, label: string) {
  const edit = assertEdit(await repo.findEditById(userId, editId), userId);
  const existing = await repo.listVersions(editId);
  const version = Math.max(edit.version, ...existing.map((item) => item.version)) + 1;
  const saved = await repo.insertVersion({ editId, version, label, timeline: edit.timeline });
  return { version: saved, edit: await repo.findEditById(userId, editId) };
}

export async function listVersions(userId: number, editId: number) {
  assertEdit(await repo.findEditById(userId, editId), userId);
  return { versions: await repo.listVersions(editId) };
}

export async function restoreVersion(userId: number, editId: number, versionId: number) {
  assertEdit(await repo.findEditById(userId, editId), userId);
  const version = (await repo.listVersions(editId)).find((item) => item.id === versionId);
  if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Edit version not found');
  const updated = await repo.updateTimeline(userId, editId, version.timeline);
  return { edit: updated };
}

export async function addAsset(userId: number, editId: number, input: {
  kind: 'video' | 'audio' | 'text' | 'image';
  label: string;
  storageKey?: string | null;
  rightsId?: number | null;
  config: Record<string, unknown>;
}) {
  assertEdit(await repo.findEditById(userId, editId), userId);
  let storageKey: string | null = null;
  let rightsId: number | null = null;
  if (input.kind === 'audio' || input.kind === 'video' || input.kind === 'image') {
    if (!input.rightsId) throw new AppError(400, 'RIGHTS_REQUIRED', 'Media assets require a rights declaration');
    const rights = await repo.findVerifiedRights(userId, input.rightsId);
    if (!rights) throw new AppError(403, 'RIGHTS_REQUIRED', 'Asset rights are missing, rejected, expired, or not confirmed');
    rightsId = rights.id;
    storageKey = rights.storageKey;
    if (!storageKey) throw new AppError(400, 'ASSET_MEDIA_MISSING', 'No authorized media is attached to this rights declaration');
  }
  const asset = await repo.insertAsset({
    userId,
    editId,
    kind: input.kind,
    label: input.label,
    storageKey,
    rightsId,
    config: input.config,
  });
  return { asset };
}

export async function removeAsset(userId: number, editId: number, assetId: number) {
  assertEdit(await repo.findEditById(userId, editId), userId);
  if (!(await repo.removeAsset(userId, editId, assetId))) throw new AppError(404, 'ASSET_NOT_FOUND', 'Editor asset not found');
  return { removed: true };
}

export async function requestExport(userId: number, editId: number) {
  // Tracked render path also validates the saved timeline before enqueueing.
  const { processingJob } = await render.start(userId, editId);
  return { job: processingJob };
}
