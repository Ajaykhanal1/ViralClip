import { Router } from 'express';
import type { Request, Response } from 'express';
import { API_PREFIX } from '@viralclip/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../http/errors.js';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { z } from 'zod';
import * as service from './uploads.service.js';

const createSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(100).optional(),
  sizeBytes: z.coerce.number().int().nonnegative().optional(),
  sourceVideoId: z.coerce.number().int().positive().optional(),
});
const idSchema = z.object({ id: z.coerce.number().int().positive() });

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post('/sessions', async (req, res) => {
  const input = createSchema.parse(req.body);
  const { session, uploadToken } = await service.createUploadSession(req.user!.id, input);
  sendOk(
    res,
    {
      session,
      uploadToken,
      uploadPath: `${API_PREFIX}/uploads/sessions/${session!.id}/content`,
      maxUploadBytes: env.MAX_UPLOAD_BYTES,
    },
    201,
  );
});

uploadsRouter.get('/sessions/:id', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const session = await service.getUploadSession(req.user!.id, id);
  sendOk(res, { session });
});

uploadsRouter.post('/sessions/:id/cancel', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const session = await service.cancelUploadSession(req.user!.id, id);
  sendOk(res, { session });
});

// Raw upload content handler (registered on app before json parser).
export async function handleUploadContent(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid session id');
  // Header only: query tokens would be written to access logs and proxy history.
  const token = typeof req.headers['x-upload-token'] === 'string' ? req.headers['x-upload-token'] : '';
  if (!token) throw new AppError(401, 'MISSING_UPLOAD_TOKEN', 'Upload token required');
  const sourceVideoId = req.query.sourceVideoId ? Number(req.query.sourceVideoId) : undefined;
  const result = await service.receiveUploadContent({
    sessionId: id,
    token,
    body: req,
    sourceVideoId: Number.isInteger(sourceVideoId) && (sourceVideoId as number) > 0 ? (sourceVideoId as number) : undefined,
  });
  sendOk(res, result, 201);
}
