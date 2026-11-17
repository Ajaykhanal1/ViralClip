import { Router } from 'express';
import { sendOk } from '../../http/respond.js';
import { createVideoSchema } from './videos.schemas.js';
import { createVideo } from './videos.service.js';

export const videosRouter = Router();

videosRouter.post('/', async (req, res) => {
  const input = createVideoSchema.parse(req.body);
  const result = await createVideo(input);
  sendOk(res, result, 202);
});
