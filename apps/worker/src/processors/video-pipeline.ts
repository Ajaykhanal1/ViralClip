import type { Job } from 'bullmq';
import type { VideoPipelineJob } from '@viralclip/shared';
import { logger } from '../config/logger.js';

/**
 * Legacy Phase 1 queue handler kept for backward compatibility.
 * New processing uses the Phase 6 queue pipeline.
 */
export async function processVideoPipeline(
  job: Job<VideoPipelineJob>,
): Promise<{ accepted: true }> {
  logger.info(
    { jobId: job.id, videoId: job.data.videoId, projectId: job.data.projectId },
    'legacy video pipeline job received (no-op)',
  );
  return { accepted: true };
}
