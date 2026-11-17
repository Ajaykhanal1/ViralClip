import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError && 'body' in error;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (error instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = error.issues;
  } else if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (isJsonSyntaxError(error)) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  }

  const log = req.log ?? logger;
  if (statusCode >= 500) {
    log.error({ err: error }, 'request failed');
  } else {
    log.warn({ err: error, code }, 'request rejected');
  }

  res.status(statusCode).json({
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    requestId: res.locals.requestId as string | undefined,
  });
}
