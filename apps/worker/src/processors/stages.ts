import type { Job } from 'bullmq';
import type { ProcessingJobPayload } from '@viralclip/shared';
import { logger } from '../config/logger.js';
import { appendLog, isCancelled, markJobRunning, setSourceStatus, updateJob } from '../processing/jobs.js';

export class CancelledError extends Error {
  constructor() { super('Processing cancelled'); this.name = 'CancelledError'; }
}

async function processStage(job: Job<ProcessingJobPayload>, stage: string): Promise<{ ok: true }> {
  const { processingJobId, userId, sourceVideoId } = job.data;
  const attempt = job.attemptsMade + 1;
  if (await isCancelled(processingJobId)) {
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
    return { ok: true };
  }
  try {
    await markJobRunning(processingJobId, attempt);
    await appendLog(processingJobId, 'info', `${stage} job started`, { attempt, stage });
    if (await isCancelled(processingJobId)) throw new CancelledError();
    // No further phase-6 processing for this stage; record completion of this queued step.
    await updateJob(processingJobId, { status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null, result: { stage, note: 'Stage queued infrastructure ready; downstream implementation pending later phases.' } });
    await appendLog(processingJobId, 'info', `${stage} job completed (infrastructure stage)`);
    return { ok: true };
  } catch (err) {
    if (err instanceof CancelledError || (await isCancelled(processingJobId))) {
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
      await appendLog(processingJobId, 'info', `${stage} job cancelled`).catch(() => {});
      await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
      return { ok: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = attempt >= (job.opts.attempts ?? 3);
    await appendLog(processingJobId, 'error', `${stage} job failed`, { error: message, attempt, finalAttempt }).catch(() => {});
    await updateJob(processingJobId, { status: finalAttempt ? 'failed' : 'queued', errorCode: 'PROCESSING_FAILED', errorMessage: message, completed: finalAttempt }).catch(() => {});
    if (finalAttempt) await setSourceStatus(userId, sourceVideoId, 'failed', message).catch(() => {});
    logger.error({ err, processingJobId, stage }, 'stage processing failed');
    throw err;
  }
}

export const processAiAnalysis = (job: Job<ProcessingJobPayload>) => processStage(job, 'ai-analysis');
export const processClipGeneration = (job: Job<ProcessingJobPayload>) => processStage(job, 'clip-generation');
export const processVideoRendering = (job: Job<ProcessingJobPayload>) => processStage(job, 'video-rendering');
export const processYoutubeUpload = (job: Job<ProcessingJobPayload>) => processStage(job, 'youtube-upload');
