'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProcessingJob, Project, SourceVideo } from '@viralclip/shared';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import * as projectsApi from '@/lib/projects-api';
import * as importsApi from '@/lib/imports-api';
import * as processingApi from '@/lib/processing-api';
import { SubtitlesEditor } from '@/components/subtitles/subtitles-editor';

function extractYouTubeIdClient(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1] || null;
    else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2] || null;
      else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || null;
    }
    return id && /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function formatBytes(bytes?: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function Meta({ source }: { source: SourceVideo }) {
  const a = source.assets[0];
  if (!a) {
    return (
      <p className="text-xs text-ink-soft">
        {source.sourceType === 'youtube'
          ? 'Metadata saved. Authorized source file required for processing.'
          : 'No media file yet.'}
      </p>
    );
  }
  const parts = [
    a.durationSeconds != null ? `${a.durationSeconds}s` : null,
    a.width && a.height ? `${a.width}×${a.height}` : null,
    a.frameRate ? `${a.frameRate} fps` : null,
    a.videoCodec ? `v:${a.videoCodec}` : null,
    a.audioCodec ? `a:${a.audioCodec}` : null,
    a.audioChannels ? `${a.audioChannels}ch` : null,
    a.audioSampleRate ? `${a.audioSampleRate}Hz` : null,
    formatBytes(a.sizeBytes),
  ].filter(Boolean);
  return <p className="mt-1 text-xs text-ink-soft">{parts.join(' · ')}</p>;
}

export function ImportsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [sources, setSources] = useState<SourceVideo[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [subtitlesFor, setSubtitlesFor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ytUrl, setYtUrl] = useState('');
  const [ytBusy, setYtBusy] = useState(false);
  const [ytMsg, setYtMsg] = useState<string | null>(null);
  const [ytErr, setYtErr] = useState<string | null>(null);
  const ytPreviewId = useMemo(() => extractYouTubeIdClient(ytUrl), [ytUrl]);

  const [drag, setDrag] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'failed' | 'canceled'>('idle');
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [attachSourceId, setAttachSourceId] = useState<number | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    const res = await projectsApi.listProjects({ sort: 'newest' });
    setProjects(res.projects);
    setProjectId((cur) => cur || (res.projects[0]?.id ?? ''));
  }

  async function loadSources(pid?: number | '') {
    const id = typeof pid === 'number' ? pid : typeof projectId === 'number' ? projectId : undefined;
    if (!id) {
      setSources([]);
      setJobs([]);
      return;
    }
    const [srcRes, jobRes] = await Promise.all([importsApi.listSources(id), processingApi.listJobs({ projectId: id })]);
    setSources(srcRes.sources);
    setJobs(jobRes.jobs);
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
    if (typeof projectId === 'number') void loadSources(projectId).catch((e) => setError(importsApi.message(e)));
    else { setSources([]); setJobs([]); }
  }, [projectId]);

  useEffect(() => {
    if (typeof projectId !== 'number') return;
    const es = processingApi.openJobsStream(projectId);
    es.addEventListener('jobs', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { jobs: ProcessingJob[] };
        setJobs(data.jobs);
      } catch {}
    });
    es.onerror = () => { /* reconnect handled by browser; fallback polling via snapshot events */ };
    return () => es.close();
  }, [projectId]);

  async function submitYouTube(e: React.FormEvent) {
    e.preventDefault();
    if (typeof projectId !== 'number' || !ytUrl.trim()) return;
    setYtBusy(true);
    setYtErr(null);
    setYtMsg(null);
    try {
      const res = await importsApi.importYouTube({ projectId, url: ytUrl.trim() });
      setYtMsg(res.message);
      setYtUrl('');
      await loadSources(projectId);
    } catch (e) {
      setYtErr(importsApi.message(e));
    } finally {
      setYtBusy(false);
    }
  }

  function pickFile(file: File | null) {
    setUploadFile(file);
    setUploadPct(0);
    setUploadStatus('idle');
    setUploadErr(null);
  }

  async function startUpload(file?: File | null, sourceVideoId?: number) {
    const f = file ?? uploadFile;
    if (!f || typeof projectId !== 'number') return;
    if (!sourceVideoId) setUploadFile(f);
    setUploadStatus('uploading');
    setUploadPct(0);
    setUploadErr(null);
    try {
      const session = await importsApi.createUploadSession({
        projectId,
        filename: f.name,
        mimeType: f.type || undefined,
        sizeBytes: f.size,
        sourceVideoId,
      });
      const { promise, abort } = importsApi.uploadWithProgress({
        uploadPath: session.uploadPath,
        token: session.uploadToken,
        file: f,
        sourceVideoId,
        onProgress: setUploadPct,
      });
      abortRef.current = abort;
      await promise;
      setUploadStatus('done');
      abortRef.current = null;
      setAttachSourceId(null);
      await loadSources(projectId);
    } catch (e) {
      if ((e as { code?: string }).code === 'UPLOAD_ABORTED') {
        setUploadStatus('canceled');
        setUploadErr('Upload canceled.');
      } else {
        setUploadStatus('failed');
        setUploadErr(importsApi.message(e));
      }
      abortRef.current = null;
    }
  }

  function cancelUpload() {
    abortRef.current?.();
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return <EmptyState title="Could not load imports" body={error} />;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        title="Create a project first"
        body="Imported videos belong to a project. Create a project, then come back to upload or import sources."
        action={
          <a href="/projects?new=1" className="bg-ink px-4 py-2 text-xs font-semibold text-paper">
            Create project
          </a>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">Media</p>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">Import videos</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Upload a source file directly or import a YouTube URL. YouTube imports save metadata and require an
          authorized source file for processing.
        </p>
      </div>

      <Card title="Project">
        <label className="block max-w-md">
          <span className="text-xs font-medium text-ink-soft">Import into</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}
            className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Direct upload">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) pickFile(f);
            }}
            className={`border border-dashed p-6 text-center transition-colors ${
              drag ? 'border-accent bg-accent/5' : 'border-ink/25'
            }`}
          >
            <p className="text-sm font-medium">Drag and drop a video file</p>
            <p className="mt-1 text-xs text-ink-soft">MP4, MOV, M4V, or WebM. Size limits are enforced on upload.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="border border-ink/20 px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
              >
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/x-m4v,video/webm"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              {uploadFile ? <span className="text-xs text-ink-soft">{uploadFile.name}</span> : null}
            </div>
          </div>

          {uploadFile ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <span>{formatBytes(uploadFile.size)}</span>
                <span>{uploadStatus === 'uploading' ? `${uploadPct}%` : uploadStatus}</span>
              </div>
              <div className="h-2 w-full bg-ink/10">
                <div className="h-2 bg-accent transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
              {uploadErr ? <p className="text-xs text-red-700">{uploadErr}</p> : null}
              <div className="flex flex-wrap gap-2">
                {uploadStatus === 'uploading' ? (
                  <button type="button" onClick={cancelUpload} className="border border-ink/20 px-3 py-1.5 text-xs font-medium">
                    Cancel upload
                  </button>
                ) : null}
                {(uploadStatus === 'idle' || uploadStatus === 'failed' || uploadStatus === 'canceled') && (
                  <button
                    type="button"
                    onClick={() => void startUpload()}
                    disabled={typeof projectId !== 'number'}
                    className="bg-ink px-4 py-1.5 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
                  >
                    {uploadStatus === 'failed' || uploadStatus === 'canceled' ? 'Retry upload' : 'Start upload'}
                  </button>
                )}
                {uploadStatus === 'done' ? <span className="text-xs text-emerald-700">Upload complete.</span> : null}
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="YouTube URL import">
          <form onSubmit={submitYouTube} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">YouTube video URL</span>
              <input
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            {ytPreviewId ? (
              <div className="aspect-video w-full border border-ink/15 bg-black">
                <iframe
                  title="YouTube preview"
                  src={`https://www.youtube.com/embed/${ytPreviewId}`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : ytUrl.trim() ? (
              <p className="text-xs text-ink-soft">Enter a valid YouTube video URL to see a preview.</p>
            ) : null}
            {ytErr ? <p className="text-xs text-red-700">{ytErr}</p> : null}
            {ytMsg ? <p className="text-xs text-emerald-700">{ytMsg}</p> : null}
            <button
              type="submit"
              disabled={ytBusy || !ytUrl.trim() || typeof projectId !== 'number'}
              className="bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-accent disabled:opacity-50"
            >
              {ytBusy ? 'Importing…' : 'Import YouTube metadata'}
            </button>
            <p className="text-xs text-ink-soft">
              We save metadata via the YouTube Data API when configured and do not download protected videos. Upload an
              authorized source file to process a YouTube video.
            </p>
          </form>
        </Card>
      </div>

      <Card title="Processing jobs (live)">
        {jobs.length === 0 ? (
          <p className="text-sm text-ink-soft">No processing jobs yet. Uploading a source file queues video ingestion automatically.</p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id} className="border border-ink/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{j.jobType.replace(/-/g, ' ')} <span className="font-normal text-ink-soft">#{j.id}</span></p>
                    <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      j.status === 'completed' ? 'border-emerald-700/40 text-emerald-800' :
                      j.status === 'failed' ? 'border-red-700/40 text-red-700' :
                      j.status === 'cancelled' ? 'border-ink/30 text-ink-soft' :
                      j.status === 'processing' ? 'border-accent/40 text-accent' : 'border-ink/20 text-ink-soft'
                    }`}>{j.status}</span>
                    <span className="text-xs text-ink-soft">source #{j.sourceVideoId} · {j.queueName}</span>
                  </div>
                  {(j.status === 'queued' || j.status === 'processing') ? (
                    <button type="button" onClick={() => void processingApi.cancelJob(j.id).then(() => loadSources(projectId)).catch(() => {})} className="border border-ink/20 px-2 py-1 text-xs hover:border-red-700 hover:text-red-700">Cancel</button>
                  ) : null}
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[11px] text-ink-soft"><span>Progress</span><span>{j.progress}%</span></div>
                  <div className="mt-1 h-1.5 w-full bg-ink/10"><div className="h-1.5 bg-accent transition-all" style={{ width: `${j.progress}%` }} /></div>
                </div>
                {j.errorMessage ? <p className="mt-2 text-xs text-red-700">{j.errorMessage}</p> : null}
                <p className="mt-1 text-[11px] text-ink-soft">Attempts: {j.attempt}/{j.maxAttempts}{j.completedAt ? ` · completed ${new Date(j.completedAt).toLocaleString()}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Source video library">
        <input
          ref={attachInputRef}
          type="file"
          accept=".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/x-m4v,video/webm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            const id = attachSourceId;
            e.target.value = '';
            if (f && id) void startUpload(f, id);
          }}
        />
        {attachSourceId && uploadStatus === 'uploading' ? (
          <p className="mb-3 text-xs text-ink-soft">Uploading authorized source… {uploadPct}%</p>
        ) : null}
        {sources.length === 0 ? (
          <p className="text-sm text-ink-soft">No source videos imported for this project yet.</p>
        ) : (
          <ul className="space-y-3">
            {sources.map((s) => (
              <li key={s.id} className="border border-ink/10 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{s.title}</p>
                      <span className="border border-ink/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
                        {s.sourceType}
                      </span>
                      <span className="border border-ink/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
                        {s.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {s.youtubeVideoId ? (
                      <p className="mt-1 text-xs text-ink-soft">YouTube ID: {s.youtubeVideoId}</p>
                    ) : null}
                    <Meta source={s} />
                    {s.errorMessage ? <p className="mt-1 text-xs text-red-700">{s.errorMessage}</p> : null}
                  </div>
                  <div className="shrink-0 space-y-2">
                    {s.sourceType === 'youtube' && s.youtubeVideoId ? (
                      <div className="w-full max-w-[220px]">
                        <div className="aspect-video border border-ink/15 bg-black">
                          <iframe
                            title={`Preview ${s.title}`}
                            src={`https://www.youtube.com/embed/${s.youtubeVideoId}`}
                            className="h-full w-full"
                            allowFullScreen
                          />
                        </div>
                      </div>
                    ) : s.assets[0] ? (
                      <p className="text-xs text-ink-soft">Stored: {s.assets[0].originalFilename}</p>
                    ) : null}
                    {s.sourceType === 'youtube' && s.status === 'awaiting_authorized_source' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachSourceId(s.id);
                          attachInputRef.current?.click();
                        }}
                        className="w-full border border-ink/20 px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
                      >
                        Upload authorized source
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSubtitlesFor((cur) => (cur === s.id ? null : s.id))}
                      className="w-full border border-ink/20 px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
                    >
                      {subtitlesFor === s.id ? 'Hide subtitles' : 'Subtitles'}
                    </button>
                  </div>
                </div>
                {subtitlesFor === s.id ? <SubtitlesEditor sourceId={s.id} sourceReady={s.status === 'ready'} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
