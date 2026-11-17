import type { ApiResponse, AuthUser } from '@viralclip/shared';
import { API_URL } from './api';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !body || !body.success) {
    throw new ApiError(
      body && !body.success ? body.error.code : 'NETWORK_ERROR',
      body && !body.success ? body.error.message : 'The server did not respond. Try again.',
      response.status,
    );
  }

  return body.data;
}

export interface AuthPayload {
  user: AuthUser;
}

export interface MessagePayload {
  message: string;
}

export function register(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<AuthPayload> {
  return request('/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export function login(input: { email: string; password: string }): Promise<AuthPayload> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function logout(): Promise<MessagePayload> {
  return request('/auth/logout', { method: 'POST' });
}

export function me(): Promise<AuthPayload> {
  return request('/auth/me');
}

export function refresh(): Promise<AuthPayload> {
  return request('/auth/refresh', { method: 'POST' });
}

export function updateProfile(input: { displayName: string }): Promise<AuthPayload> {
  return request('/auth/me', { method: 'PATCH', body: JSON.stringify(input) });
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<MessagePayload> {
  return request('/auth/me/password', { method: 'PATCH', body: JSON.stringify(input) });
}

export function forgotPassword(input: { email: string }): Promise<MessagePayload> {
  return request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(input) });
}

export function resetPassword(input: { token: string; password: string }): Promise<MessagePayload> {
  return request('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) });
}

export function verifyEmail(input: { token: string }): Promise<AuthPayload> {
  return request('/auth/verify-email', { method: 'POST', body: JSON.stringify(input) });
}

export function resendVerification(): Promise<MessagePayload> {
  return request('/auth/resend-verification', { method: 'POST' });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
