import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { getUsageSummary } from './usage.service.js';

export const usageRouter = Router();
usageRouter.use(requireAuth);

usageRouter.get('/state', async (req, res) => {
  sendOk(res, { usage: await getUsageSummary(req.user!.id) });
});
