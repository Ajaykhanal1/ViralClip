import type { Request, Response } from 'express';
import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { fileSize, readKeyStream } from '../../storage/local.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idParamSchema, startSchema, stateQuerySchema } from './render.schemas.js';
import * as service from './render.service.js';

export const renderRouter = Router();
renderRouter.use(requireAuth);

renderRouter.get('/state', (req, res) => {
  const { editId } = stateQuerySchema.parse(req.query);
  sendOk(res, service.state(req.user!.id, editId));
});

renderRouter.post('/', async (req, res) => {
  const { editId } = startSchema.parse(req.body);
  sendOk(res, await service.start(req.user!.id, editId), 202);
});

renderRouter.get('/jobs/:id', (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, service.getJob(req.user!.id, id));
});

renderRouter.post('/jobs/:id/cancel', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.cancel(req.user!.id, id));
});

renderRouter.post('/jobs/:id/retry', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.retry(req.user!.id, id), 202);
});

renderRouter.get('/videos/:id/thumbnail', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const thumbnail = await service.findThumbnail(req.user!.id, id);
  const size = await fileSize(thumbnail.thumbnailKey);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'no-store');
  readKeyStream(thumbnail.thumbnailKey).on('error', () => res.destroy()).pipe(res);
});

/** Byte-range streaming for preview and download; storage keys always come from a render row. */
async function streamVideo(req: Request, res: Response, id: number, download: boolean) {
  const video = await service.findMedia(req.user!.id, id);
  const size = await fileSize(video.storageKey);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="viralclip-short-${id}.mp4"`);
  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', String(size));
    res.end();
    return;
  }
  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', String(size));
    readKeyStream(video.storageKey).on('error', () => res.destroy()).pipe(res);
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
  readKeyStream(video.storageKey, { start, end }).on('error', () => res.destroy()).pipe(res);
}

renderRouter.get('/videos/:id/media', (req, res) => streamVideo(req, res, idParamSchema.parse(req.params).id, false));
renderRouter.get('/videos/:id/download', (req, res) => streamVideo(req, res, idParamSchema.parse(req.params).id, true));
