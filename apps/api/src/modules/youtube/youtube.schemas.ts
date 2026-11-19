import { z } from 'zod';

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** Google redirects the browser back with `code` + `state`, or an `error` when the user declines. */
export const oauthCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().optional(),
});

export const createUploadSchema = z.object({
  renderedVideoId: z.number().int().positive(),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  visibility: z.enum(['public', 'private', 'unlisted']),
  // Explicit user confirmation is required; the frontend cannot send `false`.
  rightsConfirmed: z.literal(true),
});
