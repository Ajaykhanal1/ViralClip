import type { SubscriptionStateResult, UserSubscription } from '@viralclip/shared';
import { getUsageSummary } from '../usage/usage.service.js';
import * as repo from './subscriptions.repository.js';

export async function state(userId: number): Promise<SubscriptionStateResult> {
  const [plans, subscription, usage] = await Promise.all([
    repo.listPlans(),
    repo.getSubscription(userId),
    getUsageSummary(userId),
  ]);
  return { plans, subscription, usage };
}

export function setEmailNotifications(userId: number, enabled: boolean): Promise<UserSubscription> {
  return repo.updateEmailNotifications(userId, enabled);
}
