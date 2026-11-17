import { Queue } from 'bullmq';
import { QUEUE_NAMES, redisConnectionFromUrl, type VideoPipelineJob } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withTimeout } from '../utils/with-timeout.js';

export const videoQueue = new Queue<VideoPipelineJob>(QUEUE_NAMES.videoPipeline, {
  connection: {
    ...redisConnectionFromUrl(env.REDIS_URL),
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

// Without a listener BullMQ emits unhandled "error" events while Redis is down.
videoQueue.on('error', (error) => {
  logger.warn({ err: error }, 'video queue connection error');
});

export async function enqueueVideoPipeline(data: VideoPipelineJob): Promise<string> {
  const job = await videoQueue.add('process-video', data);
  return job.id ?? '';
}

export async function pingRedis(): Promise<void> {
  await withTimeout(videoQueue.waitUntilReady(), 2000, 'Redis');
  const client = await withTimeout(videoQueue.getBackend().client, 2000, 'Redis');
  await withTimeout(client.info(), 2000, 'Redis ping');
}

export async function closeQueue(): Promise<void> {
  await videoQueue.close();
}
