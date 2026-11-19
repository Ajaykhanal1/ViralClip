import type {
  ApiResponse,
  NotificationStateResult,
  SubscriptionStateResult,
  UsageSummary,
  UserSubscription,
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

export function notificationState(): Promise<NotificationStateResult> {
  return request('/notifications/state');
}

export function markNotificationRead(id: number): Promise<NotificationStateResult> {
  return request(`/notifications/${id}/read`, { method: 'POST' });
}

export function markAllNotificationsRead(): Promise<NotificationStateResult> {
  return request('/notifications/read-all', { method: 'POST' });
}

export function deleteNotification(id: number): Promise<NotificationStateResult> {
  return request(`/notifications/${id}`, { method: 'DELETE' });
}

export function usageState(): Promise<{ usage: UsageSummary[] }> {
  return request('/usage/state');
}

export function subscriptionState(): Promise<SubscriptionStateResult> {
  return request('/subscription/state');
}

export function setEmailNotifications(enabled: boolean): Promise<UserSubscription> {
  return request('/subscription/email-notifications', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
