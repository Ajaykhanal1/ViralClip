import type {
  ApiResponse,
  ContentRights,
  CopyrightClaim,
  CopyrightCheck,
  CopyrightEvent,
  PublishingRightsCheck,
  RightsDocument,
} from '@viralclip/shared';
import { API_URL } from './api';

class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
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
      body && !body.success ? body.error.message : 'Request failed.',
      response.status,
    );
  }
  return body.data;
}

export function listRights(params: { projectId?: number; sourceVideoId?: number }): Promise<{ rights: ContentRights[] }> {
  const q = new URLSearchParams();
  if (params.projectId) q.set('projectId', String(params.projectId));
  if (params.sourceVideoId) q.set('sourceVideoId', String(params.sourceVideoId));
  const s = q.toString();
  return request(`/rights${s ? `?${s}` : ''}`);
}
export function createRights(input: Record<string, unknown>): Promise<{ rights: ContentRights }> {
  return request('/rights', { method: 'POST', body: JSON.stringify(input) });
}
export function updateRights(id: number, input: Record<string, unknown>): Promise<{ rights: ContentRights }> {
  return request(`/rights/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export function addLicense(id: number, input: Record<string, unknown>): Promise<{ rights: ContentRights }> {
  return request(`/rights/${id}/licenses`, { method: 'POST', body: JSON.stringify(input) });
}
export function updateLicense(id: number, licenseId: number, input: Record<string, unknown>): Promise<{ rights: ContentRights }> {
  return request(`/rights/${id}/licenses/${licenseId}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export function removeDocument(id: number, docId: number): Promise<{ deleted: boolean }> {
  return request(`/rights/${id}/documents/${docId}`, { method: 'DELETE' });
}
export async function uploadDocument(id: number, file: File): Promise<{ document: RightsDocument }> {
  const response = await fetch(`${API_URL}/api/v1/rights/${id}/documents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': file.name },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<{ document: RightsDocument }> | null;
  if (!response.ok || !body || !body.success) {
    throw new ApiError(body && !body.success ? body.error.code : 'UPLOAD_FAILED', body && !body.success ? body.error.message : 'Upload failed.', response.status);
  }
  return body.data;
}
export function runCheck(params: { projectId: number; sourceVideoId?: number; context?: string }): Promise<PublishingRightsCheck> {
  const q = new URLSearchParams({ projectId: String(params.projectId), context: params.context || 'publish' });
  if (params.sourceVideoId) q.set('sourceVideoId', String(params.sourceVideoId));
  return request(`/rights/check?${q.toString()}`);
}
export function history(params: { projectId?: number; sourceVideoId?: number }): Promise<{ events: CopyrightEvent[]; checks: CopyrightCheck[] }> {
  const q = new URLSearchParams();
  if (params.projectId) q.set('projectId', String(params.projectId));
  if (params.sourceVideoId) q.set('sourceVideoId', String(params.sourceVideoId));
  const s = q.toString();
  return request(`/rights/history${s ? `?${s}` : ''}`);
}
export function listClaims(projectId?: number): Promise<{ claims: CopyrightClaim[] }> {
  const q = projectId ? `?projectId=${projectId}` : '';
  return request(`/rights/claims${q}`);
}
export function createClaim(input: Record<string, unknown>): Promise<{ claim: CopyrightClaim }> {
  return request('/rights/claims', { method: 'POST', body: JSON.stringify(input) });
}
export function updateClaim(id: number, input: Record<string, unknown>): Promise<{ claim: CopyrightClaim }> {
  return request(`/rights/claims/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
