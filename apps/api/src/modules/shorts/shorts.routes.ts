import type { Request, Response } from 'express';
import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { fileSize, readKeyStream } from '../../storage/local.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as service from './shorts.service.js';
import { generateShortsSchema, idParamSchema, sourceParamSchema, updateShortSchema } from './shorts.schemas.js';

export const shortsRouter = Router();
shortsRouter.use(requireAuth);

shortsRouter.get('/source/:sourceId', async (req, res) => {
  const { sourceId } = sourceParamSchema.parse(req.params);
  sendOk(res, await service.listForSource(req.user!.id, sourceId));
});

shortsRouter.post('/generate', async (req, res) => {
  const input = generateShortsSchema.parse(req.body);
  sendOk(res, await service.generate(req.user!.id, input), 202);
});

shortsRouter.patch('/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updateShortSchema.parse(req.body);
  sendOk(res, await service.updateDraft(req.user!.id, id, input));
});

shortsRouter.get('/:id/thumbnail', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const thumbnail = await service.findThumbnail(req.user!.id, id);
  const size = await fileSize(thumbnail.storageKey);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'no-store');
  readKeyStream(thumbnail.storageKey).on('error', () => res.destroy()).pipe(res);
});

shortsRouter.get('/:id/media', async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const media = await service.findMedia(req.user!.id, id);
  const size = await fileSize(media.storageKey);
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="short-draft-${id}.mp4"`);

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
