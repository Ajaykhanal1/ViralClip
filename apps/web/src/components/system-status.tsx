'use client';

import { useEffect } from 'react';
import type { DependencyCheck } from '@viralclip/shared';
import { useHealthStore } from '@/store/health-store';

type Tone = 'up' | 'down' | 'pending';

const dotTone: Record<Tone, string> = {
  up: 'bg-emerald-700',
  down: 'bg-red-700',
  pending: 'bg-line',
};

function CheckRow({
  label,
  detail,
  tone,
  latencyMs,
}: {
  label: string;
  detail: string;
  tone: Tone;
  latencyMs?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line/70 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className={`size-2 shrink-0 rounded-full ${dotTone[tone]}`} aria-hidden="true" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-3 text-right">
        <span className={`text-sm ${tone === 'down' ? 'text-red-800' : 'text-ink-soft'}`}>
          {detail}
        </span>
        {latencyMs !== undefined && (
          <span className="font-mono text-[11px] tabular-nums text-ink-soft/70">{latencyMs}ms</span>
        )}
      </div>
    </div>
  );
}

function dependencyRow(check: DependencyCheck | undefined) {
  if (!check) return { tone: 'pending' as Tone, detail: 'no response yet' };
  return check.status === 'up'
    ? { tone: 'up' as Tone, detail: 'reachable', latencyMs: check.latencyMs }
    : { tone: 'down' as Tone, detail: 'unreachable' };
}

export function SystemStatus() {
  const { status, mysql, redis, error, checkedAt, check } = useHealthStore();

  useEffect(() => {
    void check();
  }, [check]);

  const apiTone: Tone =
    status === 'offline' ? 'down' : status === 'idle' || status === 'loading' ? 'pending' : 'up';
  const apiDetail =
    status === 'offline'
      ? 'unreachable'
      : status === 'idle' || status === 'loading'
        ? 'checking'
        : 'reachable';

  const mysqlRow = dependencyRow(mysql);
  const redisRow = dependencyRow(redis);
  const checkedLabel = checkedAt
    ? new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <section aria-labelledby="status-heading" className="border border-ink/20 bg-panel">
      <div className="flex items-center justify-between gap-4 border-b border-ink/20 px-5 py-4">
        <h2 id="status-heading" className="text-sm font-semibold">
          Service checks
        </h2>
        <button
          type="button"
          onClick={() => void check()}
          disabled={status === 'loading'}
          className="border border-ink/25 px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-50"
        >
          {status === 'loading' ? 'Checking' : 'Run checks'}
        </button>
      </div>

      <div className="px-5">
        <CheckRow label="API" detail={apiDetail} tone={apiTone} />
        <CheckRow
          label="MySQL"
          detail={mysqlRow.detail}
          tone={mysqlRow.tone}
          latencyMs={mysqlRow.latencyMs}
        />
        <CheckRow
          label="Redis"
          detail={redisRow.detail}
          tone={redisRow.tone}
          latencyMs={redisRow.latencyMs}
        />
      </div>

      <div className="border-t border-ink/20 px-5 py-4">
        <p className={`text-sm ${error ? 'text-red-800' : 'text-ink-soft'}`}>
          {error ??
            (status === 'ready'
              ? 'All systems reachable. Queue workers can accept jobs.'
              : 'Waiting for the readiness probe.')}
        </p>
        <p className="mt-2 font-mono text-[11px] text-ink-soft/80">
          GET /api/v1/health/ready
          {checkedLabel ? ` / last run ${checkedLabel}` : ''}
        </p>
      </div>
    </section>
  );
}
