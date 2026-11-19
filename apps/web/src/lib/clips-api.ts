import type { ApiResponse, ClipRecommendation, ClipsForSourceResult, ProcessingJob } from '@viralclip/shared';
import { API_URL } from './api';

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !body || !body.success) {
    throw new ApiError(
      body && !body.success ? body.error.code : 'NETWORK_ERROR',
      body && !body.success ? body.error.message : 'Request failed. Try again.',
      response.status,
    );
  }
  return body.data;
}

export function listForSource(sourceId: number): Promise<ClipsForSourceResult> {
  return request(`/clips/source/${sourceId}`);
}

export function requestAnalysis(input: {
  sourceVideoId: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  maxClips?: number;
}): Promise<{ job: ProcessingJob }> {
  return request('/clips/analyze', { method: 'POST', body: JSON.stringify(input) });
}

export function updateClip(
  id: number,
  input: {
    startMs?: number;
    endMs?: number;
    hookMs?: number;
    suggestedTitle?: string;
    description?: string;
    status?: 'suggested' | 'selected' | 'rejected';
  },
): Promise<{ clip: ClipRecommendation }> {
  return request(`/clips/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function mediaUrl(sourceId: number): string {
  return `${API_URL}/api/v1/clips/source/${sourceId}/media`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
