import { Queue } from 'bullmq';
import { QUEUE_NAMES, redisConnectionFromUrl, type ProcessingJobPayload, type VideoPipelineJob } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withTimeout } from '../utils/with-timeout.js';

const connection = {
  ...redisConnectionFromUrl(env.REDIS_URL),
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

function makeQueue<T>(name: string): Queue<T> {
  const q = new Queue<T>(name, { connection, defaultJobOptions });
  q.on('error', (error) => logger.warn({ err: error, queue: name }, 'queue connection error'));
  return q;
}

export const videoIngestionQueue = makeQueue<ProcessingJobPayload>(QUEUE_NAMES.videoIngestion);
export const transcriptionQueue = makeQueue<ProcessingJobPayload>(QUEUE_NAMES.transcription);
export const aiAnalysisQueue = makeQueue<ProcessingJobPayload>(QUEUE_NAMES.aiAnalysis);
export const clipGenerationQueue = makeQueue<ProcessingJobPayload>(QUEUE_NAMES.clipGeneration);
export const videoRenderingQueue = makeQueue<ProcessingJobPayload>(QUEUE_NAMES.videoRendering);
export const youtubeUploadQueue = makeQueue<ProcessingJobPayload>(QUEUE_NAMES.youtubeUpload);

/** Legacy queue kept for Phase 1 compatibility. */
export const videoQueue = new Queue<VideoPipelineJob>(QUEUE_NAMES.videoPipeline, {
  connection,
  defaultJobOptions,
});
videoQueue.on('error', (error) => logger.warn({ err: error, queue: QUEUE_NAMES.videoPipeline }, 'queue connection error'));

const processingQueues: Record<string, Queue<ProcessingJobPayload>> = {
  [QUEUE_NAMES.videoIngestion]: videoIngestionQueue,
  [QUEUE_NAMES.transcription]: transcriptionQueue,
  [QUEUE_NAMES.aiAnalysis]: aiAnalysisQueue,
  [QUEUE_NAMES.clipGeneration]: clipGenerationQueue,
  [QUEUE_NAMES.videoRendering]: videoRenderingQueue,
  [QUEUE_NAMES.youtubeUpload]: youtubeUploadQueue,
};

export async function enqueueVideoPipeline(data: VideoPipelineJob): Promise<string> {
  const job = await videoQueue.add('process-video', data);
  return job.id ?? '';
}

export async function enqueueProcessingJob(queueName: string, data: ProcessingJobPayload): Promise<string> {
  const queue = processingQueues[queueName];
  if (!queue) throw new Error(`Unknown processing queue: ${queueName}`);
  const job = await queue.add(data.processingJobId ? `job-${data.processingJobId}` : queueName, data, {
    jobId: data.processingJobId ? `job-${data.processingJobId}` : undefined,
  });
  return job.id ?? String(data.processingJobId);
}

export async function getBullmqJob(queueName: string, bullmqJobId: string) {
  const queue = queueName === QUEUE_NAMES.videoPipeline ? videoQueue : processingQueues[queueName];
  if (!queue) return null;
  return queue.getJob(bullmqJobId);
}

export async function pingRedis(): Promise<void> {
  await withTimeout(videoQueue.getJobCountByTypes('completed'), 2000, 'Redis');
}

export async function closeQueue(): Promise<void> {
  await Promise.allSettled([
    videoQueue.close(),
    ...Object.values(processingQueues).map((q) => q.close()),
  ]);
}
