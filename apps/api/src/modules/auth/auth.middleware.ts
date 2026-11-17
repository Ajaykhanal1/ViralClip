import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AUTH_COOKIE_NAMES, type UserRole } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { readCookie } from './auth.cookies.js';
import { verifyAccessToken } from './auth.security.js';

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req) ?? readCookie(req, AUTH_COOKIE_NAMES.access);
  const principal = token ? await verifyAccessToken(token) : null;

  if (!principal) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }

  req.user = principal;
  next();
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have access to this resource'));
      return;
    }
    next();
  };
}
