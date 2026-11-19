'use client';

import { useEffect, useState } from 'react';
import type { ClipRecommendation, ClipsForSourceResult, Project, SourceVideo } from '@viralclip/shared';
import * as clipsApi from '@/lib/clips-api';
import * as importsApi from '@/lib/imports-api';
import * as projectsApi from '@/lib/projects-api';

type ClipPatch = Parameters<typeof clipsApi.updateClip>[1];

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function milliseconds(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1000)) : 0;
}

function ClipCard({
  clip,
  mediaUrl,
  onUpdate,
}: {
  clip: ClipRecommendation;
  mediaUrl: string;
  onUpdate: (id: number, input: ClipPatch) => Promise<void>;
}) {
  const [start, setStart] = useState(seconds(clip.startMs));
  const [end, setEnd] = useState(seconds(clip.endMs));
  const [title, setTitle] = useState(clip.suggestedTitle);
  const [description, setDescription] = useState(clip.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStart(seconds(clip.startMs));
    setEnd(seconds(clip.endMs));
    setTitle(clip.suggestedTitle);
    setDescription(clip.description);
  }, [clip]);

  async function patch(input: ClipPatch) {
    setBusy(true);
    setError(null);
    try {
      await onUpdate(clip.id, input);
    } catch (e) {
      setError(clipsApi.message(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjustments() {
    const startMs = milliseconds(start);
    const endMs = milliseconds(end);
    if (endMs <= startMs) {
      setError('End time must be after start time.');
      return;
    }
    const shift = startMs - clip.startMs;
    const hookMs = Math.min(endMs, Math.max(startMs, clip.hookMs + shift));
    await patch({ startMs, endMs, hookMs, suggestedTitle: title, description });
  }

  return (
    <article className="border border-ink/15 bg-paper">
      <div className="grid gap-4 md:grid-cols-[minmax(260px,2fr)_minmax(260px,3fr)]">
        <div className="space-y-2 p-4">
          <video
            controls
            preload="metadata"
            crossOrigin="use-credentials"
            className="w-full bg-ink"
            src={`${mediaUrl}#t=${seconds(clip.startMs)},${seconds(clip.endMs)}`}
          />
          <p className="text-[11px] text-ink-soft">
            Preview window {clip.startTimestamp} → {clip.endTimestamp} · hook at {clip.hookTimestamp}
          </p>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">{clip.candidateId}</p>
              <h2 className="mt-1 text-lg font-semibold">{clip.suggestedTitle}</h2>
            </div>
            <span className="border border-ink/20 px-2 py-1 text-[11px] uppercase">{clip.status}</span>
          </div>

          <p className="text-xs text-ink-soft">
            Heuristic engagement signal: <strong className="text-ink">{clip.engagementScore.toFixed(1)}/100</strong>
            <span className="block">Review signal only — not a prediction of guaranteed virality.</span>
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
            {Object.entries(clip.signals).map(([name, value]) => (
              <span key={name}>
                {name.replace(/([A-Z])/g, ' $1').toLowerCase()}: {Number(value).toFixed(0)}
              </span>
            ))}
          </div>

          <p className="text-sm">{clip.explanation}</p>
          <p className="text-xs text-ink-soft">
            Suggested subtitles: {clip.subtitleConfig.position}, {clip.subtitleConfig.fontSize}px,
            {' '}keywords {clip.subtitleConfig.highlightKeywords.join(', ') || 'none'}
          </p>

          <div className="border-t border-ink/10 pt-3">
            <p className="text-xs font-medium">Transcript</p>
            <p className="mt-1 max-h-28 overflow-y-auto text-xs text-ink-soft">{clip.transcript}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] text-ink-soft">
              Start (s)
              <input value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 w-full border border-ink/20 bg-paper px-2 py-1 text-xs" />
            </label>
            <label className="text-[11px] text-ink-soft">
              End (s)
              <input value={end} onChange={(e) => setEnd(e.target.value)} className="mt-0.5 w-full border border-ink/20 bg-paper px-2 py-1 text-xs" />
            </label>
            <label className="text-[11px] text-ink-soft sm:col-span-2">
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 w-full border border-ink/20 bg-paper px-2 py-1 text-xs" />
            </label>
            <label className="text-[11px] text-ink-soft sm:col-span-2">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-0.5 w-full border border-ink/20 bg-paper px-2 py-1 text-xs" />
            </label>
          </div>

          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void saveAdjustments()} className="border border-ink/20 px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50">
              Save adjustments
            </button>
            <button type="button" disabled={busy || clip.status === 'selected'} onClick={() => void patch({ status: 'selected' })} className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-50">
              Select
            </button>
            <button type="button" disabled={busy || clip.status === 'rejected'} onClick={() => void patch({ status: 'rejected' })} className="border border-red-700/30 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50">
              Reject
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ClipsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [sources, setSources] = useState<SourceVideo[]>([]);
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [result, setResult] = useState<ClipsForSourceResult | null>(null);
  const [minSeconds, setMinSeconds] = useState('15');
  const [maxSeconds, setMaxSeconds] = useState('30');
  const [maxClips, setMaxClips] = useState('6');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProjects() {
    const res = await projectsApi.listProjects({ sort: 'newest' });
    setProjects(res.projects);
    setProjectId((current) => current || res.projects[0]?.id || '');
  }

  async function loadSources(id: number) {
    const res = await importsApi.listSources(id);
    setSources(res.sources);
    setSourceId((current) => (res.sources.some((source) => source.id === current) ? current : res.sources[0]?.id || ''));
  }

  async function loadClips(id: number) {
    setResult(await clipsApi.listForSource(id));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadProjects();
      } catch (e) {
        setError(projectsApi.message(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof projectId !== 'number') return;
    void loadSources(projectId).catch((e) => setError(importsApi.message(e)));
  }, [projectId]);

  useEffect(() => {
    if (typeof sourceId !== 'number') {
      setResult(null);
      return;
    }
    void loadClips(sourceId).catch((e) => setError(clipsApi.message(e)));
  }, [sourceId]);

  useEffect(() => {
    const status = result?.latestJob?.status;
    if (typeof sourceId !== 'number' || (status !== 'queued' && status !== 'processing')) return;
    const timer = setInterval(() => {
      void loadClips(sourceId).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [result?.latestJob?.status, sourceId]);

  async function analyze() {
    if (typeof sourceId !== 'number') return;
    const min = Number(minSeconds);
    const max = Number(maxSeconds);
    const count = Number(maxClips);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
      setError('Enter a valid clip duration range.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await clipsApi.requestAnalysis({
        sourceVideoId: sourceId,
        minDurationSeconds: min,
        maxDurationSeconds: max,
        maxClips: Number.isFinite(count) ? count : undefined,
      });
      await loadClips(sourceId);
    } catch (e) {
      setError(clipsApi.message(e));
    } finally {
      setBusy(false);
    }
  }

  async function updateClip(id: number, input: ClipPatch) {
    await clipsApi.updateClip(id, input);
    if (typeof sourceId === 'number') await loadClips(sourceId);
  }

  const source = sources.find((item) => item.id === sourceId) ?? null;
  const sourceReady = !!source && source.assets.length > 0;
  const job = result?.latestJob ?? null;

  if (loading) return <p className="text-sm text-ink-soft">Loading clips…</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">AI suggestions</p>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">Clip recommendations</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-soft">
          Analyze an authorized source transcript and review suggested Shorts. Scores are heuristic engagement
          signals for human review, not guaranteed virality predictions.
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-ink-soft">Create a project and import a source video before running AI analysis.</p>
      ) : (
        <div className="grid gap-3 border border-ink/15 bg-panel/50 p-4 sm:grid-cols-2 lg:grid-cols-5">
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
            Min seconds
            <input value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm" />
          </label>
          <label className="text-xs text-ink-soft">
            Max seconds
            <input value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm" />
          </label>
          <label className="text-xs text-ink-soft">
            Max clips
            <input value={maxClips} onChange={(e) => setMaxClips(e.target.value)} className="mt-1 w-full border border-ink/20 bg-paper px-2 py-2 text-sm" />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <button type="button" disabled={!sourceReady || busy} onClick={() => void analyze()} className="bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-50">
              Start analysis
            </button>
            <button type="button" disabled={!sourceReady || busy} onClick={() => void analyze()} className="border border-ink/20 px-4 py-2 text-xs font-medium disabled:opacity-50">
              Regenerate
            </button>
            <span className="text-xs text-ink-soft">
              {job ? `Latest job: ${job.status}` : 'No analysis job yet'}
              {job?.errorMessage ? ` — ${job.errorMessage}` : ''}
            </span>
          </div>
        </div>
      )}

      {!sourceReady ? <p className="text-xs text-ink-soft">Choose an ingested source with media before analyzing.</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {result?.latestAnalysis ? (
        <div className="border border-ink/15 p-4 text-xs text-ink-soft">
          <p className="font-medium text-ink">
            {result.latestAnalysis.model} · {result.clips.length} recommendation(s) · {result.latestAnalysis.candidatesGenerated} candidates generated
          </p>
          <p className="mt-1">
            Overlap skipped: {result.latestAnalysis.overlappingSkipped} · duplicates skipped: {result.latestAnalysis.duplicateSkipped}
          </p>
          <p className="mt-1">{result.latestAnalysis.disclaimer}</p>
        </div>
      ) : null}

      {result && result.clips.length === 0 ? (
        <p className="text-sm text-ink-soft">No recommendations yet. Start analysis after transcription is complete.</p>
      ) : null}

      <div className="space-y-4">
        {result?.clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            mediaUrl={clipsApi.mediaUrl(clip.sourceVideoId)}
            onUpdate={updateClip}
          />
        ))}
      </div>
    </div>
  );
}
