import type { CookieOptions, Request, Response } from 'express';
import { AUTH_COOKIE_NAMES } from '@viralclip/shared';
import { env } from '../../config/env.js';
import type { AuthTokens } from './auth.service.js';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_MS } from './auth.security.js';

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
};

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function setAuthCookies(res: Response, tokens: AuthTokens): void {
  res.cookie(AUTH_COOKIE_NAMES.access, tokens.accessToken, {
    ...baseOptions,
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(AUTH_COOKIE_NAMES.refresh, tokens.refreshToken, {
    ...baseOptions,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAMES.access, baseOptions);
  res.clearCookie(AUTH_COOKIE_NAMES.refresh, baseOptions);
}
