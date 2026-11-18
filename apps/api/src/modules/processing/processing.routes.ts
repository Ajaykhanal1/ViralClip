import { Router } from 'express';
import type { Request, Response } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as repo from './processing.repository.js';
import { createIngestionSchema, idParamSchema, listJobsSchema } from './processing.schemas.js';
import * as service from './processing.service.js';

export const processingRouter = Router();
processingRouter.use(requireAuth);

processingRouter.get('/jobs', async (req, res) => {
  const filters = listJobsSchema.parse(req.query);
  sendOk(res, await service.listJobs(req.user!.id, filters));
});

processingRouter.post('/jobs/ingest', async (req, res) => {
  const input = createIngestionSchema.parse(req.body);
  const job = await service.enqueueIngestionForSource(req.user!.id, input.sourceVideoId);
  sendOk(res, { job }, 202);
});

processingRouter.get('/jobs/:id', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.getJob(req.user!.id, id));
});

processingRouter.get('/jobs/:id/logs', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.getJobLogs(req.user!.id, id));
});

processingRouter.post('/jobs/:id/cancel', async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  sendOk(res, await service.cancelJob(req.user!.id, id));
});

// SSE progress stream. Sends snapshots so worker-side DB updates are visible.
processingRouter.get('/stream', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const send = async () => {
    if (closed) return;
    try {
      const jobs = await repo.listJobs(userId, projectId ? { projectId } : {});
      res.write(`event: jobs\ndata: ${JSON.stringify({ jobs })}\n\n`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'stream error';
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    }
  };

  await send();
  const timer = setInterval(() => void send(), 2000);
  req.on('close', () => clearInterval(timer));
});
