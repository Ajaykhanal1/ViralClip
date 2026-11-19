import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Notification, NotificationSeverity, NotificationType } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface NotificationRow extends RowDataPacket {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  data_json: string | null;
  read_at: Date | null;
  created_at: Date;
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    data: parseJson(row.data_json),
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserEmail(userId: number): Promise<string | null> {
  const [rows] = await pool.execute<Array<RowDataPacket & { email: string }>>(
    `SELECT email FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return rows[0]?.email ?? null;
}

export async function insert(input: {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  data?: Record<string, unknown> | null;
}): Promise<Notification> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO notifications (user_id, type, title, message, severity, data_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.userId, input.type, input.title, input.message, input.severity, input.data ? JSON.stringify(input.data) : null],
  );
  const [rows] = await pool.execute<NotificationRow[]>(
    `SELECT * FROM notifications WHERE id = ? LIMIT 1`,
    [result.insertId],
  );
  return toNotification(rows[0]);
}

export async function list(userId: number): Promise<Notification[]> {
  const [rows] = await pool.execute<NotificationRow[]>(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
    [userId],
  );
  return rows.map(toNotification);
}

export async function unreadCount(userId: number): Promise<number> {
  const [rows] = await pool.execute<Array<RowDataPacket & { c: number }>>(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [userId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function markRead(userId: number, id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    [id, userId],
  );
  return result.affectedRows > 0;
}

export async function markAllRead(userId: number): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL`,
    [userId],
  );
  return result.affectedRows;
}

export async function remove(userId: number, id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.affectedRows > 0;
}
