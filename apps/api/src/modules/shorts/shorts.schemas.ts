import { z } from 'zod';

export const sourceParamSchema = z.object({ sourceId: z.coerce.number().int().positive() });
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const framingSchema = z.enum(['smart', 'center', 'face', 'speaker']);
const offset = z.number().min(-1).max(1);
const seconds = z.number().min(0).max(180);

export const generateShortsSchema = z.object({
  sourceVideoId: z.coerce.number().int().positive(),
  recommendationIds: z.array(z.coerce.number().int().positive()).min(1).max(20).optional(),
  framing: framingSchema.optional(),
  cropX: offset.optional(),
  cropY: offset.optional(),
  width: z.number().int().min(360).max(2160).optional(),
  height: z.number().int().min(640).max(3840).optional(),
  durationSeconds: z.number().min(5).max(180).optional(),
  subtitleEnabled: z.boolean().optional(),
  introText: z.string().max(160).optional(),
  outroText: z.string().max(160).optional(),
  introSeconds: seconds.optional(),
  outroSeconds: seconds.optional(),
  volume: z.number().min(0).max(4).optional(),
  fadeInSeconds: seconds.optional(),
  fadeOutSeconds: seconds.optional(),
});

export const updateShortSchema = z
  .object({
    cropX: offset.optional(),
    cropY: offset.optional(),
    framing: framingSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    selected: z.boolean().optional(),
    subtitleEnabled: z.boolean().optional(),
    introText: z.string().max(160).optional(),
    outroText: z.string().max(160).optional(),
    introSeconds: seconds.optional(),
    outroSeconds: seconds.optional(),
    volume: z.number().min(0).max(4).optional(),
    fadeInSeconds: seconds.optional(),
    fadeOutSeconds: seconds.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied' });
