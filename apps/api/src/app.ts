import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@viralclip/shared';
import { corsOrigins } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter, liveness } from './modules/health/health.routes.js';
import { videosRouter } from './modules/videos/videos.routes.js';

export const app = express();

app.disable('x-powered-by');

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
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json(liveness());
});

const apiRouter = Router();
apiRouter.use('/health', healthRouter);
apiRouter.use('/videos', videosRouter);
app.use(API_PREFIX, apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
