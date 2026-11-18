import { z } from 'zod';

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const sourceParamSchema = z.object({ sourceId: z.coerce.number().int().positive() });

const segmentSchema = z.object({
  startMs: z.coerce.number().int().min(0),
  endMs: z.coerce.number().int().min(0),
  text: z.string(),
  speaker: z.string().max(64).nullable().optional(),
});

export const updateTrackSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  language: z.string().max(32).nullable().optional(),
  style: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const replaceSegmentsSchema = z.object({
  segments: z.array(segmentSchema),
});

export const updateSegmentSchema = z.object({
  startMs: z.coerce.number().int().min(0).optional(),
  endMs: z.coerce.number().int().min(0).optional(),
  text: z.string().optional(),
  speaker: z.string().max(64).nullable().optional(),
});

export const splitSegmentSchema = z.object({
  // split at time (ms) within segment, or at textOffset (chars). If neither, split midpoint.
  atMs: z.coerce.number().int().min(0).optional(),
  textOffset: z.coerce.number().int().min(0).optional(),
});

export const mergeSegmentsSchema = z.object({
  with: z.enum(['next', 'previous']).default('next'),
});

export const transcribeRequestSchema = z.object({
  sourceVideoId: z.coerce.number().int().positive(),
  language: z.string().max(32).nullable().optional(),
  translateToEnglish: z.boolean().optional(),
  targetTrackId: z.coerce.number().int().positive().nullable().optional(),
  regenerate: z.boolean().optional(),
});

export const exportFormatSchema = z.enum(['srt', 'vtt', 'json']);
