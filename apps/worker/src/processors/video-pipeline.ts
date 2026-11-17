import type { Job } from 'bullmq';
import type { VideoPipelineJob } from '@viralclip/shared';
import { logger } from '../config/logger.js';

/**
 * Phase 1 scaffolding. The real pipeline (download from storage, ffprobe/ffmpeg,
 * AI service calls, clip rows) is Phase 2 work and belongs in worker modules,
 * never in API request handlers.
 *
 * shortcut: returns success without processing, replace before enabling uploads.
 */
export async function processVideoPipeline(
  job: Job<VideoPipelineJob>,
): Promise<{ accepted: true }> {
  logger.info(
    { jobId: job.id, videoId: job.data.videoId, projectId: job.data.projectId },
    'video pipeline job received (processing not implemented yet)',
  );
  return { accepted: true };
}
