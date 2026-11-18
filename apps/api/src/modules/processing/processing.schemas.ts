import { z } from 'zod';
import { QUEUE_NAMES } from '@viralclip/shared';

export const processingQueueSchema = z.enum([
  QUEUE_NAMES.videoIngestion,
  QUEUE_NAMES.transcription,
  QUEUE_NAMES.aiAnalysis,
  QUEUE_NAMES.clipGeneration,
  QUEUE_NAMES.videoRendering,
  QUEUE_NAMES.youtubeUpload,
]);

export const listJobsSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  sourceVideoId: z.coerce.number().int().positive().optional(),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).optional(),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const createIngestionSchema = z.object({
  sourceVideoId: z.coerce.number().int().positive(),
});
