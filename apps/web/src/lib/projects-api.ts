import type { ApiResponse, DashboardStats, Project, ProjectActivity, ProjectListResult } from '@viralclip/shared';
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

export function getDashboard(): Promise<DashboardStats> {
  return request('/dashboard');
}

export function listProjects(params: {
  search?: string;
  status?: string;
  sort?: 'newest' | 'oldest';
}): Promise<ProjectListResult> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.sort) q.set('sort', params.sort);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return request(`/projects${suffix}`);
}

export function createProject(input: { name: string; description?: string }): Promise<{ project: Project }> {
  return request('/projects', { method: 'POST', body: JSON.stringify(input) });
}

export function getProject(id: number): Promise<{ project: Project; activities: ProjectActivity[] }> {
  return request(`/projects/${id}`);
}

export function updateProject(
  id: number,
  input: { name?: string; description?: string | null; status?: string },
): Promise<{ project: Project }> {
  return request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteProject(id: number): Promise<{ deleted: boolean }> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
