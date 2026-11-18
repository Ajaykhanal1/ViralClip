import { Worker } from 'bullmq';
import { QUEUE_NAMES, redisConnectionFromUrl, type ProcessingJobPayload, type VideoPipelineJob } from '@viralclip/shared';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/mysql.js';
import { startHealthServer } from './health.js';
import { logMediaToolVersions } from './media/ffmpeg.js';
import { processVideoIngestion } from './processors/video-ingestion.js';
import { processAiAnalysis, processClipGeneration, processVideoRendering, processYoutubeUpload } from './processors/stages.js';
import { processTranscription } from './processors/transcription.js';
import { processVideoPipeline } from './processors/video-pipeline.js';

const connection = {
  ...redisConnectionFromUrl(env.REDIS_URL),
  maxRetriesPerRequest: null as null,
};

logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'starting worker');
await logMediaToolVersions(logger);

function makeWorker<T>(queueName: string, processor: (job: any) => Promise<any>, concurrency = env.WORKER_CONCURRENCY) {
  const w = new Worker<T>(queueName, processor, { connection, concurrency });
  w.on('completed', (job) => logger.info({ queue: queueName, jobId: job.id }, 'job completed'));
  w.on('failed', (job, error) => logger.error({ queue: queueName, jobId: job?.id, err: error }, 'job failed'));
  w.on('error', (error) => logger.error({ queue: queueName, err: error }, 'worker error'));
  return w;
}

const workers = [
  makeWorker<ProcessingJobPayload>(QUEUE_NAMES.videoIngestion, processVideoIngestion, env.WORKER_CONCURRENCY),
  makeWorker<ProcessingJobPayload>(QUEUE_NAMES.transcription, processTranscription, Math.max(1, Math.min(2, env.WORKER_CONCURRENCY))),
  makeWorker<ProcessingJobPayload>(QUEUE_NAMES.aiAnalysis, processAiAnalysis, Math.max(1, Math.min(2, env.WORKER_CONCURRENCY))),
  makeWorker<ProcessingJobPayload>(QUEUE_NAMES.clipGeneration, processClipGeneration, Math.max(1, Math.min(2, env.WORKER_CONCURRENCY))),
  makeWorker<ProcessingJobPayload>(QUEUE_NAMES.videoRendering, processVideoRendering, Math.max(1, env.WORKER_CONCURRENCY)),
  makeWorker<ProcessingJobPayload>(QUEUE_NAMES.youtubeUpload, processYoutubeUpload, 1),
  // legacy compatibility
  makeWorker<VideoPipelineJob>(QUEUE_NAMES.videoPipeline, processVideoPipeline, 1),
];

const healthServer = startHealthServer(env.WORKER_HEALTH_PORT);
await Promise.all(workers.map((w) => w.waitUntilReady()));
logger.info({ queues: workers.length, healthPort: env.WORKER_HEALTH_PORT }, 'worker ready');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down worker');
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out');
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  await Promise.allSettled(workers.map((w) => w.close()));
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await closePool().catch(() => {});
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
