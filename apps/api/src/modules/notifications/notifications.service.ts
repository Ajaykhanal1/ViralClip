import type { Notification, NotificationSeverity, NotificationStateResult, NotificationType } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { logger } from '../../config/logger.js';
import { sendNotificationEmail } from '../auth/auth.mailer.js';
import { getSubscription } from '../subscriptions/subscriptions.repository.js';
import * as repo from './notifications.repository.js';

export async function state(userId: number): Promise<NotificationStateResult> {
  const [notifications, unreadCount] = await Promise.all([repo.list(userId), repo.unreadCount(userId)]);
  return { notifications, unreadCount };
}

/** Used by API-side events; the worker writes notifications directly with the same shape. */
export async function notify(userId: number, input: {
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  data?: Record<string, unknown> | null;
}): Promise<Notification> {
  const notification = await repo.insert({ userId, ...input });
  try {
    const [subscription, email] = await Promise.all([getSubscription(userId), repo.findUserEmail(userId)]);
    if (subscription?.emailNotifications && email) {
      await sendNotificationEmail(email, notification.title, notification.message);
    }
  } catch (error) {
    // A delivery failure must never fail the business event that produced the notification.
    logger.warn({ error, userId, notificationId: notification.id }, 'notification email failed');
  }
  return notification;
}

export async function markRead(userId: number, id: number): Promise<NotificationStateResult> {
  if (!await repo.markRead(userId, id)) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  return state(userId);
}

export async function markAllRead(userId: number): Promise<NotificationStateResult> {
  await repo.markAllRead(userId);
  return state(userId);
}

export async function remove(userId: number, id: number): Promise<NotificationStateResult> {
  if (!await repo.remove(userId, id)) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  return state(userId);
}
