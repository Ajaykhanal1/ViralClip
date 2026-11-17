import { z } from 'zod';

export const createVideoSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  originalFilename: z.string().min(1).max(255),
  storageKey: z.string().min(1).max(512),
  mimeType: z.string().max(100).optional(),
  sizeBytes: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  durationSeconds: z.coerce.number().nonnegative().optional(),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
