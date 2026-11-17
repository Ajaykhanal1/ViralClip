import { Worker } from 'bullmq';
import { QUEUE_NAMES, redisConnectionFromUrl, type VideoPipelineJob } from '@viralclip/shared';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startHealthServer } from './health.js';
import { logMediaToolVersions } from './media/ffmpeg.js';
import { processVideoPipeline } from './processors/video-pipeline.js';

logger.info(
  {
    queue: QUEUE_NAMES.videoPipeline,
    concurrency: env.WORKER_CONCURRENCY,
    aiServiceUrl: env.AI_SERVICE_URL,
  },
  'starting worker',
);

await logMediaToolVersions(logger);

const worker = new Worker<VideoPipelineJob>(QUEUE_NAMES.videoPipeline, processVideoPipeline, {
  connection: {
    ...redisConnectionFromUrl(env.REDIS_URL),
    maxRetriesPerRequest: null,
  },
  concurrency: env.WORKER_CONCURRENCY,
});

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'job completed'));
worker.on('failed', (job, error) => logger.error({ jobId: job?.id, err: error }, 'job failed'));
worker.on('error', (error) => logger.error({ err: error }, 'worker error'));

const healthServer = startHealthServer(env.WORKER_HEALTH_PORT);

await worker.waitUntilReady();
logger.info(
  { queue: QUEUE_NAMES.videoPipeline, healthPort: env.WORKER_HEALTH_PORT },
  'worker ready',
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down worker');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  await worker.close();
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  logger.info('worker stopped');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});
