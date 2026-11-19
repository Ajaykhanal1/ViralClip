import type {
  ApiResponse,
  YouTubeStateResult,
  YouTubeUpload,
  YouTubeUploadInput,
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

export function state(): Promise<YouTubeStateResult> {
  return request('/youtube/state');
}

export function disconnect(): Promise<{ success: boolean; message: string }> {
  return request('/youtube/disconnect', { method: 'POST' });
}

export function createUpload(input: YouTubeUploadInput): Promise<YouTubeUpload> {
  return request('/youtube/uploads', { method: 'POST', body: JSON.stringify(input) });
}

export function retry(id: number): Promise<YouTubeUpload> {
  return request(`/youtube/uploads/${id}/retry`, { method: 'POST' });
}

/** Browser navigation: Google OAuth must run as a top-level redirect, not a fetch. */
export function connectUrl(): string {
  return `${API_URL}/api/v1/youtube/oauth/connect`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
