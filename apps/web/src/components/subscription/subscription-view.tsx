'use client';

import { useEffect, useState } from 'react';
import type { PlanLimits, SubscriptionStateResult, UsageMetric } from '@viralclip/shared';
import * as api from '@/lib/account-api';

function formatMetric(metric: UsageMetric, value: number | null): string {
  if (value === null) return 'Unlimited';
  if (metric === 'uploadedStorageBytes') {
    if (value >= 1_073_741_824) return `${value / 1_073_741_824} GB`;
    if (value >= 1_048_576) return `${Math.round(value / 1_048_576)} MB`;
    return `${value} B`;
  }
  return value.toLocaleString();
}

const metrics: UsageMetric[] = [
  'uploadedVideos',
  'uploadedStorageBytes',
  'processingMinutes',
  'generatedClips',
  'renderedVideos',
  'aiUsage',
  'youtubeUploads',
];

function PlanCard({ plan, current, limits }: {
  plan: SubscriptionStateResult['plans'][number];
  current: boolean;
  limits: PlanLimits;
}) {
  return (
    <article className={`flex flex-col border p-5 ${current ? 'border-accent bg-panel/60' : 'border-ink/15 bg-panel/40'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg">{plan.name}</h2>
        {current ? <span className="bg-accent px-2 py-0.5 text-[10px] font-bold text-white">CURRENT</span> : null}
      </div>
      <p className="mt-1 text-sm font-medium">
        {plan.priceMonthlyCents === 0 ? 'Free' : `$${(plan.priceMonthlyCents / 100).toFixed(2)} / month`}
      </p>
      <p className="mt-2 min-h-10 text-xs text-ink-soft">{plan.description ?? 'No description.'}</p>
      <ul className="mt-4 space-y-1.5 border-t border-ink/10 pt-4 text-xs">
        {metrics.map((metric) => (
          <li key={metric} className="flex justify-between gap-2">
            <span className="text-ink-soft">{metric.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</span>
            <span className="font-mono">{formatMetric(metric, plan.limits[metric])}</span>
          </li>
        ))}
      </ul>
      {current && limits ? <p className="mt-4 text-[11px] text-ink-soft">Usage and limits are calculated by the server.</p> : null}
    </article>
  );
}

export function SubscriptionView() {
  const [state, setState] = useState<SubscriptionStateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api.subscriptionState()
      .then((result) => {
        if (active) {
          setState(result);
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

  async function toggleEmail(enabled: boolean) {
    setBusy(true);
    try {
      const subscription = await api.setEmailNotifications(enabled);
      setState((current) => (current ? { ...current, subscription } : current));
      setError(null);
    } catch (cause) {
      setError(api.message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-ink/15 pb-4">
        <h1 className="font-serif text-2xl">Plans &amp; billing</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Plans are configured in the database. There is no checkout or paid activation in this release.
        </p>
      </header>

      {error ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!state && !error ? <p className="text-sm text-ink-soft">Loading plans…</p> : null}

      {state ? (
        <>
          <section className="border border-ink/15 bg-panel/40 p-4">
            <h2 className="font-serif text-lg">Your plan</h2>
            <p className="mt-1 text-sm">
              <span className="font-medium">{state.plans.find((plan) => plan.id === state.subscription.planId)?.name ?? 'Unknown'}</span>
              <span className="ml-2 font-mono text-xs text-ink-soft">{state.subscription.status}</span>
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.subscription.emailNotifications}
                disabled={busy}
                onChange={(event) => void toggleEmail(event.target.checked)}
              />
              Email me when something needs my attention
            </label>
          </section>

          <section>
            <h2 className="font-serif text-lg">Compare plans</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              {state.plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  current={plan.id === state.subscription.planId}
                  limits={plan.limits}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
