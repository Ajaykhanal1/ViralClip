import type { ApiResponse, ProcessingJob, SubtitleTrack, Transcript } from '@viralclip/shared';
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
  if (init.headers && (init.headers as any)['x-raw'] || path.includes('/export/')) {
    // not used; exports handled separately
  }
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !body || !body.success) {
    throw new ApiError(body && !body.success ? body.error.code : 'NETWORK_ERROR', body && !body.success ? body.error.message : 'Request failed.', response.status);
  }
  return body.data;
}

export function listForSource(sourceId: number): Promise<{ transcripts: Transcript[]; tracks: SubtitleTrack[] }> {
  return request(`/subtitles/source/${sourceId}`);
}

export function getTrack(trackId: number): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}`);
}

export function updateTrack(trackId: number, input: { name?: string; language?: string | null; style?: Record<string, unknown> | null }): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function replaceSegments(trackId: number, segments: Array<{ startMs: number; endMs: number; text: string; speaker?: string | null }>): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}/segments`, { method: 'PUT', body: JSON.stringify({ segments }) });
}

export function updateSegment(trackId: number, segmentIndex: number, input: { startMs?: number; endMs?: number; text?: string; speaker?: string | null }): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}/segments/${segmentIndex}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteSegment(trackId: number, segmentIndex: number): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}/segments/${segmentIndex}`, { method: 'DELETE' });
}

export function splitSegment(trackId: number, segmentIndex: number, input: { atMs?: number; textOffset?: number } = {}): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}/segments/${segmentIndex}/split`, { method: 'POST', body: JSON.stringify(input) });
}

export function mergeSegment(trackId: number, segmentIndex: number, withWhich: 'next' | 'previous' = 'next'): Promise<{ track: SubtitleTrack }> {
  return request(`/subtitles/tracks/${trackId}/segments/${segmentIndex}/merge`, { method: 'POST', body: JSON.stringify({ with: withWhich }) });
}

export function requestTranscription(input: { sourceVideoId: number; language?: string | null; translateToEnglish?: boolean; targetTrackId?: number | null; regenerate?: boolean }): Promise<{ job: ProcessingJob }> {
  return request('/subtitles/transcribe', { method: 'POST', body: JSON.stringify(input) });
}

export function exportUrl(trackId: number, format: 'srt' | 'vtt' | 'json'): string {
  return `${API_URL}/api/v1/subtitles/tracks/${trackId}/export/${format}`;
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
