import { QUEUE_NAMES, type ProcessingJob, type ProcessingJobPayload } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { enqueueProcessingJob, getBullmqJob } from '../../queue/video.queue.js';
import * as repo from './processing.repository.js';

const DEFAULT_MAX_ATTEMPTS = 3;

export async function listJobs(userId: number, filters: { projectId?: number; sourceVideoId?: number; status?: any }) {
  if (filters.projectId) {
    const owner = await repo.findProjectOwner(filters.projectId);
    if (owner !== userId) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${filters.projectId} does not exist`);
  }
  const jobs = await repo.listJobs(userId, filters);
  return { jobs };
}

export async function getJob(userId: number, id: number) {
  const job = await repo.findJobByIdForUser(userId, id);
  if (!job) throw new AppError(404, 'PROCESSING_JOB_NOT_FOUND', 'Processing job not found');
  const logs = await repo.listLogs(userId, id);
  return { job, logs };
}

export async function getJobLogs(userId: number, id: number) {
  const job = await repo.findJobByIdForUser(userId, id);
  if (!job) throw new AppError(404, 'PROCESSING_JOB_NOT_FOUND', 'Processing job not found');
  return { logs: await repo.listLogs(userId, id) };
}

export async function createJobForSource(input: {
  userId: number;
  projectId: number;
  sourceVideoId: number;
  queueName: string;
  jobType?: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}): Promise<ProcessingJob> {
  const owner = await repo.findProjectOwner(input.projectId);
  if (owner !== input.userId) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${input.projectId} does not exist`);
  const source = await repo.findSource(input.userId, input.sourceVideoId);
  if (!source || source.projectId !== input.projectId) {
    throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
  }

  // Idempotency: avoid duplicate active jobs for same source+queue.
  const existing = await repo.findActiveJobForSource(input.sourceVideoId, input.queueName);
  if (existing) return existing;

  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const job = await repo.insertJob({
    userId: input.userId,
    projectId: input.projectId,
    sourceVideoId: input.sourceVideoId,
    queueName: input.queueName,
    jobType: input.jobType ?? input.queueName,
    maxAttempts,
    payload: input.payload ?? null,
  });
  await repo.appendLog(job.id, 'info', `Queued on ${input.queueName}`, { queue: input.queueName });
  await repo.setSourceStatus(input.userId, input.sourceVideoId, 'queued');

  const payload: ProcessingJobPayload = {
    processingJobId: job.id,
    userId: input.userId,
    projectId: input.projectId,
    sourceVideoId: input.sourceVideoId,
    requestedAt: new Date().toISOString(),
    ...(input.payload ?? {}),
  };
  try {
    const bullId = await enqueueProcessingJob(input.queueName, payload);
    await repo.setBullmqJobId(job.id, bullId);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to enqueue job';
    await repo.updateJobProgress(job.id, { status: 'failed', errorCode: 'ENQUEUE_FAILED', errorMessage: message, completed: true });
    await repo.appendLog(job.id, 'error', 'Failed to enqueue processing job', { error: message });
    await repo.setSourceStatus(input.userId, input.sourceVideoId, 'failed', message);
    throw e;
  }
  return (await repo.findJobByIdForUser(input.userId, job.id))!;
}

export async function enqueueIngestionForSource(userId: number, sourceVideoId: number): Promise<ProcessingJob> {
  const source = await repo.findSource(userId, sourceVideoId);
  if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
  return createJobForSource({
    userId,
    projectId: source.projectId,
    sourceVideoId,
    queueName: QUEUE_NAMES.videoIngestion,
    jobType: 'video-ingestion',
  });
}

export async function cancelJob(userId: number, id: number) {
  const job = await repo.findJobByIdForUser(userId, id);
  if (!job) throw new AppError(404, 'PROCESSING_JOB_NOT_FOUND', 'Processing job not found');
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return { job };
  }
  const updated = await repo.requestCancel(userId, id);
  if (updated?.bullmqJobId && updated.status === 'cancelled') {
    try {
      const bull = await getBullmqJob(updated.queueName, updated.bullmqJobId);
      if (bull) {
        const state = await bull.getState().catch(() => '');
        if (state === 'waiting' || state === 'delayed') await bull.remove().catch(() => {});
      }
    } catch {
      // best effort; worker will honor cancel_requested
    }
  }
  await repo.appendLog(id, 'info', 'Cancellation requested', { previousStatus: job.status });
  if (updated?.status === 'cancelled') {
    await repo.setSourceStatus(userId, updated.sourceVideoId, 'cancelled', 'Processing cancelled');
  }
  return { job: (await repo.findJobByIdForUser(userId, id))! };
}
