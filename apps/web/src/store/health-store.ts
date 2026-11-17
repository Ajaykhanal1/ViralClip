'use client';

import { create } from 'zustand';
import type { DependencyCheck } from '@viralclip/shared';
import { fetchReadiness } from '@/lib/api';

export type HealthStatus = 'idle' | 'loading' | 'ready' | 'degraded' | 'offline';

interface HealthState {
  status: HealthStatus;
  mysql?: DependencyCheck;
  redis?: DependencyCheck;
  error?: string;
  checkedAt?: string;
  check: () => Promise<void>;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  status: 'idle',
  check: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: undefined });

    try {
      const result = await fetchReadiness();
      if (!result.readiness) {
        set({ status: 'offline', error: result.error ?? 'API did not return a readiness payload' });
        return;
      }
      set({
        status: result.ok ? 'ready' : 'degraded',
        mysql: result.readiness.checks.mysql,
        redis: result.readiness.checks.redis,
        checkedAt: result.readiness.timestamp,
        error: result.ok ? undefined : result.error,
      });
    } catch {
      set({
        status: 'offline',
        mysql: undefined,
        redis: undefined,
        error: 'API unreachable. Is the backend running on port 4000?',
      });
    }
  },
}));
