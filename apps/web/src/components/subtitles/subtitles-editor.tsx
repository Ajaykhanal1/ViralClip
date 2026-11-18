'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SubtitleSegment, SubtitleStyle, SubtitleTrack, Transcript } from '@viralclip/shared';
import * as api from '@/lib/subtitles-api';

function sec(ms: number): string { return (ms / 1000).toFixed(3); }
function msFromSec(v: string): number { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000)) : 0; }

const defaultStyle: Required<Pick<SubtitleStyle, 'fontFamily' | 'fontSize' | 'textColor' | 'background' | 'outline' | 'position' | 'alignment' | 'highlightedWords' | 'activeWordAnimation'>> = {
  fontFamily: 'Arial',
  fontSize: 32,
  textColor: '#FFFFFF',
  background: 'rgba(0,0,0,0.6)',
  outline: '#000000',
  position: 'bottom',
  alignment: 'center',
  highlightedWords: false,
  activeWordAnimation: 'none',
};

export function SubtitlesEditor({ sourceId, sourceReady }: { sourceId: number; sourceReady: boolean }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [language, setLanguage] = useState('');
  const [translate, setTranslate] = useState(false);
  const [style, setStyle] = useState<SubtitleStyle>(defaultStyle);
  const [trackName, setTrackName] = useState('');
  const [trackLang, setTrackLang] = useState('');

  async function load(all = true) {
    setError(null);
    try {
      const res = await api.listForSource(sourceId);
      setTranscripts(res.transcripts);
      setTracks(res.tracks);
      if (all) {
        const next = res.tracks[0] ?? null;
        if (next) await selectTrack(next.id); else { setTrack(null); setSegments([]); }
      }
    } catch (e) {
      setError(api.message(e));
    } finally {
      setLoading(false);
    }
  }

  async function selectTrack(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.getTrack(id);
      setTrack(res.track);
      setSegments([...(res.track.segments ?? [])]);
      setStyle({ ...defaultStyle, ...(res.track.style ?? {}) });
      setTrackName(res.track.name);
      setTrackLang(res.track.language ?? '');
    } catch (e) {
      setError(api.message(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sourceId]);

  async function run(action: () => Promise<any>, refreshTrack = true) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load(false);
      if (refreshTrack && track) await selectTrack(track.id);
    } catch (e) {
      setError(api.message(e));
    } finally {
      setBusy(false);
    }
  }

  async function startTranscription(regenerate = false, translateToEnglish = false) {
    await run(async () => {
      await api.requestTranscription({ sourceVideoId: sourceId, language: language.trim() || null, translateToEnglish, regenerate: regenerate || !!track, targetTrackId: regenerate && track ? track.id : null });
    }, false);
  }

  async function saveTrackMeta() {
    if (!track) return;
    await run(async () => {
      await api.updateTrack(track.id, { name: trackName.trim() || track.name, language: trackLang.trim() || null, style });
    });
  }

  async function saveSegments(next: SubtitleSegment[]) {
    if (!track) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.replaceSegments(track.id, next.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker })));
      setTrack(res.track);
      setSegments([...(res.track.segments ?? [])]);
    } catch (e) {
      setError(api.message(e));
    } finally {
      setBusy(false);
    }
  }

  function updateSeg(i: number, patch: Partial<SubtitleSegment>) {
    setSegments((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  if (loading) return <p className="text-xs text-ink-soft">Loading subtitles…</p>;

  return (
    <div className="mt-4 space-y-4 border-t border-ink/10 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium">Subtitles & transcription</p>
          <p className="text-xs text-ink-soft">Original transcripts are preserved. Edits apply to subtitle tracks until final rendering.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Lang (auto)" className="w-28 border border-ink/20 bg-paper px-2 py-1 text-xs" />
          <button disabled={busy || !sourceReady} onClick={() => void startTranscription(false, false)} className="border border-ink/20 px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50">Transcribe</button>
          <button disabled={busy || !sourceReady} onClick={() => void startTranscription(true, false)} className="border border-ink/20 px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50">Regenerate</button>
          <button disabled={busy || !sourceReady} onClick={() => void startTranscription(true, true)} className="border border-ink/20 px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50">Translate to EN</button>
        </div>
      </div>
      {!sourceReady ? <p className="text-xs text-ink-soft">Source must be ready (ingested) before transcription.</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-ink-soft">Tracks</p>
            {tracks.length === 0 ? <p className="mt-1 text-xs text-ink-soft">No subtitle tracks yet.</p> : (
              <ul className="mt-1 space-y-1">
                {tracks.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => void selectTrack(t.id)} className={`w-full border px-2 py-1 text-left text-xs ${track?.id === t.id ? 'border-accent text-accent' : 'border-ink/15 hover:border-ink/30'}`}>
                      {t.name} {t.isDefault ? '· default' : ''} {t.language ? `(${t.language})` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-ink-soft">Original transcripts</p>
            {transcripts.length === 0 ? <p className="mt-1 text-xs text-ink-soft">None yet.</p> : (
              <ul className="mt-1 space-y-1 text-xs text-ink-soft">
                {transcripts.map((t) => <li key={t.id}>#{t.id} · {t.language || t.detectedLanguage || 'unknown'} · {t.status}{t.model ? ` · ${t.model}` : ''}</li>)}
              </ul>
            )}
            <p className="mt-1 text-[11px] text-ink-soft">Original transcription data is preserved; editing changes subtitle tracks only.</p>
          </div>
          {track ? (
            <div className="space-y-2 border border-ink/10 p-2">
              <p className="text-xs font-medium">Track settings</p>
              <label className="block text-[11px] text-ink-soft">Name<input value={trackName} onChange={(e) => setTrackName(e.target.value)} className="mt-0.5 w-full border border-ink/20 bg-paper px-2 py-1 text-xs" /></label>
              <label className="block text-[11px] text-ink-soft">Language<input value={trackLang} onChange={(e) => setTrackLang(e.target.value)} className="mt-0.5 w-full border border-ink/20 bg-paper px-2 py-1 text-xs" /></label>
              <p className="text-[11px] font-medium text-ink-soft">Style</p>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                <label>Font<input value={String(style.fontFamily ?? '')} onChange={(e) => setStyle({ ...style, fontFamily: e.target.value })} className="w-full border border-ink/20 px-1 py-0.5" /></label>
                <label>Size<input type="number" value={Number(style.fontSize ?? 32)} onChange={(e) => setStyle({ ...style, fontSize: Number(e.target.value) })} className="w-full border border-ink/20 px-1 py-0.5" /></label>
                <label>Text<input value={String(style.textColor ?? '')} onChange={(e) => setStyle({ ...style, textColor: e.target.value })} className="w-full border border-ink/20 px-1 py-0.5" /></label>
                <label>Bg<input value={String(style.background ?? '')} onChange={(e) => setStyle({ ...style, background: e.target.value })} className="w-full border border-ink/20 px-1 py-0.5" /></label>
                <label>Outline<input value={String(style.outline ?? '')} onChange={(e) => setStyle({ ...style, outline: e.target.value })} className="w-full border border-ink/20 px-1 py-0.5" /></label>
                <label>Position<select value={String(style.position ?? 'bottom')} onChange={(e) => setStyle({ ...style, position: e.target.value as any })} className="w-full border border-ink/20 px-1 py-0.5"><option>top</option><option>middle</option><option>bottom</option></select></label>
                <label>Align<select value={String(style.alignment ?? 'center')} onChange={(e) => setStyle({ ...style, alignment: e.target.value as any })} className="w-full border border-ink/20 px-1 py-0.5"><option>left</option><option>center</option><option>right</option></select></label>
                <label>Word anim<input value={String(style.activeWordAnimation ?? 'none')} onChange={(e) => setStyle({ ...style, activeWordAnimation: e.target.value })} className="w-full border border-ink/20 px-1 py-0.5" /></label>
              </div>
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={!!style.highlightedWords} onChange={(e) => setStyle({ ...style, highlightedWords: e.target.checked })} />Highlighted words</label>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void saveTrackMeta()} className="border border-ink/20 px-2 py-1 text-xs hover:border-accent">Save track/style</button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 text-xs">
                <a href={api.exportUrl(track.id, 'srt')} className="underline" target="_blank" rel="noreferrer">SRT</a>
                <a href={api.exportUrl(track.id, 'vtt')} className="underline" target="_blank" rel="noreferrer">VTT</a>
                <a href={api.exportUrl(track.id, 'json')} className="underline" target="_blank" rel="noreferrer">JSON</a>
              </div>
            </div>
          ) : null}
        </div>

        <div>
          {!track ? <p className="text-xs text-ink-soft">Select a track or start transcription to generate subtitles.</p> : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Segments ({segments.length})</p>
                <button disabled={busy} onClick={() => void saveSegments(segments)} className="border border-ink/20 px-2 py-1 text-xs hover:border-accent disabled:opacity-50">Save timing/text changes</button>
              </div>
              {segments.length === 0 ? <p className="text-xs text-ink-soft">No segments.</p> : (
                <ul className="space-y-2">
                  {segments.map((s, i) => (
                    <li key={`${s.id}-${s.segmentIndex}-${i}`} className="border border-ink/10 p-2">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
                        <span>#{s.segmentIndex}</span>
                        <label>Start(s)<input type="number" step="0.001" value={sec(s.startMs)} onChange={(e) => updateSeg(i, { startMs: msFromSec(e.target.value) })} className="ml-1 w-24 border border-ink/20 px-1 py-0.5" /></label>
                        <label>End(s)<input type="number" step="0.001" value={sec(s.endMs)} onChange={(e) => updateSeg(i, { endMs: msFromSec(e.target.value) })} className="ml-1 w-24 border border-ink/20 px-1 py-0.5" /></label>
                        <label>Speaker<input value={s.speaker ?? ''} onChange={(e) => updateSeg(i, { speaker: e.target.value || null })} className="ml-1 w-24 border border-ink/20 px-1 py-0.5" /></label>
                      </div>
                      <textarea value={s.text} onChange={(e) => updateSeg(i, { text: e.target.value })} rows={2} className="w-full border border-ink/20 bg-paper px-2 py-1 text-xs" />
                      <div className="mt-1 flex flex-wrap gap-2">
                        <button disabled={busy} onClick={() => void run(() => api.splitSegment(track.id, s.segmentIndex, {}))} className="border border-ink/20 px-2 py-0.5 text-[11px] hover:border-accent">Split</button>
                        <button disabled={busy} onClick={() => void run(() => api.mergeSegment(track.id, s.segmentIndex, 'next'))} className="border border-ink/20 px-2 py-0.5 text-[11px] hover:border-accent">Merge next</button>
                        <button disabled={busy} onClick={() => void run(() => api.mergeSegment(track.id, s.segmentIndex, 'previous'))} className="border border-ink/20 px-2 py-0.5 text-[11px] hover:border-accent">Merge prev</button>
                        <button disabled={busy} onClick={() => void run(() => api.deleteSegment(track.id, s.segmentIndex))} className="border border-red-700/30 px-2 py-0.5 text-[11px] text-red-700 hover:border-red-700">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
