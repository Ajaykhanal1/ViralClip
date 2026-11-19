import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(2),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().max(65535).default(4001),
  AI_SERVICE_URL: z.url().default('http://localhost:8000'),
  RENDER_TIMEOUT_SECONDS: z.coerce.number().int().positive().max(7200).default(900),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('viralclip'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('viralclip'),
  DB_POOL_LIMIT: z.coerce.number().int().positive().default(5),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  PROCESSING_TEMP_DIR: z.string().default('./storage/tmp'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_TOKEN_ENCRYPTION_KEY: z.string().min(16).default('viralclip-dev-token-key-change-me'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
}

export const env = parsed.data;
