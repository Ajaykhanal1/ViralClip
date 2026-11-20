import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  USAGE_METRICS,
  type PlanLimits,
  type SubscriptionPlan,
  type UsageMetric,
  type UserSubscription,
} from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

interface PlanRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price_monthly_cents: number;
  currency: string;
  limits_json: string | PlanLimits;
  is_active: number;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

interface SubscriptionRow extends RowDataPacket {
  id: number;
  user_id: number;
  plan_id: number;
  status: UserSubscription['status'];
  email_notifications: number;
  started_at: Date;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function parseLimits(value: PlanRow['limits_json']): PlanLimits {
  const parsed = (typeof value === 'string' ? JSON.parse(value) : value) as Partial<Record<UsageMetric, number | null>>;
  const limits = {} as PlanLimits;
  for (const metric of USAGE_METRICS) limits[metric] = parsed[metric] ?? null;
  return limits;
}

function toPlan(row: PlanRow): SubscriptionPlan {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    priceMonthlyCents: Number(row.price_monthly_cents),
    currency: row.currency,
    limits: parseLimits(row.limits_json),
    isActive: !!row.is_active,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSubscription(row: SubscriptionRow): UserSubscription {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    planId: Number(row.plan_id),
    status: row.status,
    emailNotifications: !!row.email_notifications,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listPlans(): Promise<SubscriptionPlan[]> {
  const [rows] = await pool.execute<PlanRow[]>(
    `SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order, id`,
  );
  return rows.map(toPlan);
}

/** Free plan is provisioned lazily on first access; one row per user. */
export async function getSubscription(userId: number): Promise<UserSubscription> {
  const [rows] = await pool.execute<SubscriptionRow[]>(
    `SELECT * FROM user_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  if (rows[0]) return toSubscription(rows[0]);

  const [freeRows] = await pool.execute<Array<RowDataPacket & { id: number }>>(
    `SELECT id FROM subscription_plans WHERE code = 'free' AND is_active = 1 LIMIT 1`,
  );
  if (!freeRows[0]) throw new Error('Free subscription plan is not configured');
  await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO user_subscriptions (user_id, plan_id, status) VALUES (?, ?, 'active')`,
    [userId, freeRows[0].id],
  );
  const [created] = await pool.execute<SubscriptionRow[]>(
    `SELECT * FROM user_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return toSubscription(created[0]);
}

export async function getEffectivePlan(userId: number): Promise<SubscriptionPlan> {
  const subscription = await getSubscription(userId);
  const [rows] = await pool.execute<PlanRow[]>(
    `SELECT * FROM subscription_plans WHERE id = ? LIMIT 1`,
    [subscription.planId],
  );
  if (!rows[0]) throw new Error('Subscribed plan is not configured');
  return toPlan(rows[0]);
}

export async function updateEmailNotifications(userId: number, enabled: boolean): Promise<UserSubscription> {
  const subscription = await getSubscription(userId);
  await pool.execute<ResultSetHeader>(
    `UPDATE user_subscriptions SET email_notifications = ? WHERE id = ?`,
    [enabled ? 1 : 0, subscription.id],
  );
  return { ...subscription, emailNotifications: enabled };
}
