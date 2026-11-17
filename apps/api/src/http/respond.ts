import type { Response } from 'express';
import type { ApiResponse } from '@viralclip/shared';

export function sendOk<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiResponse<T> = {
    success: true,
    data,
    requestId: res.locals.requestId as string | undefined,
  };
  res.status(statusCode).json(body);
}
