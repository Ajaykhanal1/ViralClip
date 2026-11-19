import type { ApiResponse, ProcessingJob, ShortDraft, ShortFramingMode, ShortsForSourceResult } from '@viralclip/shared';
import { API_URL } from './api';

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
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
    throw new ApiError(body && !body.success ? body.error.code : 'NETWORK_ERROR', body && !body.success ? body.error.message : 'Request failed. Try again.');
  }
  return body.data;
}

export function listForSource(sourceId: number): Promise<ShortsForSourceResult> {
  return request(`/shorts/source/${sourceId}`);
}

export function generate(input: {
  sourceVideoId: number;
  framing?: ShortFramingMode;
  cropX?: number;
  cropY?: number;
  durationSeconds?: number;
  introText?: string;
  outroText?: string;
  subtitleEnabled?: boolean;
}): Promise<{ drafts: ShortDraft[]; job: ProcessingJob }> {
  return request('/shorts/generate', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDraft(id: number, input: {
  cropX?: number;
  cropY?: number;
  framing?: ShortFramingMode;
  title?: string;
  description?: string;
  selected?: boolean;
  subtitleEnabled?: boolean;
  introText?: string;
  outroText?: string;
  volume?: number;
}): Promise<{ draft: ShortDraft; job: ProcessingJob | null }> {
  return request(`/shorts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function mediaUrl(id: number): string {
  return `${API_URL}/api/v1/shorts/${id}/media`;
}

export function thumbnailUrl(id: number): string {
  return `${API_URL}/api/v1/shorts/${id}/thumbnail`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
