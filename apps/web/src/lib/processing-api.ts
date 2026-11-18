import type { ApiResponse, ProcessingJob } from '@viralclip/shared';
import { API_URL } from './api';

class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !body || !body.success) {
    throw new ApiError(body && !body.success ? body.error.code : 'NETWORK_ERROR', body && !body.success ? body.error.message : 'Request failed.', response.status);
  }
  return body.data;
}

export function listJobs(params: { projectId?: number; sourceVideoId?: number } = {}): Promise<{ jobs: ProcessingJob[] }> {
  const q = new URLSearchParams();
  if (params.projectId) q.set('projectId', String(params.projectId));
  if (params.sourceVideoId) q.set('sourceVideoId', String(params.sourceVideoId));
  const s = q.toString();
  return request(`/processing/jobs${s ? `?${s}` : ''}`);
}

export function cancelJob(id: number): Promise<{ job: ProcessingJob }> {
  return request(`/processing/jobs/${id}/cancel`, { method: 'POST' });
}

export function openJobsStream(projectId?: number): EventSource {
  const url = new URL(`${API_URL}/api/v1/processing/stream`);
  if (projectId) url.searchParams.set('projectId', String(projectId));
  return new EventSource(url.toString(), { withCredentials: true });
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
