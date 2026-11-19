'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Project, ShortDraft, ShortFramingMode, SourceVideo } from '@viralclip/shared';
import * as importsApi from '@/lib/imports-api';
import * as projectsApi from '@/lib/projects-api';
import * as shortsApi from '@/lib/shorts-api';

function time(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  return `${String(Math.floor(total / 60000)).padStart(2, '0')}:${String(Math.floor((total % 60000) / 1000)).padStart(2, '0')}`;
}

function DraftPreview({ draft, onUpdate }: { draft: ShortDraft; onUpdate: (id: number, patch: Parameters<typeof shortsApi.updateDraft>[1]) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(draft.durationMs / 1000);
  const [cropX, setCropX] = useState(draft.cropX);
  const [cropY, setCropY] = useState(draft.cropY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCropX(draft.cropX);
    setCropY(draft.cropY);
    setCurrent(0);
    setPlaying(false);
  }, [draft.id, draft.cropX, draft.cropY]);

  async function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      await element.play();
      setPlaying(true);
    } else {
      element.pause();
      setPlaying(false);
    }
  }

  async function saveCrop() {
    setBusy(true);
    setError(null);
    try {
      await onUpdate(draft.id, { cropX, cropY });
    } catch (e) {
      setError(shortsApi.message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(280px,2fr)]">
      <div className="mx-auto w-full max-w-[320px] space-y-2">
        <video
          ref={video}
          controls
          playsInline
          crossOrigin="use-credentials"
          poster={shortsApi.thumbnailUrl(draft.id)}
          src={shortsApi.mediaUrl(draft.id)}
          className="aspect-[9/16] w-full bg-ink object-contain"
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || draft.durationMs / 1000)}
          onEnded={() => setPlaying(false)}
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void togglePlay()} className="border border-ink/20 px-3 py-1 text-xs">
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={duration > 0 ? Math.round((current / duration) * 1000) : 0}
            onChange={(event) => {
              const next = (Number(event.target.value) / 1000) * duration;
              if (video.current) video.current.currentTime = next;
              setCurrent(next);
            }}
            className="h-1 flex-1 accent-[var(--color-accent)]"
            aria-label="Timeline preview"
          />
          <span className="font-mono text-[11px] text-ink-soft">{time(current * 1000)}/{time(duration * 1000)}</span>
        </div>
        <p className="text-[11px] text-ink-soft">
          9:16 · {draft.width}×{draft.height} · MP4/H.264/AAC · v{draft.version}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">Draft v{draft.version}</p>
          <h2 className="mt-1 text-xl font-semibold">{draft.title}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Source window {time(draft.startMs)} → {time(draft.endMs)} · hook {time(draft.hookMs)}
          </p>
        </div>
        <p className="text-sm">{draft.description}</p>

        <div className="grid gap-3 border border-ink/15 p-3 sm:grid-cols-2">
          <label className="text-[11px] text-ink-soft">
            Crop X
            <input type="range" min={-1} max={1} step={0.05} value={cropX} onChange={(e) => setCropX(Number(e.target.value))} className="mt-1 w-full" />
          </label>
          <label className="text-[11px] text-ink-soft">
            Crop Y
            <input type="range" min={-1} max={1} step={0.05} value={cropY} onChange={(e) => setCropY(Number(e.target.value))} className="mt-1 w-full" />
          </label>
          <p className="text-[11px] text-ink-soft sm:col-span-2">
            Framing: {draft.framing} · subtitles {draft.subtitleConfig?.enabled ? 'on' : 'off'} · volume {draft.audioConfig.volume}
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" disabled={busy} onClick={() => void saveCrop()} className="border border-ink/20 px-3 py-1.5 text-xs disabled:opacity-50">
              Apply crop position
            </button>
            <button type="button" disabled={busy || draft.selected} onClick={() => void onUpdate(draft.id, { selected: true })} className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-50">
              {draft.selected ? 'Selected' : 'Select draft'}
            </button>
            <Link href={`/editor?draft=${draft.id}`} className="border border-accent px-3 py-1.5 text-xs text-accent">
              Open in advanced editor
            </Link>
          </div>
          {error ? <p className="text-xs text-red-700 sm:col-span-2">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function ShortsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [sources, setSources] = useState<SourceVideo[]>([]);
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [drafts, setDrafts] = useState<ShortDraft[]>([]);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [framing, setFraming] = useState<ShortFramingMode>('smart');
  const [duration, setDuration] = useState('60');
  const [intro, setIntro] = useState('');
  const [outro, setOutro] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDrafts(id: number) {
    const result = await shortsApi.listForSource(id);
    setDrafts(result.drafts);
    setJobStatus(result.latestJob?.status ?? '');
    setSelectedId((current) => (result.drafts.some((draft) => draft.id === current) ? current : result.drafts[0]?.id ?? null));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await projectsApi.listProjects({ sort: 'newest' });
        setProjects(result.projects);
        setProjectId(result.projects[0]?.id ?? '');
      } catch (e) {
        setError(projectsApi.message(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof projectId !== 'number') return;
    void importsApi.listSources(projectId).then((result) => {
      setSources(result.sources);
      setSourceId(result.sources[0]?.id ?? '');
    }).catch((e: unknown) => setError(importsApi.message(e)));
  }, [projectId]);

  useEffect(() => {
    if (typeof sourceId !== 'number') {
      setDrafts([]);
      return;
    }
    void loadDrafts(sourceId).catch((e: unknown) => setError(shortsApi.message(e)));
  }, [sourceId]);

  useEffect(() => {
    if (typeof sourceId !== 'number' || (jobStatus !== 'queued' && jobStatus !== 'processing')) return;
    const timer = setInterval(() => {
      void loadDrafts(sourceId).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [jobStatus, sourceId]);

  async function generate() {
    if (typeof sourceId !== 'number') return;
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds < 5 || seconds > 180) {
      setError('Duration must be between 5 and 180 seconds (Shorts eligibility).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shortsApi.generate({
        sourceVideoId: sourceId,
        framing,
        durationSeconds: seconds,
        introText: intro || undefined,
        outroText: outro || undefined,
      });
      await loadDrafts(sourceId);
    } catch (e) {
      setError(shortsApi.message(e));
    } finally {
      setBusy(false);
    }
  }

  async function updateDraft(id: number, patch: Parameters<typeof shortsApi.updateDraft>[1]) {
    await shortsApi.updateDraft(id, patch);
    if (typeof sourceId === 'number') await loadDrafts(sourceId);
  }

  const draft = drafts.find((item) => item.id === selectedId) ?? null;
  const sourceReady = !!sources.find((item) => item.id === sourceId)?.assets.length;

  if (loading) return <p className="text-sm text-ink-soft">Loading Shorts…</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">YouTube Shorts</p>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">Shorts drafts</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-soft">
          Turn selected AI clips into editable 9:16 drafts. Source media is never modified; every version is rendered
          on the server with FFmpeg. Only authorized source media is used — no stock assets or added music.
        </p>
      </div>

      <div className="grid gap-3 border border-ink/15 bg-panel/50 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-xs text-ink-soft">
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Source
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : '')} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm">
            {sources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Framing
          <select value={framing} onChange={(e) => setFraming(e.target.value as ShortFramingMode)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm">
            <option value="smart">Smart crop</option>
            <option value="center">Center crop</option>
            <option value="face">Face-aware (best effort)</option>
            <option value="speaker">Speaker-aware</option>
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Seconds
          <input value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm" />
        </label>
        <label className="text-xs text-ink-soft">
          Intro text
          <input value={intro} onChange={(e) => setIntro(e.target.value)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm" />
        </label>
        <label className="text-xs text-ink-soft">
          Outro text
          <input value={outro} onChange={(e) => setOutro(e.target.value)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm" />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-6">
          <button type="button" disabled={!sourceReady || busy} onClick={() => void generate()} className="bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-50">
            Generate drafts from selected clips
          </button>
          <span className="text-xs text-ink-soft">{jobStatus ? `Render job: ${jobStatus}` : 'No render job yet'}</span>
        </div>
      </div>

      {!sourceReady ? <p className="text-xs text-ink-soft">Choose an ingested source before generating Shorts.</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-1 border border-ink/15 p-2">
          <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-soft">Drafts ({drafts.length})</p>
          {drafts.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`flex w-full items-center gap-2 px-2 py-2 text-left text-xs ${item.id === selectedId ? 'bg-ink text-paper' : 'hover:bg-ink/5'}`}
            >
              <span className="font-mono text-[10px] opacity-70">v{item.version}</span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="text-[10px] uppercase">{item.status}</span>
            </button>
          ))}
          {drafts.length === 0 ? <p className="px-2 py-3 text-xs text-ink-soft">Select clips on the Clips screen, then generate drafts here.</p> : null}
        </aside>

        <section className="border border-ink/15 bg-paper p-4">
          {draft ? (
            <>
              <DraftPreview draft={draft} onUpdate={updateDraft} />
              {draft.errorMessage ? <p className="mt-3 text-xs text-red-700">{draft.errorMessage}</p> : null}
            </>
          ) : (
            <p className="text-sm text-ink-soft">No draft selected.</p>
          )}
        </section>
      </div>
    </div>
  );
}
