import { USAGE_METRICS, type UsageMetric, type UsageSummary } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { getEffectivePlan } from '../subscriptions/subscriptions.repository.js';
import { limitExceeded, usagePercentage } from './usage.limits.js';
import * as repo from './usage.repository.js';

export async function getUsageSummary(userId: number): Promise<UsageSummary[]> {
  const [plan, used] = await Promise.all([getEffectivePlan(userId), repo.sumUsage(userId)]);
  return USAGE_METRICS.map((metric) => {
    const limit = plan.limits[metric];
    return {
      metric,
      used: used[metric],
      limit,
      percentage: usagePercentage(used[metric], limit),
    };
  });
}

/** Backend-enforced gate. Called before expensive work; null limit means unlimited. */
export async function assertWithinLimit(userId: number, metric: UsageMetric, increment = 1): Promise<void> {
  const [plan, used] = await Promise.all([getEffectivePlan(userId), repo.sumUsage(userId)]);
  const limit = plan.limits[metric];
  if (!limitExceeded(used[metric], increment, limit)) return;
  throw new AppError(403, 'LIMIT_EXCEEDED', `Your ${plan.name} plan limit for ${metric} has been reached`, {
    metric,
    limit,
    used: used[metric],
    requested: increment,
  });
}

export function recordUsage(
  userId: number,
  metric: UsageMetric,
  amount: number,
  idempotencyKey: string,
  metadata?: Record<string, unknown> | null,
): Promise<boolean> {
  return repo.recordUsage(userId, metric, amount, idempotencyKey, metadata);
}
