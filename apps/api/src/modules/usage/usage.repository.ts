import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { USAGE_METRICS, type UsageMetric } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

/** Returns true when this event was recorded; false when the idempotency key already existed. */
export async function recordUsage(
  userId: number,
  metric: UsageMetric,
  amount: number,
  idempotencyKey: string,
  metadata?: Record<string, unknown> | null,
): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO usage_records (user_id, metric, amount, idempotency_key, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, metric, amount, idempotencyKey, metadata ? JSON.stringify(metadata) : null],
  );
  return result.affectedRows > 0;
}

export async function sumUsage(userId: number): Promise<Record<UsageMetric, number>> {
  const [rows] = await pool.execute<Array<RowDataPacket & { metric: UsageMetric; total: number }>>(
    `SELECT metric, COALESCE(SUM(amount), 0) AS total FROM usage_records WHERE user_id = ? GROUP BY metric`,
    [userId],
  );
  const totals = {} as Record<UsageMetric, number>;
  for (const metric of USAGE_METRICS) totals[metric] = 0;
  for (const row of rows) totals[row.metric] = Number(row.total);
  return totals;
}
