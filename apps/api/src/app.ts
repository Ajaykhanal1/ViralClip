import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@viralclip/shared';
import { corsOrigins, env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { requireAuth } from './modules/auth/auth.middleware.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { clipsRouter } from './modules/clips/clips.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { healthRouter, liveness } from './modules/health/health.routes.js';
import { processingRouter } from './modules/processing/processing.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { subtitlesRouter } from './modules/subtitles/subtitles.routes.js';
import { handleRightsDocumentUpload, rightsRouter } from './modules/rights/rights.routes.js';
import { sourcesRouter } from './modules/sources/sources.routes.js';
import { handleUploadContent, uploadsRouter } from './modules/uploads/uploads.routes.js';
import { videosRouter } from './modules/videos/videos.routes.js';

export const app = express();

app.disable('x-powered-by');
// One reverse proxy in production (nginx, ALB); trust its forwarded client IP for rate limits.
app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
          ? incoming
          : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === `${API_PREFIX}/health`,
    },
  }),
);

app.use((req, res, next) => {
  res.locals.requestId = req.id;
  next();
});

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));

// Signed upload URL endpoint: streams raw body, so it must run before json parsing.
app.put(`${API_PREFIX}/uploads/sessions/:id/content`, (req, res, next) => {
  Promise.resolve(handleUploadContent(req, res)).catch(next);
});
// Rights document upload: raw body (PDF/images) before json parsing.
app.post(`${API_PREFIX}/rights/:id/documents`, requireAuth, (req, res, next) => {
  Promise.resolve(handleRightsDocumentUpload(req, res)).catch(next);
});

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json(liveness());
});

const apiRouter = Router();
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', createAuthRouter());
apiRouter.use('/clips', clipsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/processing', processingRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/rights', rightsRouter);
apiRouter.use('/sources', sourcesRouter);
apiRouter.use('/subtitles', subtitlesRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/videos', videosRouter);
app.use(API_PREFIX, apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
