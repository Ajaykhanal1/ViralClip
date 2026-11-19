'use client';

import { useEffect, useState } from 'react';
import type { UsageMetric, UsageSummary } from '@viralclip/shared';
import * as api from '@/lib/account-api';

const labels: Record<UsageMetric, string> = {
  uploadedVideos: 'Uploaded videos',
  uploadedStorageBytes: 'Storage used',
  processingMinutes: 'Processing minutes',
  generatedClips: 'Generated clips',
  renderedVideos: 'Rendered videos',
  aiUsage: 'AI analyses',
  youtubeUploads: 'YouTube uploads',
};

function format(value: number, metric: UsageMetric): string {
  if (metric === 'uploadedStorageBytes') {
    if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(2)} GB`;
    if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MB`;
    return `${value} B`;
  }
  return value.toLocaleString();
}

function UsageRow({ item }: { item: UsageSummary }) {
  const percent = item.percentage ?? 0;
  const danger = percent >= 100;
  const warning = !danger && percent >= 80;
  return (
    <article className="border border-ink/15 bg-panel/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-base">{labels[item.metric]}</h2>
        <span className={`font-mono text-xs ${danger ? 'text-red-700' : warning ? 'text-amber-700' : 'text-ink-soft'}`}>
          {format(item.used, item.metric)} / {item.limit === null ? 'Unlimited' : format(item.limit, item.metric)}
          {item.limit !== null ? ` · ${percent}%` : ''}
        </span>
      </div>
      {item.limit !== null ? (
        <div
          className="mt-3 h-2 w-full overflow-hidden bg-ink/10"
          role="progressbar"
          aria-label={`${labels[item.metric]} usage`}
          aria-valuenow={Math.min(100, percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={`h-full ${danger ? 'bg-red-600' : warning ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      ) : null}
      {danger ? <p className="mt-2 text-xs text-red-700">Limit reached. Upgrade your plan or free up capacity to continue.</p> : null}
      {warning ? <p className="mt-2 text-xs text-amber-700">Approaching your plan limit.</p> : null}
    </article>
  );
}

export function UsageView() {
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.usageState()
      .then((result) => {
        if (active) {
          setUsage(result.usage);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(api.message(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="border-b border-ink/15 pb-4">
        <h1 className="font-serif text-2xl">Usage</h1>
        <p className="mt-1 text-sm text-ink-soft">Current-cycle totals enforced by your plan. Limits are calculated on the server.</p>
      </header>

      {error ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!usage.length && !error ? <p className="text-sm text-ink-soft">Loading usage…</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {usage.map((item) => <UsageRow key={item.metric} item={item} />)}
      </div>
    </div>
  );
}
