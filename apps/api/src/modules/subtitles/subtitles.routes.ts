import { Router } from 'express';
import { z } from 'zod';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as service from './subtitles.service.js';
import { exportFormatSchema, idParamSchema, mergeSegmentsSchema, replaceSegmentsSchema, sourceParamSchema, splitSegmentSchema, transcribeRequestSchema, updateSegmentSchema, updateTrackSchema } from './subtitles.schemas.js';

const segmentIndexSchema = z.object({ trackId: z.coerce.number().int().positive(), segmentIndex: z.coerce.number().int().min(0) });

export const subtitlesRouter = Router();
subtitlesRouter.use(requireAuth);

subtitlesRouter.get('/source/:sourceId', async (req, res) => {
  const { sourceId } = sourceParamSchema.parse(req.params);
  sendOk(res, await service.listForSource(req.user!.id, sourceId));
});

subtitlesRouter.post('/transcribe', async (req, res) => {
  const input = transcribeRequestSchema.parse(req.body);
  const result = await service.requestTranscription(req.user!.id, input);
  sendOk(res, result, 202);
});

subtitlesRouter.get('/transcripts/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.getTranscript(req.user!.id, id));
});

subtitlesRouter.get('/tracks/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.getTrack(req.user!.id, id));
});

subtitlesRouter.patch('/tracks/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updateTrackSchema.parse(req.body);
  sendOk(res, await service.updateTrack(req.user!.id, id, input));
});

subtitlesRouter.put('/tracks/:id/segments', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = replaceSegmentsSchema.parse(req.body);
  sendOk(res, await service.replaceSegments(req.user!.id, id, input.segments));
});

subtitlesRouter.patch('/tracks/:trackId/segments/:segmentIndex', async (req, res) => {
  const { trackId, segmentIndex } = segmentIndexSchema.parse(req.params);
  const input = updateSegmentSchema.parse(req.body);
  sendOk(res, await service.updateSegment(req.user!.id, trackId, segmentIndex, input));
});

subtitlesRouter.delete('/tracks/:trackId/segments/:segmentIndex', async (req, res) => {
  const { trackId, segmentIndex } = segmentIndexSchema.parse(req.params);
  sendOk(res, await service.deleteSegment(req.user!.id, trackId, segmentIndex));
});

subtitlesRouter.post('/tracks/:trackId/segments/:segmentIndex/split', async (req, res) => {
  const { trackId, segmentIndex } = segmentIndexSchema.parse(req.params);
  const input = splitSegmentSchema.parse(req.body ?? {});
  sendOk(res, await service.splitSegment(req.user!.id, trackId, segmentIndex, input));
});

subtitlesRouter.post('/tracks/:trackId/segments/:segmentIndex/merge', async (req, res) => {
  const { trackId, segmentIndex } = segmentIndexSchema.parse(req.params);
  const input = mergeSegmentsSchema.parse(req.body ?? {});
  sendOk(res, await service.mergeSegment(req.user!.id, trackId, segmentIndex, input.with));
});

subtitlesRouter.get('/tracks/:id/export/:format', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const format = exportFormatSchema.parse(req.params.format);
  const out = await service.exportTrack(req.user!.id, id, format);
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.content);
});
