import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idParamSchema } from './notifications.schemas.js';
import * as service from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/state', async (req, res) => {
  sendOk(res, await service.state(req.user!.id));
});

notificationsRouter.post('/read-all', async (req, res) => {
  sendOk(res, await service.markAllRead(req.user!.id));
});

notificationsRouter.post('/:id/read', async (req, res) => {
  sendOk(res, await service.markRead(req.user!.id, idParamSchema.parse(req.params).id));
});

notificationsRouter.delete('/:id', async (req, res) => {
  sendOk(res, await service.remove(req.user!.id, idParamSchema.parse(req.params).id));
});
