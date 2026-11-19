'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { RenderedVideo, YouTubeUpload, YouTubeUploadInput, YouTubeVisibility } from '@viralclip/shared';
import * as api from '@/lib/youtube-api';
import * as renderApi from '@/lib/render-api';

const activeStatuses = new Set(['queued', 'uploading']);
const visibilityOptions: Array<{ value: YouTubeVisibility; label: string }> = [
  { value: 'private', label: 'Private' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'public', label: 'Public' },
];

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function AccountCard({ account, busy, onDisconnect }: {
  account: NonNullable<Awaited<ReturnType<typeof api.state>>['account']>;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <section className="border border-ink/15 bg-panel/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {account.thumbnailUrl ? (
          <img src={account.thumbnailUrl} alt="" className="size-10 rounded-full border border-ink/15" />
        ) : null}
        <div>
          <p className="font-serif text-lg leading-tight">{account.channelTitle}</p>
          <p className="font-mono text-xs text-ink-soft">
            {account.channelHandle ?? account.channelId} · {account.status}
          </p>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy}
          className="ml-auto border border-ink/20 px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>
      <p className="mt-3 text-xs text-ink-soft">Only the YouTube upload and channel-read permissions were requested. Tokens stay encrypted on the server.</p>
    </section>
  );
}

function UploadProgress({ upload }: { upload: YouTubeUpload }) {
  const active = activeStatuses.has(upload.status);
  return (
    <section className="border border-ink/15 bg-panel/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-lg">Publishing “{upload.title}”</h2>
        <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">#{upload.id} · {upload.status}</span>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden bg-ink/10"
        role="progressbar"
        aria-valuenow={upload.progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${upload.progress}%` }} />
      </div>
      <p className="mt-2 font-mono text-xs text-ink-soft">
        {upload.progress}% · attempt {upload.attempt}/{upload.maxAttempts} · {upload.visibility}
      </p>
      {upload.errorMessage ? <p className="mt-2 text-xs text-red-700">{upload.errorMessage}</p> : null}
      {upload.videoUrl ? (
        <a href={upload.videoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent hover:underline">
          Watch on YouTube ↗
        </a>
      ) : null}
      {active ? <p className="mt-2 text-xs text-ink-soft">Uploading in the background. This page updates automatically.</p> : null}
    </section>
  );
}

function History({ uploads, busy, onRetry }: {
  uploads: YouTubeUpload[];
  busy: boolean;
  onRetry: (id: number) => void;
}) {
  return (
    <section>
      <h2 className="font-serif text-lg">Publishing history</h2>
      <div className="mt-3 space-y-2">
        {uploads.map((upload) => (
          <article key={upload.id} className="flex flex-wrap items-center gap-3 border border-ink/15 p-3 text-xs">
            <span className="font-mono font-semibold">#{upload.id}</span>
            <span className="min-w-20">{upload.status}</span>
            <span className="truncate font-medium">{upload.title}</span>
            <span className="text-ink-soft">{upload.progress}%</span>
            <span className="text-ink-soft">{when(upload.createdAt)}</span>
            <div className="ml-auto flex items-center gap-2">
              {upload.videoUrl ? (
                <a href={upload.videoUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">View</a>
              ) : null}
              {(upload.status === 'failed' || upload.status === 'cancelled') ? (
                <button
                  type="button"
                  onClick={() => onRetry(upload.id)}
                  disabled={busy}
                  className="border border-ink/20 px-2 py-1 disabled:opacity-50"
                >
                  Retry
                </button>
              ) : null}
            </div>
            {upload.errorMessage ? <p className="w-full text-red-700">{upload.errorMessage}</p> : null}
          </article>
        ))}
        {!uploads.length ? <p className="text-sm text-ink-soft">No uploads yet.</p> : null}
      </div>
    </section>
  );
}

function PublishForm({ videos, busy, onSubmit }: {
  videos: RenderedVideo[];
  busy: boolean;
  onSubmit: (input: YouTubeUploadInput) => Promise<void>;
}) {
  const [videoId, setVideoId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<YouTubeVisibility>('private');
  const [confirmed, setConfirmed] = useState(false);

  const selected = videos.find((video) => String(video.id) === videoId);
  const canSubmit = !!selected && title.trim().length > 0 && confirmed && !busy;

  async function submit() {
    if (!canSubmit || !selected) return;
    await onSubmit({
      renderedVideoId: selected.id,
      title: title.trim(),
      description,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      visibility,
      rightsConfirmed: true,
    });
  }

  return (
    <section className="border border-ink/15 bg-panel/40 p-4">
      <h2 className="font-serif text-lg">Publish a Short</h2>
      {!videos.length ? (
        <p className="mt-3 text-sm text-ink-soft">
          No finished renders yet. <Link href="/render" className="text-accent hover:underline">Render a Short</Link> first.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 md:grid-cols-[12rem_1fr]">
          <div>
            <label htmlFor="yt-video" className="block text-sm font-medium">Rendered Short</label>
            <select
              id="yt-video"
              value={videoId}
              onChange={(event) => {
                const id = event.target.value;
                setVideoId(id);
                const video = videos.find((item) => String(item.id) === id);
                if (video && !title) setTitle(`Short #${video.id}`);
              }}
              className="mt-1.5 w-full border border-ink/25 bg-paper px-3 py-2.5 text-sm"
            >
              <option value="">Select a render…</option>
              {videos.map((video) => (
                <option key={video.id} value={String(video.id)}>
                  #{video.id} · {(video.durationMs / 1000).toFixed(1)}s · v{video.configurationVersion}
                </option>
              ))}
            </select>
            {selected?.thumbnailKey ? (
              <img
                src={renderApi.thumbnailUrl(selected.id)}
                alt={`Rendered Short ${selected.id} preview`}
                className="mt-3 aspect-[9/16] w-full bg-black object-cover"
              />
            ) : null}
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="yt-title" className="block text-sm font-medium">Title</label>
              <input
                id="yt-title"
                value={title}
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1.5 w-full border border-ink/25 bg-paper px-3 py-2.5 text-sm"
                placeholder="A catchy title (max 100 characters)"
              />
            </div>
            <div>
              <label htmlFor="yt-description" className="block text-sm font-medium">Description</label>
              <textarea
                id="yt-description"
                value={description}
                maxLength={5000}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1.5 w-full border border-ink/25 bg-paper px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="yt-tags" className="block text-sm font-medium">Tags</label>
              <input
                id="yt-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                className="mt-1.5 w-full border border-ink/25 bg-paper px-3 py-2.5 text-sm"
                placeholder="comma, separated, tags"
              />
            </div>
            <div>
              <span className="block text-sm font-medium">Visibility</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {visibilityOptions.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="visibility"
                      value={option.value}
                      checked={visibility === option.value}
                      onChange={() => setVisibility(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="border border-ink/15 bg-paper p-3">
              <p className="text-xs font-semibold">Preview</p>
              <p className="mt-1 truncate text-sm">{title || 'Untitled Short'}</p>
              <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{description || 'No description'}</p>
              <p className="mt-1 font-mono text-[11px] text-ink-soft">
                {tags.split(',').map((tag) => tag.trim()).filter(Boolean).join(' · ') || 'No tags'} · {visibility}
              </p>
            </div>

            <label className="flex items-start gap-2 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                I confirm I own or have documented permission for all source, music, and media assets in this Short,
                including unexpired licenses, and that I have the rights required to publish it on YouTube.
              </span>
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Queuing upload…' : 'Confirm & upload to YouTube'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function YouTubeView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof api.state>> | null>(null);
  const [videos, setVideos] = useState<RenderedVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [state, renderState] = await Promise.all([api.state(), renderApi.state()]);
      setSnapshot(state);
      setVideos(renderState.videos.filter((video) => video.quality.ok));
      setError(null);
    } catch (cause) {
      setError(api.message(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('error');
    if (connected) setNotice('YouTube account connected.');
    if (oauthError) setError(`YouTube connection failed: ${oauthError.replaceAll('_', ' ')}`);
    if (connected || oauthError) router.replace('/youtube');
  }, [refresh, router, searchParams]);

  const hasActive = !!snapshot?.uploads.some((upload) => activeStatuses.has(upload.status));
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

  const active = snapshot?.uploads.find((upload) => activeStatuses.has(upload.status));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/15 pb-4">
        <div>
          <h1 className="font-serif text-2xl">YouTube publishing</h1>
          <p className="mt-1 text-sm text-ink-soft">Connect your channel and publish finished Shorts with a verifiable rights check.</p>
        </div>
        {snapshot?.account?.status === 'connected' ? null : (
          <a
            href={api.connectUrl()}
            className="ml-auto bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-accent"
          >
            Connect YouTube account
          </a>
        )}
      </header>

      {notice ? <p className="border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</p> : null}
      {error ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!snapshot && !error ? <p className="text-sm text-ink-soft">Loading YouTube status…</p> : null}

      {snapshot?.account?.status === 'connected' ? (
        <>
          <AccountCard account={snapshot.account} busy={busy} onDisconnect={() => void run(() => api.disconnect())} />
          <PublishForm videos={videos} busy={busy} onSubmit={(input) => run(() => api.createUpload(input))} />
          {active ? <UploadProgress upload={active} /> : null}
          <History uploads={snapshot.uploads} busy={busy} onRetry={(id) => void run(() => api.retry(id))} />
        </>
      ) : snapshot ? (
        <p className="text-sm text-ink-soft">Connect a YouTube account to publish your finished Shorts.</p>
      ) : null}
    </div>
  );
}
