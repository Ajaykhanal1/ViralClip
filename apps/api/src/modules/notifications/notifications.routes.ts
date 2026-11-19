import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idParamSchema } from './notifications.schemas.js';
import * as service from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/state', (req, res) => {
  sendOk(res, service.state(req.user!.id));
});

notificationsRouter.post('/read-all', (req, res) => {
  sendOk(res, service.markAllRead(req.user!.id));
});

notificationsRouter.post('/:id/read', (req, res) => {
  sendOk(res, service.markRead(req.user!.id, idParamSchema.parse(req.params).id));
});

notificationsRouter.delete('/:id', (req, res) => {
  sendOk(res, service.remove(req.user!.id, idParamSchema.parse(req.params).id));
});
