import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import nodemailer from 'nodemailer';
import type { NotificationSeverity, NotificationType, UsageMetric } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { pool } from '../db/mysql.js';

let transport: ReturnType<typeof nodemailer.createTransport> | null | undefined;

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'production') logger.error({ to }, 'SMTP is not configured; email was not sent');
    return;
  }
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });
  await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
}

/** One call per lifecycle event: store the notification, record usage idempotently, optionally email. */
export async function emitEvent(input: {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  data?: Record<string, unknown> | null;
  usage?: { metric: UsageMetric; amount: number; key: string };
}): Promise<void> {
  const severity = input.severity ?? 'info';
  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, type, title, message, severity, data_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.userId, input.type, input.title, input.message, severity, input.data ? JSON.stringify(input.data) : null],
    );

    if (input.usage) {
      await pool.execute(
        `INSERT IGNORE INTO usage_records (user_id, metric, amount, idempotency_key, metadata_json) VALUES (?, ?, ?, ?, ?)`,
        [input.userId, input.usage.metric, input.usage.amount, input.usage.key, input.data ? JSON.stringify(input.data) : null],
      );
    }

    const [rows] = await pool.execute<Array<RowDataPacket & { email: string; email_notifications: number }>>(
      `SELECT u.email, COALESCE(s.email_notifications, 0) AS email_notifications
         FROM users u LEFT JOIN user_subscriptions s ON s.user_id = u.id
        WHERE u.id = ? LIMIT 1`,
      [input.userId],
    );
    if (rows[0]?.email_notifications && rows[0].email) {
      await sendEmail(rows[0].email, input.title, input.message);
    }
    logger.debug({ notificationId: result.insertId, type: input.type }, 'notification recorded');
  } catch (error) {
    // Tracking must never fail the job that produced the event.
    logger.warn({ error, type: input.type, userId: input.userId }, 'event notification failed');
  }
}
