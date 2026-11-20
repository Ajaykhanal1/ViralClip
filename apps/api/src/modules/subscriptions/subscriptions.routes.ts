import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { emailNotificationsSchema } from './subscriptions.schemas.js';
import * as service from './subscriptions.service.js';

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get('/state', async (req, res) => {
  sendOk(res, await service.state(req.user!.id));
});

/** Plan changes are database configuration only; there is no paid activation or checkout. */
subscriptionsRouter.patch('/email-notifications', async (req, res) => {
  const { enabled } = emailNotificationsSchema.parse(req.body);
  sendOk(res, await service.setEmailNotifications(req.user!.id, enabled));
});
