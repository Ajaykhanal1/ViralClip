import type { ApiResponse, ReadinessPayload } from '@viralclip/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ReadinessResult {
  ok: boolean;
  readiness?: ReadinessPayload;
  error?: string;
}

export async function fetchReadiness(): Promise<ReadinessResult> {
  const response = await fetch(`${API_URL}/api/v1/health/ready`, { cache: 'no-store' });
  const body = (await response.json()) as ApiResponse<ReadinessPayload>;

  if (body.success) {
    return { ok: true, readiness: body.data };
  }

  return {
    ok: false,
    readiness: body.error.details as ReadinessPayload | undefined,
    error: body.error.message,
  };
}
