import type {
  ApiResponse,
  ProcessingJob,
  RenderJob,
  RenderStateResult,
} from '@viralclip/shared';
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
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !body || !body.success) {
    throw new ApiError(
      body && !body.success ? body.error.code : 'NETWORK_ERROR',
      body && !body.success ? body.error.message : 'Request failed. Try again.',
    );
  }
  return body.data;
}

export function state(editId?: number): Promise<RenderStateResult> {
  return request(`/render/state${editId ? `?editId=${editId}` : ''}`);
}

export function start(editId: number): Promise<{ job: RenderJob; processingJob: ProcessingJob }> {
  return request('/render', { method: 'POST', body: JSON.stringify({ editId }) });
}

export function cancel(jobId: number): Promise<{ job: RenderJob }> {
  return request(`/render/jobs/${jobId}/cancel`, { method: 'POST' });
}

export function retry(jobId: number): Promise<{ job: RenderJob; processingJob: ProcessingJob }> {
  return request(`/render/jobs/${jobId}/retry`, { method: 'POST' });
}

export function mediaUrl(videoId: number): string {
  return `${API_URL}/api/v1/render/videos/${videoId}/media`;
}

export function thumbnailUrl(videoId: number): string {
  return `${API_URL}/api/v1/render/videos/${videoId}/thumbnail`;
}

export function downloadUrl(videoId: number): string {
  return `${API_URL}/api/v1/render/videos/${videoId}/download`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
