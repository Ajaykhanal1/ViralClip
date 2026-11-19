'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { RenderJob, RenderStateResult, RenderedVideo } from '@viralclip/shared';
import * as api from '@/lib/render-api';

const activeStatuses = new Set(['queued', 'processing']);

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function Progress({ job, onCancel, busy }: { job: RenderJob; onCancel: () => void; busy: boolean }) {
  const active = activeStatuses.has(job.status);
  return (
    <section className="border border-ink/15 bg-panel/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg">Rendering progress</h2>
        <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">Job #{job.id} · {job.status}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden bg-ink/10" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
      </div>
      <p className="mt-2 font-mono text-xs text-ink-soft">
        {job.progress}% · attempt {job.attempt}/{job.maxAttempts} · configuration v{job.configurationVersion}
      </p>
      {job.errorMessage ? <p className="mt-2 text-xs text-red-700">{job.errorMessage}</p> : null}
      {active ? (
        <button type="button" onClick={onCancel} disabled={busy} className="mt-3 border border-ink/20 px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50">
          Cancel render
        </button>
      ) : null}
    </section>
  );
}

function History({ jobs, busy, onCancel, onRetry }: {
  jobs: RenderJob[];
  busy: boolean;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  return (
    <section>
      <h2 className="font-serif text-lg">Render history</h2>
      <div className="mt-3 space-y-2">
        {jobs.map((job) => (
          <article key={job.id} className="flex flex-wrap items-center gap-3 border border-ink/15 p-3 text-xs">
            <span className="font-mono font-semibold">#{job.id}</span>
            <span className="min-w-20">{job.status}</span>
            <span className="text-ink-soft">{job.progress}%</span>
            <span className="text-ink-soft">config v{job.configurationVersion}</span>
            <span className="text-ink-soft">{when(job.createdAt)}</span>
            <div className="ml-auto flex gap-2">
              {activeStatuses.has(job.status) ? (
                <button type="button" onClick={() => onCancel(job.id)} disabled={busy} className="border border-ink/20 px-2 py-1 disabled:opacity-50">Cancel</button>
              ) : (
                <button type="button" onClick={() => onRetry(job.id)} disabled={busy} className="border border-ink/20 px-2 py-1 disabled:opacity-50">Render again</button>
              )}
            </div>
          </article>
        ))}
        {!jobs.length ? <p className="text-sm text-ink-soft">No renders yet.</p> : null}
      </div>
    </section>
  );
}

function Output({ video }: { video: RenderedVideo }) {
  return (
    <article className="border border-ink/15 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono font-semibold">#{video.id} · v{video.configurationVersion}</span>
        <span className={video.quality.ok ? 'text-green-700' : 'text-red-700'}>
          {video.quality.ok ? 'Quality validated' : `Quality: ${video.quality.reasons.join('; ')}`}
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-ink-soft">
        {video.width}×{video.height} · {(video.durationMs / 1000).toFixed(1)}s · {video.videoCodec}/{video.audioCodec} · {(video.fileSize / 1_000_000).toFixed(1)} MB
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        <video
          controls
          playsInline
          preload="metadata"
          poster={video.thumbnailKey ? api.thumbnailUrl(video.id) : undefined}
          src={api.mediaUrl(video.id)}
          className="aspect-[9/16] w-40 bg-black"
          aria-label={`Rendered Short ${video.id}`}
        />
        <div className="flex flex-col justify-end gap-2">
          <a href={api.downloadUrl(video.id)} download className="bg-ink px-3 py-1.5 text-center text-xs font-semibold text-paper hover:bg-accent">
            Download MP4
          </a>
          <Link href={`/shorts?sourceId=${video.sourceVideoId}`} className="text-xs text-ink-soft hover:text-accent">Back to Shorts</Link>
        </div>
      </div>
    </article>
  );
}

export function RenderView() {
  const editId = Number(useSearchParams().get('editId')) || undefined;
  const [snapshot, setSnapshot] = useState<RenderStateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.state(editId));
      setError(null);
    } catch (cause) {
      setError(api.message(cause));
    }
  }, [editId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActive = !!snapshot?.jobs.some((job) => activeStatuses.has(job.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [hasActive, refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(api.message(cause));
    } finally {
      setBusy(false);
    }
  }

  const active = snapshot?.jobs.find((job) => activeStatuses.has(job.status));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/15 pb-4">
        <div>
          <h1 className="font-serif text-2xl">Rendering &amp; export</h1>
          <p className="mt-1 text-sm text-ink-soft">Validate, render, and download your finished YouTube Shorts.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/editor" className="border border-ink/20 px-3 py-1.5 text-xs">Open editor</Link>
          {editId ? (
            <button
              type="button"
              disabled={busy || hasActive}
              onClick={() => void run(() => api.start(editId))}
              className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
            >
              {hasActive ? 'Render in progress' : 'Render final MP4'}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-ink-soft">Loading renders…</p> : null}

      {snapshot && active ? <Progress job={active} busy={busy} onCancel={() => void run(() => api.cancel(active.id))} /> : null}
      {snapshot && !active && snapshot.jobs[0] ? <Progress job={snapshot.jobs[0]} busy={busy} onCancel={() => undefined} /> : null}
      {snapshot && !snapshot.jobs.length ? (
        <p className="text-sm text-ink-soft">Open the editor, save your timeline, then start a render from here.</p>
      ) : null}

      {snapshot ? <History
        jobs={snapshot.jobs}
        busy={busy}
        onCancel={(id) => void run(() => api.cancel(id))}
        onRetry={(id) => void run(() => api.retry(id))}
      /> : null}

      {snapshot && snapshot.videos.length ? (
        <section>
          <h2 className="font-serif text-lg">Finished videos</h2>
          <div className="mt-3 space-y-4">{snapshot.videos.map((video) => <Output key={video.id} video={video} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
