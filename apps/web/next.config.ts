import path from 'node:path';
import type { NextConfig } from 'next';
import dotenv from 'dotenv';

// Single source of truth: the repo-root .env (npm workspace scripts run with cwd=apps/web).
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Trace from the monorepo root so @viralclip/shared is included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@viralclip/shared'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
