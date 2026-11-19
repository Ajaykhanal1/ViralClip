import { QUEUE_NAMES } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import * as processing from '../processing/processing.service.js';
import { runPublishingCheck } from '../rights/rights.service.js';
import * as repo from './clips.repository.js';

function assertSource(userId: number, source: { projectId: number } | null) {
  if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
  return source;
}

export async function listForSource(userId: number, sourceVideoId: number) {
  assertSource(userId, await repo.findSource(userId, sourceVideoId));
  return repo.listForSource(userId, sourceVideoId);
}

export async function requestAnalysis(
  userId: number,
  input: { sourceVideoId: number; minDurationSeconds?: number; maxDurationSeconds?: number; maxClips?: number; weights?: Record<string, number> },
) {
  const source = assertSource(userId, await repo.findSource(userId, input.sourceVideoId));
  const rights = await runPublishingCheck(userId, {
    projectId: source.projectId,
    sourceVideoId: input.sourceVideoId,
    context: 'manual',
  });
  if (!rights.allowed) {
    throw new AppError(403, 'RIGHTS_REQUIRED', `AI analysis blocked by rights check: ${rights.reasons.join(' ')}`, { reasons: rights.reasons });
  }

  const job = await processing.createJobForSource({
    userId,
    projectId: source.projectId,
    sourceVideoId: input.sourceVideoId,
    queueName: QUEUE_NAMES.aiAnalysis,
    jobType: 'ai-analysis',
    payload: {
      minDurationSeconds: input.minDurationSeconds,
      maxDurationSeconds: input.maxDurationSeconds,
      maxClips: input.maxClips,
      weights: input.weights,
    },
  });
  return { job };
}

export async function updateRecommendation(
  userId: number,
  id: number,
  patch: { startMs?: number; endMs?: number; hookMs?: number; suggestedTitle?: string; description?: string; status?: string },
) {
  const current = await repo.findRecommendation(userId, id);
  if (!current) throw new AppError(404, 'CLIP_RECOMMENDATION_NOT_FOUND', 'Clip recommendation not found');
  const durationMs = await repo.getSourceDurationMs(current.sourceVideoId);
  if (durationMs == null || durationMs <= 0) {
    throw new AppError(409, 'SOURCE_DURATION_UNKNOWN', 'Cannot adjust timestamps until source media is processed');
  }

  const startMs = Math.max(0, Math.min(durationMs, Math.round(patch.startMs ?? current.startMs)));
  const endMs = Math.max(0, Math.min(durationMs, Math.round(patch.endMs ?? current.endMs)));
  if (endMs <= startMs) throw new AppError(400, 'INVALID_CLIP_TIMESTAMPS', 'endMs must be greater than startMs');

  const updated = await repo.updateRecommendation(userId, id, {
    start_ms: startMs,
    end_ms: endMs,
    duration_ms: endMs - startMs,
    hook_ms: Math.max(startMs, Math.min(endMs, Math.round(patch.hookMs ?? current.hookMs))),
    suggested_title: patch.suggestedTitle,
    description: patch.description,
    status: patch.status,
  });
  if (!updated) throw new AppError(404, 'CLIP_RECOMMENDATION_NOT_FOUND', 'Clip recommendation not found');
  return { clip: updated };
}

export async function findSourceMedia(userId: number, sourceVideoId: number) {
  assertSource(userId, await repo.findSource(userId, sourceVideoId));
  const media = await repo.findSourceMedia(userId, sourceVideoId);
  if (!media) throw new AppError(404, 'SOURCE_MEDIA_NOT_FOUND', 'Processed source media not found');
  return media;
}
