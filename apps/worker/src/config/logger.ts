import pino from 'pino';
import { env } from './env.js';

const prettyTransport =
  env.NODE_ENV === 'development' && process.stdout.isTTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['*.password', '*.token'],
    censor: '[redacted]',
  },
  ...prettyTransport,
});
