import { z } from 'zod';

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const sourceParamSchema = z.object({ sourceId: z.coerce.number().int().positive() });

const weightsSchema = z
  .object({
    hookStrength: z.number().min(0).max(100),
    emotionalIntensity: z.number().min(0).max(100),
    interestingStatements: z.number().min(0).max(100),
    storyCompleteness: z.number().min(0).max(100),
    educationalValue: z.number().min(0).max(100),
    dialogueQuality: z.number().min(0).max(100),
    sceneChanges: z.number().min(0).max(100),
    speakerChanges: z.number().min(0).max(100),
    audioEnergy: z.number().min(0).max(100),
    visualInterest: z.number().min(0).max(100),
  })
  .partial();

export const analyzeRequestSchema = z
  .object({
    sourceVideoId: z.coerce.number().int().positive(),
    minDurationSeconds: z.number().min(5).max(600).optional(),
    maxDurationSeconds: z.number().min(5).max(600).optional(),
    maxClips: z.number().int().min(1).max(20).optional(),
    weights: weightsSchema.optional(),
  })
  .refine(
    (value) =>
      value.minDurationSeconds == null ||
      value.maxDurationSeconds == null ||
      value.minDurationSeconds <= value.maxDurationSeconds,
    { message: 'minDurationSeconds cannot exceed maxDurationSeconds', path: ['minDurationSeconds'] },
  );

export const updateClipSchema = z
  .object({
    startMs: z.number().int().min(0).optional(),
    endMs: z.number().int().min(0).optional(),
    hookMs: z.number().int().min(0).optional(),
    suggestedTitle: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    status: z.enum(['suggested', 'selected', 'rejected']).optional(),
  })
  .refine(
    (value) => value.startMs == null || value.endMs == null || value.endMs > value.startMs,
    { message: 'endMs must be greater than startMs', path: ['endMs'] },
  );
