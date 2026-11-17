import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { DEV_AUTH_ACCESS_SECRET } from '@viralclip/shared';

// Works from both src/config and dist/config (four levels below the repo root).
dotenv.config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('viralclip'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('viralclip'),
  DB_POOL_LIMIT: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),

  AUTH_ACCESS_SECRET: z.string().min(32).default(DEV_AUTH_ACCESS_SECRET),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  AUTH_COOKIE_DOMAIN: z.string().default(''),
  APP_URL: z.url().default('http://localhost:3000'),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('ViralClip <no-reply@viralclip.local>'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  parsed.data.AUTH_ACCESS_SECRET === DEV_AUTH_ACCESS_SECRET
) {
  throw new Error('AUTH_ACCESS_SECRET must be set to a unique value in production');
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
