import type { RequestHandler } from 'express';
import { corsOrigins } from '../config/env.js';
import { AppError } from '../http/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isAllowedOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).host;
    return corsOrigins.some((allowed) => {
      try {
        return new URL(allowed).host === host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

// Browsers send Origin on cookie-authenticated writes. Bearer clients may omit it.
export const csrfGuard: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;
  if (SAFE_METHODS.has(req.method) || !origin || isAllowedOrigin(origin)) {
    next();
    return;
  }
  next(new AppError(403, 'CSRF_REJECTED', 'Cross-origin request rejected'));
};
