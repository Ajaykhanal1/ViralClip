import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

const passThrough: RequestHandler = (_req, _res, next) => next();

function limiter(options: {
  windowMs: number;
  limit: number;
  message: string;
  skipSuccessfulRequests?: boolean;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: options.message },
        requestId: res.locals.requestId as string | undefined,
      });
    },
  });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * In-memory limits: correct for one API process. Behind multiple instances, move the
 * store to Redis. shortcut: single-process only, upgrade with a shared store.
 */
export function authRateLimiters(enabled: boolean) {
  if (!enabled) {
    return {
      register: passThrough,
      login: passThrough,
      refresh: passThrough,
      forgotPassword: passThrough,
      resetPassword: passThrough,
      verifyEmail: passThrough,
      resendVerification: passThrough,
    };
  }

  return {
    register: limiter({
      windowMs: HOUR,
      limit: 5,
      message: 'Too many registration attempts. Try again later.',
    }),
    login: limiter({
      windowMs: 15 * MINUTE,
      limit: 10,
      message: 'Too many sign-in attempts. Try again in a few minutes.',
      skipSuccessfulRequests: true,
    }),
    refresh: limiter({
      windowMs: 15 * MINUTE,
      limit: 120,
      message: 'Too many session refreshes. Try again later.',
    }),
    forgotPassword: limiter({
      windowMs: HOUR,
      limit: 5,
      message: 'Too many reset requests. Try again later.',
    }),
    resetPassword: limiter({
      windowMs: HOUR,
      limit: 10,
      message: 'Too many reset attempts. Try again later.',
    }),
    verifyEmail: limiter({
      windowMs: HOUR,
      limit: 20,
      message: 'Too many verification attempts. Try again later.',
    }),
    resendVerification: limiter({
      windowMs: HOUR,
      limit: 5,
      message: 'Too many verification emails. Try again later.',
    }),
  };
}
