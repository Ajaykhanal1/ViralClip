import type {
  ApiResponse,
  ClipEdit,
  EditVersion,
  EditorAsset,
  EditorStateResult,
  EditorTimeline,
  ProcessingJob,
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

export function load(draftId: number): Promise<EditorStateResult> {
  return request(`/editor/drafts/${draftId}`);
}

export function save(editId: number, timeline: EditorTimeline): Promise<{ edit: ClipEdit }> {
  return request(`/editor/edits/${editId}`, { method: 'PUT', body: JSON.stringify({ timeline }) });
}

export function createVersion(editId: number, label: string): Promise<{ version: EditVersion; edit: ClipEdit }> {
  return request(`/editor/edits/${editId}/versions`, { method: 'POST', body: JSON.stringify({ label }) });
}

export function restoreVersion(editId: number, versionId: number): Promise<{ edit: ClipEdit }> {
  return request(`/editor/edits/${editId}/versions/${versionId}/restore`, { method: 'POST' });
}

export function addAsset(
  editId: number,
  input: { kind: 'audio' | 'text' | 'image'; label: string; rightsId?: number | null; config?: Record<string, unknown> },
): Promise<{ asset: EditorAsset }> {
  return request(`/editor/edits/${editId}/assets`, { method: 'POST', body: JSON.stringify(input) });
}

export function removeAsset(editId: number, assetId: number): Promise<{ removed: boolean }> {
  return request(`/editor/edits/${editId}/assets/${assetId}`, { method: 'DELETE' });
}

export function requestExport(editId: number): Promise<{ job: ProcessingJob }> {
  return request(`/editor/edits/${editId}/export`, { method: 'POST' });
}

export function mediaUrl(draftId: number): string {
  return `${API_URL}/api/v1/shorts/${draftId}/media`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
