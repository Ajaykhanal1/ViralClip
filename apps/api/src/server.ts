import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/mysql.js';
import { closeQueue } from './queue/video.queue.js';

const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, nodeEnv: env.NODE_ENV },
    `API listening on http://localhost:${env.API_PORT}/api/v1`,
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeQueue();
    await closePool();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});
