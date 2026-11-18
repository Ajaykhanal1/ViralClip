import type { ApiResponse, SourceVideo, UploadSession } from '@viralclip/shared';
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

export function listSources(projectId?: number): Promise<{ sources: SourceVideo[] }> {
  const q = projectId ? `?projectId=${projectId}` : '';
  return request(`/sources${q}`);
}

export function importYouTube(input: {
  projectId: number;
  url: string;
}): Promise<{ source: SourceVideo; requiresAuthorizedSource: boolean; message: string }> {
  return request('/sources/youtube', { method: 'POST', body: JSON.stringify(input) });
}

export function createUploadSession(input: {
  projectId: number;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceVideoId?: number;
}): Promise<{ session: UploadSession; uploadToken: string; uploadPath: string; maxUploadBytes: number }> {
  return request('/uploads/sessions', { method: 'POST', body: JSON.stringify(input) });
}

export function getUploadSession(id: number): Promise<{ session: UploadSession }> {
  return request(`/uploads/sessions/${id}`);
}

export function cancelUploadSession(id: number): Promise<{ session: UploadSession }> {
  return request(`/uploads/sessions/${id}/cancel`, { method: 'POST' });
}

export function uploadWithProgress(opts: {
  uploadPath: string;
  token: string;
  file: File;
  sourceVideoId?: number;
  onProgress: (percent: number) => void;
}): { promise: Promise<{ source?: SourceVideo }>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ source?: SourceVideo }>((resolve, reject) => {
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', 'Upload failed. Check your connection.', 0));
    xhr.onabort = () => reject(new ApiError('UPLOAD_ABORTED', 'Upload canceled.', 0));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as ApiResponse<{ source?: SourceVideo }>;
        if (xhr.status >= 200 && xhr.status < 300 && body.success) {
          opts.onProgress(100);
          resolve(body.data);
        } else if (!body.success) {
          reject(new ApiError(body.error.code, body.error.message, xhr.status));
        } else {
          reject(new ApiError('UPLOAD_FAILED', 'Upload failed.', xhr.status));
        }
      } catch {
        reject(new ApiError('UPLOAD_FAILED', 'Upload failed.', xhr.status));
      }
    };
    const url = new URL(`${API_URL}${opts.uploadPath}`);
    url.searchParams.set('token', opts.token);
    if (opts.sourceVideoId) url.searchParams.set('sourceVideoId', String(opts.sourceVideoId));
    xhr.open('PUT', url.toString());
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', opts.file.type || 'application/octet-stream');
    xhr.send(opts.file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
