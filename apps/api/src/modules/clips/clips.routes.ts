import type { Request, Response } from 'express';
import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { fileSize, readKeyStream } from '../../storage/local.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as service from './clips.service.js';
import { analyzeRequestSchema, idParamSchema, sourceParamSchema, updateClipSchema } from './clips.schemas.js';

export const clipsRouter = Router();
clipsRouter.use(requireAuth);

clipsRouter.get('/source/:sourceId', async (req, res) => {
  const { sourceId } = sourceParamSchema.parse(req.params);
  sendOk(res, await service.listForSource(req.user!.id, sourceId));
});

clipsRouter.post('/analyze', async (req, res) => {
  const input = analyzeRequestSchema.parse(req.body);
  sendOk(res, await service.requestAnalysis(req.user!.id, input), 202);
});

clipsRouter.patch('/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updateClipSchema.parse(req.body);
  sendOk(res, await service.updateRecommendation(req.user!.id, id, input));
});

clipsRouter.get('/source/:sourceId/media', async (req: Request, res: Response) => {
  const { sourceId } = sourceParamSchema.parse(req.params);
  const media = await service.findSourceMedia(req.user!.id, sourceId);
  const size = await fileSize(media.storageKey);
  const contentType = media.mimeType || 'video/mp4';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', String(size));
    res.end();
    return;
  }

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', String(size));
    readKeyStream(media.storageKey).on('error', () => res.destroy()).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    res.setHeader('Content-Range', `bytes */${size}`);
    res.status(416).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    res.setHeader('Content-Range', `bytes */${size}`);
    res.status(416).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  readKeyStream(media.storageKey, { start, end }).on('error', () => res.destroy()).pipe(res);
});
