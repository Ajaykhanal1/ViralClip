import { Router } from 'express';
import type { DependencyCheck, HealthPayload, ReadinessPayload } from '@viralclip/shared';
import { pingDatabase } from '../../db/mysql.js';
import { pingRedis } from '../../queue/video.queue.js';
import { sendOk } from '../../http/respond.js';

const startedAt = Date.now();

export function liveness(): HealthPayload {
  return {
    status: 'ok',
    service: 'viralclip-api',
    version: '0.1.0',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
}

async function checkDependency(name: string, check: () => Promise<void>): Promise<DependencyCheck> {
  const started = performance.now();
  try {
    await check();
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      error: `${name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  sendOk(res, liveness());
});

healthRouter.get('/ready', async (_req, res) => {
  const [mysql, redis] = await Promise.all([
    checkDependency('mysql', pingDatabase),
    checkDependency('redis', pingRedis),
  ]);

  const ready = mysql.status === 'up' && redis.status === 'up';
  const payload: ReadinessPayload = {
    status: ready ? 'ok' : 'degraded',
    checks: { mysql, redis },
    timestamp: new Date().toISOString(),
  };

  if (ready) {
    sendOk(res, payload);
    return;
  }

  res.status(503).json({
    success: false,
    error: {
      code: 'NOT_READY',
      message: 'One or more dependencies are unavailable',
      details: payload,
    },
    requestId: res.locals.requestId as string | undefined,
  });
});
