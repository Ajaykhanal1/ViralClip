import { QUEUE_NAMES, type ProcessingJob, type RenderJob, type RenderStateResult } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import * as editorRepo from '../editor/editor.repository.js';
import { validateTimeline } from '../editor/editor.timeline.js';
import * as processingRepo from '../processing/processing.repository.js';
import * as processing from '../processing/processing.service.js';
import { runPublishingCheck } from '../rights/rights.service.js';
import * as repo from './render.repository.js';

const finished = new Set(['completed', 'failed', 'cancelled']);

export async function start(userId: number, editId: number): Promise<{ job: RenderJob; processingJob: ProcessingJob }> {
  const edit = await editorRepo.findEditById(userId, editId);
  if (!edit) throw new AppError(404, 'EDIT_NOT_FOUND', 'Editor project not found');
  const draft = await editorRepo.findDraft(userId, edit.draftId);
  if (!draft) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Shorts draft not found');

  validateTimeline(edit.timeline, draft.endMs - draft.startMs);
  const ratio = edit.timeline.settings.width / edit.timeline.settings.height;
  if (!Number.isFinite(ratio) || Math.abs(ratio - 9 / 16) > 0.01) {
    throw new AppError(400, 'INVALID_OUTPUT_RATIO', 'Final Shorts output must use a 9:16 aspect ratio');
  }

  const rights = await runPublishingCheck(userId, {
    projectId: edit.projectId,
    sourceVideoId: edit.sourceVideoId,
    context: 'render',
  });
  if (!rights.allowed) {
    throw new AppError(403, 'RIGHTS_REQUIRED', `Render blocked by rights check: ${rights.reasons.join(' ')}`, { reasons: rights.reasons });
  }

  const active = await processingRepo.findActiveJobForSource(edit.sourceVideoId, QUEUE_NAMES.videoRendering);
  if (active) throw new AppError(409, 'RENDER_IN_PROGRESS', 'A render job is already active for this source');

  const job = await repo.insertRenderJob({
    userId,
    editId: edit.id,
    draftId: draft.id,
    projectId: edit.projectId,
    sourceVideoId: edit.sourceVideoId,
    configurationVersion: edit.version,
    payload: { timelineVersion: edit.version, width: edit.timeline.settings.width, height: edit.timeline.settings.height },
  });
  try {
    const processingJob = await processing.createJobForSource({
      userId,
      projectId: edit.projectId,
      sourceVideoId: edit.sourceVideoId,
      queueName: QUEUE_NAMES.videoRendering,
      jobType: 'video-rendering',
      payload: { draftIds: [draft.id], options: {}, editId: edit.id, renderJobId: job.id },
    });
    await repo.linkProcessingJob(job.id, processingJob.id);
    return { job: (await repo.findRenderJob(userId, job.id))!, processingJob };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue render';
    await repo.updateRenderJob(job.id, {
      status: 'failed', errorCode: 'ENQUEUE_FAILED', errorMessage: message, completed: true,
    }).catch(() => {});
    throw error;
  }
}

export async function retry(userId: number, jobId: number) {
  const existing = await repo.findRenderJob(userId, jobId);
  if (!existing) throw new AppError(404, 'RENDER_JOB_NOT_FOUND', 'Render job not found');
  return start(userId, existing.editId);
}

export async function state(userId: number, editId?: number): Promise<RenderStateResult> {
  const [jobs, videos] = await Promise.all([
    repo.listRenderJobs(userId, editId),
    repo.listRenderedVideos(userId, editId),
  ]);
  return { jobs, videos };
}

export async function getJob(userId: number, id: number) {
  const job = await repo.findRenderJob(userId, id);
  if (!job) throw new AppError(404, 'RENDER_JOB_NOT_FOUND', 'Render job not found');
  return { job };
}

export async function cancel(userId: number, id: number) {
  const job = await repo.findRenderJob(userId, id);
  if (!job) throw new AppError(404, 'RENDER_JOB_NOT_FOUND', 'Render job not found');
  if (finished.has(job.status)) return { job };
  await repo.requestCancel(userId, id);
  if (job.processingJobId) await processing.cancelJob(userId, job.processingJobId).catch(() => {});
  return { job: (await repo.findRenderJob(userId, id))! };
}

export async function findMedia(userId: number, id: number) {
  const video = await repo.findRenderedVideo(userId, id);
  if (!video) throw new AppError(404, 'RENDERED_VIDEO_NOT_FOUND', 'Rendered video not found');
  return video;
}

export async function findThumbnail(userId: number, id: number) {
  const video = await repo.findRenderedVideo(userId, id);
  if (!video?.thumbnailKey) throw new AppError(404, 'RENDER_THUMBNAIL_NOT_FOUND', 'Render thumbnail not found');
  return { thumbnailKey: video.thumbnailKey };
}
