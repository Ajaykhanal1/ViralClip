import { QUEUE_NAMES, type SuggestedSubtitleConfig } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import * as processingRepo from '../processing/processing.repository.js';
import * as processing from '../processing/processing.service.js';
import { runPublishingCheck } from '../rights/rights.service.js';
import * as repo from './shorts.repository.js';

const DEFAULT_SUBTITLES: SuggestedSubtitleConfig = {
  enabled: true,
  position: 'bottom',
  fontSize: 48,
  textColor: '#FFFFFF',
  backgroundColor: 'rgba(0,0,0,0.6)',
  outlineColor: '#000000',
  maxWordsPerLine: 5,
  highlightKeywords: [],
};

function assertSource(userId: number, source: { id: number; projectId: number; userId: number } | null) {
  if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
  return source;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

type GenerateInput = {
  sourceVideoId: number;
  recommendationIds?: number[];
  framing?: 'smart' | 'center' | 'face' | 'speaker';
  cropX?: number;
  cropY?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  subtitleEnabled?: boolean;
  introText?: string;
  outroText?: string;
  introSeconds?: number;
  outroSeconds?: number;
  volume?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
};

export async function listForSource(userId: number, sourceVideoId: number) {
  assertSource(userId, await repo.findSource(userId, sourceVideoId));
  return repo.listForSource(userId, sourceVideoId);
}

export async function generate(userId: number, input: GenerateInput) {
  const source = assertSource(userId, await repo.findSource(userId, input.sourceVideoId));
  const rights = await runPublishingCheck(userId, {
    projectId: source.projectId,
    sourceVideoId: source.id,
    context: 'render',
  });
  if (!rights.allowed) {
    throw new AppError(403, 'RIGHTS_REQUIRED', `Shorts generation blocked by rights check: ${rights.reasons.join(' ')}`, {
      reasons: rights.reasons,
    });
  }
  const active = await processingRepo.findActiveJobForSource(source.id, QUEUE_NAMES.videoRendering);
  if (active) throw new AppError(409, 'RENDER_IN_PROGRESS', 'A Shorts render job is already active for this source');

  const selected = await repo.listSelectedClips(userId, source.id);
  const ids = input.recommendationIds ?? selected.map((clip) => clip.id);
  const clips = selected.filter((clip) => ids.includes(clip.id));
  if (clips.length !== ids.length) {
    throw new AppError(400, 'CLIPS_NOT_SELECTED', 'All requested clips must be selected AI recommendations');
  }
  if (clips.length === 0) throw new AppError(400, 'NO_SELECTED_CLIPS', 'Select at least one AI clip recommendation first');

  const width = clamp(Math.round(input.width ?? 1080), 360, 2160);
  // YouTube Shorts requires 9:16; derive height so a custom width cannot break the ratio.
  const height = Math.round((width * 16) / 9);
  const durationMs = Math.round(clamp(input.durationSeconds ?? 60, 5, 180) * 1000);
  const audioConfig = {
    volume: clamp(input.volume ?? 1, 0, 4),
    fadeInSeconds: clamp(input.fadeInSeconds ?? 0.5, 0, 10),
    fadeOutSeconds: clamp(input.fadeOutSeconds ?? 0.5, 0, 10),
  };
  const intro = { text: input.introText ?? '', seconds: clamp(input.introSeconds ?? 0, 0, 10) };
  const outro = { text: input.outroText ?? '', seconds: clamp(input.outroSeconds ?? 0, 0, 10) };
  const framing = input.framing ?? 'smart';
  const cropX = clamp(input.cropX ?? 0, -1, 1);
  const cropY = clamp(input.cropY ?? 0, -1, 1);

  const draftIds: number[] = [];
  for (const clip of clips) {
    const subtitleConfig = clip.subtitleConfig
      ? { ...clip.subtitleConfig, enabled: input.subtitleEnabled ?? clip.subtitleConfig.enabled }
      : { ...DEFAULT_SUBTITLES, enabled: input.subtitleEnabled ?? true };
    const endMs = Math.min(clip.endMs, clip.startMs + durationMs);
    const title = clip.title.slice(0, 200);
    const editData = {
      sourceTimestamps: { startMs: clip.startMs, endMs, hookMs: clip.hookMs },
      cropPosition: { framing, cropX, cropY },
      outputDimensions: { width, height },
      subtitleConfig,
      audioConfig,
      version: await repo.nextVersion(clip.id),
    };
    draftIds.push(await repo.insertDraft({
      userId,
      projectId: source.projectId,
      sourceVideoId: source.id,
      recommendationId: clip.id,
      analysisId: clip.analysisId,
      version: editData.version,
      title,
      description: clip.description,
      startMs: clip.startMs,
      endMs,
      hookMs: clamp(clip.hookMs, clip.startMs, endMs),
      durationMs: endMs - clip.startMs,
      width,
      height,
      framing,
      cropX,
      cropY,
      subtitleConfig,
      audioConfig,
      intro,
      outro,
      editData,
    }));
  }

  const options = { framing, cropX, cropY, width, height, intro, outro, audioConfig, subtitleConfig: true };
  const job = await processing.createJobForSource({
    userId,
    projectId: source.projectId,
    sourceVideoId: source.id,
    queueName: QUEUE_NAMES.videoRendering,
    jobType: 'video-rendering',
    payload: { draftIds, options },
  });
  const result = await repo.listForSource(userId, source.id);
  return { drafts: result.drafts.filter((draft) => draftIds.includes(draft.id)), job };
}

type UpdateInput = {
  cropX?: number;
  cropY?: number;
  framing?: 'smart' | 'center' | 'face' | 'speaker';
  title?: string;
  description?: string;
  selected?: boolean;
  subtitleEnabled?: boolean;
  introText?: string;
  outroText?: string;
  introSeconds?: number;
  outroSeconds?: number;
  volume?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
};

export async function updateDraft(userId: number, id: number, input: UpdateInput) {
  const current = await repo.findDraft(userId, id);
  if (!current) throw new AppError(404, 'SHORT_DRAFT_NOT_FOUND', 'Shorts draft not found');

  const patch: Record<string, string | number | null> = {};
  if (input.cropX !== undefined) patch.crop_x = clamp(input.cropX, -1, 1);
  if (input.cropY !== undefined) patch.crop_y = clamp(input.cropY, -1, 1);
  if (input.framing !== undefined) patch.framing = input.framing;
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.selected !== undefined) patch.selected = input.selected ? 1 : 0;

  const subtitles = current.subtitleConfig ?? DEFAULT_SUBTITLES;
  if (input.subtitleEnabled !== undefined) patch.subtitle_config_json = JSON.stringify({ ...subtitles, enabled: input.subtitleEnabled });
  if (input.introText !== undefined || input.introSeconds !== undefined) {
    patch.intro_json = JSON.stringify({
      text: input.introText ?? current.intro.text,
      seconds: clamp(input.introSeconds ?? current.intro.seconds, 0, 10),
    });
  }
  if (input.outroText !== undefined || input.outroSeconds !== undefined) {
    patch.outro_json = JSON.stringify({
      text: input.outroText ?? current.outro.text,
      seconds: clamp(input.outroSeconds ?? current.outro.seconds, 0, 10),
    });
  }
  const audio = {
    volume: clamp(input.volume ?? current.audioConfig.volume, 0, 4),
    fadeInSeconds: clamp(input.fadeInSeconds ?? current.audioConfig.fadeInSeconds, 0, 10),
    fadeOutSeconds: clamp(input.fadeOutSeconds ?? current.audioConfig.fadeOutSeconds, 0, 10),
  };
  if (input.volume !== undefined || input.fadeInSeconds !== undefined || input.fadeOutSeconds !== undefined) {
    patch.audio_config_json = JSON.stringify(audio);
  }

  const renderChanged = Object.keys(patch).some((key) => key !== 'selected' && key !== 'title' && key !== 'description');
  let job = null;
  if (renderChanged) {
    const active = await processingRepo.findActiveJobForSource(current.sourceVideoId, QUEUE_NAMES.videoRendering);
    if (active) throw new AppError(409, 'RENDER_IN_PROGRESS', 'A Shorts render job is already active for this source');
    patch.status = 'queued';
    patch.error_message = null;
  }

  const editData = {
    ...current.editData,
    sourceTimestamps: { startMs: current.startMs, endMs: current.endMs, hookMs: current.hookMs },
    cropPosition: {
      framing: input.framing ?? current.framing,
      cropX: input.cropX ?? current.cropX,
      cropY: input.cropY ?? current.cropY,
    },
    outputDimensions: { width: current.width, height: current.height },
    subtitleConfig: input.subtitleEnabled === undefined ? subtitles : { ...subtitles, enabled: input.subtitleEnabled },
    audioConfig: audio,
    version: current.version,
  };
  patch.edit_data_json = JSON.stringify(editData);

  const draft = await repo.updateDraft(userId, id, patch);
  if (!draft) throw new AppError(404, 'SHORT_DRAFT_NOT_FOUND', 'Shorts draft not found');

  if (renderChanged) {
    job = await processing.createJobForSource({
      userId,
      projectId: draft.projectId,
      sourceVideoId: draft.sourceVideoId,
      queueName: QUEUE_NAMES.videoRendering,
      jobType: 'video-rendering',
      payload: { draftIds: [draft.id] },
    });
  }
  return { draft, job };
}

export async function findMedia(userId: number, id: number) {
  const media = await repo.findDraftMedia(userId, id);
  if (!media) throw new AppError(404, 'SHORT_MEDIA_NOT_FOUND', 'Rendered Short not found');
  return media;
}

export async function findThumbnail(userId: number, id: number) {
  const thumbnail = await repo.findDraftThumbnail(userId, id);
  if (!thumbnail) throw new AppError(404, 'SHORT_THUMBNAIL_NOT_FOUND', 'Draft thumbnail not found');
  return thumbnail;
}
