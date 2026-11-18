import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../http/errors.js';
import { sendOk } from '../../http/respond.js';
import { extractYouTubeId, fetchYouTubeMetadata } from '../../lib/youtube.js';
import { requireAuth } from '../auth/auth.middleware.js';
import * as repo from './sources.repository.js';

const listSchema = z.object({ projectId: z.coerce.number().int().positive().optional() });
const youtubeSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  url: z.string().url().max(512),
});

export const sourcesRouter = Router();
sourcesRouter.use(requireAuth);

sourcesRouter.get('/', async (req, res) => {
  const input = listSchema.parse(req.query);
  if (input.projectId) {
    const owner = await repo.findProjectOwner(input.projectId);
    if (owner !== req.user!.id) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${input.projectId} does not exist`);
  }
  const sources = await repo.listSources(req.user!.id, input.projectId);
  sendOk(res, { sources });
});

sourcesRouter.post('/youtube', async (req, res) => {
  const input = youtubeSchema.parse(req.body);
  const owner = await repo.findProjectOwner(input.projectId);
  if (owner !== req.user!.id) throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${input.projectId} does not exist`);

  const videoId = extractYouTubeId(input.url);
  if (!videoId) {
    throw new AppError(400, 'INVALID_YOUTUBE_URL', 'Enter a valid YouTube video URL.');
  }

  const meta = await fetchYouTubeMetadata(videoId, env.YOUTUBE_API_KEY);
  const source = await repo.createYouTubeSource({
    userId: req.user!.id,
    projectId: input.projectId,
    title: meta?.title ?? `YouTube video ${videoId}`,
    sourceUrl: input.url,
    youtubeVideoId: videoId,
    thumbnailUrl: meta?.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    metadataJson: meta ? JSON.stringify(meta) : null,
  });

  sendOk(
    res,
    {
      source,
      requiresAuthorizedSource: true,
      message:
        'YouTube metadata saved. To process this video, upload an authorized source file you own or have rights to use.',
    },
    201,
  );
});
