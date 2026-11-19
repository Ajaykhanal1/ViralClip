'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { EditorCue, EditorTextOverlay, EditorTimeline, EditorTrack, ShortDraft, TimelineClip } from '@viralclip/shared';
import * as api from '@/lib/editor-api';
import { useEditorStore } from '@/store/editor-store';

function ms(value: number): string {
  const total = Math.max(0, Math.round(value));
  return `${String(Math.floor(total / 60000)).padStart(2, '0')}:${String(Math.floor((total % 60000) / 1000)).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

function patchTimelineClip(timeline: EditorTimeline, trackId: string, clipId: string, patch: Partial<TimelineClip>): EditorTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id !== trackId ? track : { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)) },
    ),
  };
}

function durationOf(timeline: EditorTimeline): number {
  return Math.max(1000, ...timeline.tracks.flatMap((track) => track.clips).map((clip) => clip.startMs + clip.durationMs));
}

function Toolbar({ onSaveVersion }: { onSaveVersion: () => void }) {
  const s = useEditorStore();
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-ink/15 bg-panel/60 px-4 py-2">
      <Link href="/shorts" className="mr-2 font-serif text-lg">ViralClip <span className="text-accent">Editor</span></Link>
      <button type="button" onClick={s.undo} disabled={!s.past.length} className="border border-ink/20 px-2.5 py-1 text-xs disabled:opacity-40">Undo</button>
      <button type="button" onClick={s.redo} disabled={!s.future.length} className="border border-ink/20 px-2.5 py-1 text-xs disabled:opacity-40">Redo</button>
      <button type="button" onClick={() => void s.saveNow()} className="border border-ink/20 px-2.5 py-1 text-xs">Save</button>
      <button type="button" onClick={onSaveVersion} className="border border-ink/20 px-2.5 py-1 text-xs">Save version</button>
      <button type="button" onClick={() => void s.exportEdit()} className="bg-ink px-3 py-1 text-xs font-semibold text-paper">Export final MP4</button>
      <span className="ml-auto font-mono text-[11px] text-ink-soft">
        {s.saving ? 'Saving…' : s.dirty ? 'Unsaved changes' : s.savedAt ? `Saved ${new Date(s.savedAt).toLocaleTimeString()}` : ''}
      </span>
    </header>
  );
}

function AssetPanel() {
  const s = useEditorStore();
  const [label, setLabel] = useState('Authorized audio');
  const [rightsId, setRightsId] = useState('');
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-ink/15 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">Assets</p>
      <div className="mt-2 space-y-2">
        <button type="button" onClick={s.addText} className="w-full border border-ink/20 px-2 py-1.5 text-left text-xs hover:bg-ink/5">+ Text overlay</button>
        <button type="button" onClick={s.addCue} className="w-full border border-ink/20 px-2 py-1.5 text-left text-xs hover:bg-ink/5">+ Subtitle cue</button>
      </div>
      <div className="mt-4 border-t border-ink/10 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">Authorized audio</p>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="mt-2 w-full border border-ink/20 px-2 py-1 text-xs" />
        <input value={rightsId} onChange={(e) => setRightsId(e.target.value)} inputMode="numeric" placeholder="Rights ID" className="mt-1 w-full border border-ink/20 px-2 py-1 text-xs" />
        <button
          type="button"
          disabled={!rightsId || !label}
          onClick={() => { void s.addAudioAsset(Number(rightsId), label); setRightsId(''); }}
          className="mt-1 w-full bg-ink px-2 py-1.5 text-xs font-semibold text-paper disabled:opacity-40"
        >
          Add audio asset
        </button>
        <p className="mt-1 text-[10px] leading-snug text-ink-soft">Media keys are taken from the verified rights record, never from this form.</p>
      </div>
      <div className="mt-4 space-y-1 border-t border-ink/10 pt-3">
        {s.assets.map((asset) => (
          <div key={asset.id} className="flex items-center gap-1 text-[11px]">
            <span className="min-w-0 flex-1 truncate">{asset.label}</span>
            <button type="button" onClick={() => void s.deleteAsset(asset.id)} className="text-red-700" aria-label={`Remove ${asset.label}`}>×</button>
          </div>
        ))}
        {!s.assets.length ? <p className="text-[11px] text-ink-soft">No imported assets.</p> : null}
      </div>
      <div className="mt-4 border-t border-ink/10 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">Versions</p>
        {s.versions.map((version) => (
          <button key={version.id} type="button" onClick={() => void s.restore(version.id)} className="mt-1 block w-full truncate border border-ink/15 px-2 py-1 text-left text-[11px] hover:bg-ink/5">
            v{version.version} · {version.label}
          </button>
        ))}
        {!s.versions.length ? <p className="mt-1 text-[11px] text-ink-soft">No saved versions yet.</p> : null}
      </div>
    </aside>
  );
}

function Preview({ draft, videoRef, seek, playing, toggle }: {
  draft: ShortDraft;
  videoRef: RefObject<HTMLVideoElement | null>;
  seek: (ms: number) => void;
  playing: boolean;
  toggle: () => void;
}) {
  const { timeline, currentMs, selection, select } = useEditorStore();
  const cue: EditorCue | undefined = timeline.subtitles.find((item) => currentMs >= item.startMs && currentMs <= item.endMs);
  const texts: EditorTextOverlay[] = timeline.texts.filter((item) => currentMs >= item.startMs && currentMs <= item.endMs);
  return (
    <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-ink/5 p-4">
      <div className="relative aspect-[9/16] h-full max-h-[62vh] overflow-hidden bg-black shadow-lg">
        <video
          ref={videoRef}
          src={api.mediaUrl(draft.id)}
          playsInline
          className="h-full w-full object-contain"
          onTimeUpdate={(event) => useEditorStore.getState().setCurrentMs(event.currentTarget.currentTime * 1000)}
          onEnded={() => useEditorStore.getState().setCurrentMs(0)}
        />
        <div className="pointer-events-none absolute inset-0">
          {cue ? (
            <button
              type="button"
              onClick={() => select({ kind: 'cue', id: cue.id })}
              className={`pointer-events-auto absolute left-1/2 w-[86%] -translate-x-1/2 bg-black/60 px-2 py-1 text-center ${selection?.kind === 'cue' && selection.id === cue.id ? 'ring-2 ring-accent' : ''}`}
              style={{ top: cue.style.position === 'top' ? '8%' : cue.style.position === 'middle' ? '46%' : '84%', color: cue.style.textColor, fontSize: cue.style.fontSize, fontFamily: cue.style.fontFamily, background: cue.style.background }}
            >
              {cue.text}
            </button>
          ) : null}
          {texts.map((text) => (
            <button
              key={text.id}
              type="button"
              onClick={() => select({ kind: 'text', id: text.id })}
              className={`pointer-events-auto absolute -translate-x-1/2 whitespace-pre-wrap px-1 text-center ${selection?.kind === 'text' && selection.id === text.id ? 'ring-2 ring-accent' : ''}`}
              style={{ left: `${text.x * 100}%`, top: `${text.y * 100}%`, color: text.color, fontSize: text.fontSize, opacity: text.animation === 'fade' ? 0.95 : 1 }}
            >
              {text.text}
            </button>
          ))}
        </div>
      </div>
      <div className="flex w-full max-w-md items-center gap-2">
        <button type="button" onClick={toggle} className="border border-ink/20 bg-paper px-3 py-1 text-xs">{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range" min={0} max={Math.max(1, durationOf(timeline))} step={10} value={Math.min(currentMs, durationOf(timeline))}
          onChange={(e) => seek(Number(e.target.value))} className="h-1 flex-1 accent-[var(--color-accent)]" aria-label="Playhead"
        />
        <span className="font-mono text-[11px] text-ink-soft">{ms(currentMs)}</span>
      </div>
    </section>
  );
}

function Timeline({ seek }: { seek: (ms: number) => void }) {
  const s = useEditorStore();
  const { timeline, selection, select, currentMs } = s;
  const pxPerMs = timeline.settings.timelineZoom / 100;
  const total = durationOf(timeline);
  const snap = (value: number) => timeline.settings.snapMs > 0 ? Math.round(value / timeline.settings.snapMs) * timeline.settings.snapMs : Math.round(value);

  function startDrag(event: ReactPointerEvent, clip: TimelineClip, mode: 'move' | 'left' | 'right') {
    event.stopPropagation();
    select({ kind: 'clip', trackId: clip.trackId, clipId: clip.id });
    const track = timeline.tracks.find((item) => item.id === clip.trackId);
    if (!track || track.locked) return;
    const snapshot = useEditorStore.getState().timeline;
    const startX = event.clientX;
    const original = { ...clip };
    const onMove = (move: PointerEvent) => {
      const delta = snap((move.clientX - startX) / pxPerMs);
      let patch: Partial<TimelineClip>;
      if (mode === 'move') {
        patch = { startMs: Math.max(0, original.startMs + delta) };
      } else if (mode === 'right') {
        const durationMs = Math.max(1, original.durationMs + delta);
        patch = { durationMs, sourceEndMs: original.sourceStartMs + durationMs };
      } else {
        const startMs = Math.min(original.startMs + original.durationMs - 1, Math.max(0, original.startMs + delta));
        const shift = startMs - original.startMs;
        patch = { startMs, durationMs: original.durationMs - shift, sourceStartMs: original.sourceStartMs + shift };
      }
      useEditorStore.getState().transient(patchTimelineClip(useEditorStore.getState().timeline, clip.trackId, clip.id, patch));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      useEditorStore.getState().remember(snapshot);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function laneClick(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(snap(Math.max(0, (event.clientX - rect.left) / pxPerMs)));
  }

  return (
    <section className="h-60 shrink-0 overflow-auto border-t border-ink/15 bg-paper p-2">
      <div className="flex items-center gap-2 pb-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">Timeline {ms(currentMs)}</span>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-ink-soft">
          Zoom
          <input type="range" min={0.2} max={20} step={0.2} value={timeline.settings.timelineZoom} onChange={(e) => s.patchSettings({ timelineZoom: Number(e.target.value) })} className="w-24" />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-ink-soft">
          Snap
          <select value={timeline.settings.snapMs} onChange={(e) => s.patchSettings({ snapMs: Number(e.target.value) })} className="border border-ink/20 px-1 py-0.5 text-[10px]">
            <option value={0}>Off</option><option value={50}>50ms</option><option value={100}>100ms</option><option value={250}>250ms</option><option value={500}>500ms</option>
          </select>
        </label>
      </div>
      <div className="relative" style={{ width: 132 + total * pxPerMs }}>
        <div className="absolute bottom-0 top-0 z-20 w-px bg-red-600" style={{ left: 132 + currentMs * pxPerMs }} />
        {timeline.tracks.map((track) => (
          <TrackRow key={track.id} track={track} pxPerMs={pxPerMs} selection={selection} onLaneClick={laneClick} onStartDrag={startDrag} />
        ))}
      </div>
    </section>
  );
}

function TrackRow({ track, pxPerMs, selection, onLaneClick, onStartDrag }: {
  track: EditorTrack;
  pxPerMs: number;
  selection: ReturnType<typeof useEditorStore.getState>['selection'];
  onLaneClick: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartDrag: (event: ReactPointerEvent, clip: TimelineClip, mode: 'move' | 'left' | 'right') => void;
}) {
  const s = useEditorStore();
  return (
    <div className="flex h-12 border-b border-ink/10">
      <div className="sticky left-0 z-10 flex w-[132px] shrink-0 items-center gap-1 border-r border-ink/10 bg-paper px-1">
        <button type="button" onClick={() => s.toggleTrack(track.id, 'visible')} className="text-[11px]" title="Toggle visibility">{track.visible ? '◉' : '○'}</button>
        <button type="button" onClick={() => s.toggleTrack(track.id, 'locked')} className="text-[11px]" title="Toggle lock">{track.locked ? '🔒' : '🔓'}</button>
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-soft">{track.name}</span>
      </div>
      <div className="relative h-full flex-1 bg-ink/[0.03]" onPointerDown={onLaneClick}>
        {track.clips.map((clip) => {
          const active = selection?.kind === 'clip' && selection.trackId === track.id && selection.clipId === clip.id;
          return (
            <div
              key={clip.id}
              onPointerDown={(event) => onStartDrag(event, clip, 'move')}
              className={`absolute top-1 h-10 cursor-grab overflow-hidden border px-1 text-[10px] ${active ? 'border-accent bg-accent/20' : 'border-ink/30 bg-ink/10'} ${track.visible ? '' : 'opacity-40'}`}
              style={{ left: clip.startMs * pxPerMs, width: Math.max(12, clip.durationMs * pxPerMs) }}
            >
              <span className="block truncate">{clip.label}</span>
              <span
                onPointerDown={(event) => { event.stopPropagation(); onStartDrag(event, clip, 'left'); }}
                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-ink/30"
              />
              <span
                onPointerDown={(event) => { event.stopPropagation(); onStartDrag(event, clip, 'right'); }}
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-ink/30"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-ink-soft">
      {label}
      {children}
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <Field label={label}>
      <input type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs text-ink" />
    </Field>
  );
}

function Properties() {
  const s = useEditorStore();
  const { timeline, selection } = s;
  const clip = selection?.kind === 'clip' ? timeline.tracks.find((t) => t.id === selection.trackId)?.clips.find((c) => c.id === selection.clipId) : null;
  const cue = selection?.kind === 'cue' ? timeline.subtitles.find((c) => c.id === selection.id) : null;
  const text = selection?.kind === 'text' ? timeline.texts.find((t) => t.id === selection.id) : null;

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-ink/15 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">Properties</p>
      {clip ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold">{clip.label}</p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Trim start (ms)" value={clip.sourceStartMs} min={0} onChange={(v) => s.patchClip(clip.trackId, clip.id, { sourceStartMs: v })} />
            <NumberField label="Duration (ms)" value={clip.durationMs} min={1} onChange={(v) => s.patchClip(clip.trackId, clip.id, { durationMs: v, sourceEndMs: clip.sourceStartMs + v })} />
            <NumberField label="Position (ms)" value={clip.startMs} min={0} onChange={(v) => s.patchClip(clip.trackId, clip.id, { startMs: v })} />
            <NumberField label="Speed" value={clip.speed} min={0.25} max={4} step={0.25} onChange={(v) => s.patchClip(clip.trackId, clip.id, { speed: v })} />
            <NumberField label="Crop X" value={clip.cropX} min={-1} max={1} step={0.05} onChange={(v) => s.patchClip(clip.trackId, clip.id, { cropX: v })} />
            <NumberField label="Crop Y" value={clip.cropY} min={-1} max={1} step={0.05} onChange={(v) => s.patchClip(clip.trackId, clip.id, { cropY: v })} />
            <NumberField label="Zoom" value={clip.zoom} min={0.5} max={4} step={0.1} onChange={(v) => s.patchClip(clip.trackId, clip.id, { zoom: v })} />
            <NumberField label="Rotate °" value={clip.rotation} min={-180} max={180} onChange={(v) => s.patchClip(clip.trackId, clip.id, { rotation: v })} />
            <NumberField label="Volume" value={clip.volume} min={0} max={4} step={0.1} onChange={(v) => s.patchClip(clip.trackId, clip.id, { volume: v })} />
            <NumberField label="Fade in (ms)" value={clip.fadeInMs} min={0} onChange={(v) => s.patchClip(clip.trackId, clip.id, { fadeInMs: v })} />
            <NumberField label="Fade out (ms)" value={clip.fadeOutMs} min={0} onChange={(v) => s.patchClip(clip.trackId, clip.id, { fadeOutMs: v })} />
            <NumberField label="Transition (ms)" value={clip.transitionMs} min={0} max={5000} onChange={(v) => s.patchClip(clip.trackId, clip.id, { transitionMs: v })} />
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={clip.muted} onChange={(e) => s.patchClip(clip.trackId, clip.id, { muted: e.target.checked })} /> Mute</label>
          <div className="flex gap-2 border-t border-ink/10 pt-2">
            <button type="button" onClick={s.splitSelected} className="border border-ink/20 px-2 py-1 text-xs">Split</button>
            <button type="button" onClick={s.mergeSelected} className="border border-ink/20 px-2 py-1 text-xs">Merge</button>
            <button type="button" onClick={s.deleteSelected} className="border border-red-700 px-2 py-1 text-xs text-red-700">Delete</button>
          </div>
        </div>
      ) : cue ? (
        <CueProperties cue={cue} />
      ) : text ? (
        <TextProperties text={text} />
      ) : (
        <p className="mt-3 text-xs text-ink-soft">Select a clip, subtitle, or text overlay to edit its properties. Use the timeline handles to trim and reposition.</p>
      )}
      {s.error ? <p className="mt-4 border border-red-700/30 bg-red-50 p-2 text-xs text-red-700">{s.error}</p> : null}
    </aside>
  );
}

function CueProperties({ cue }: { cue: EditorCue }) {
  const s = useEditorStore();
  const st = cue.style;
  const style = (patch: Record<string, unknown>) => s.patchCue(cue.id, { style: { ...st, ...patch } });
  return (
    <div className="mt-3 space-y-2">
      <Field label="Text">
        <textarea value={cue.text} onChange={(e) => s.patchCue(cue.id, { text: e.target.value })} rows={3} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Start (ms)" value={cue.startMs} min={0} onChange={(v) => s.patchCue(cue.id, { startMs: v })} />
        <NumberField label="End (ms)" value={cue.endMs} min={1} onChange={(v) => s.patchCue(cue.id, { endMs: v })} />
      </div>
      <Field label="Font">
        <input value={String(st.fontFamily ?? '')} onChange={(e) => style({ fontFamily: e.target.value })} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs" />
      </Field>
      <NumberField label="Size" value={Number(st.fontSize ?? 48)} min={8} max={200} onChange={(v) => style({ fontSize: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Color"><input type="color" value={String(st.textColor ?? '#FFFFFF')} onChange={(e) => style({ textColor: e.target.value })} className="mt-0.5 w-full border border-ink/20" /></Field>
        <Field label="Outline"><input type="color" value={String(st.outline ?? '#000000')} onChange={(e) => style({ outline: e.target.value })} className="mt-0.5 w-full border border-ink/20" /></Field>
      </div>
      <Field label="Background"><input value={String(st.background ?? '')} onChange={(e) => style({ background: e.target.value })} placeholder="rgba(0,0,0,0.6)" className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs" /></Field>
      <Field label="Position">
        <select value={String(st.position ?? 'bottom')} onChange={(e) => style({ position: e.target.value })} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs">
          <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
        </select>
      </Field>
      <Field label="Animation">
        <select value={String(st.activeWordAnimation ?? 'none')} onChange={(e) => style({ activeWordAnimation: e.target.value })} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs">
          <option value="none">None</option><option value="pop">Pop</option><option value="fade">Fade</option><option value="slide">Slide</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!st.highlightedWords} onChange={(e) => style({ highlightedWords: e.target.checked })} /> Highlight active words</label>
      <button type="button" onClick={s.deleteSelected} className="border border-red-700 px-2 py-1 text-xs text-red-700">Delete cue</button>
    </div>
  );
}

function TextProperties({ text }: { text: EditorTextOverlay }) {
  const s = useEditorStore();
  return (
    <div className="mt-3 space-y-2">
      <Field label="Text">
        <textarea value={text.text} onChange={(e) => s.patchText(text.id, { text: e.target.value })} rows={3} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Start (ms)" value={text.startMs} min={0} onChange={(v) => s.patchText(text.id, { startMs: v })} />
        <NumberField label="End (ms)" value={text.endMs} min={1} onChange={(v) => s.patchText(text.id, { endMs: v })} />
        <NumberField label="Size" value={text.fontSize} min={8} max={200} onChange={(v) => s.patchText(text.id, { fontSize: v })} />
        <Field label="Color"><input type="color" value={text.color} onChange={(e) => s.patchText(text.id, { color: e.target.value })} className="mt-0.5 w-full border border-ink/20" /></Field>
      </div>
      <Field label="X position"><input type="range" min={0} max={1} step={0.01} value={text.x} onChange={(e) => s.patchText(text.id, { x: Number(e.target.value) })} className="w-full" /></Field>
      <Field label="Y position"><input type="range" min={0} max={1} step={0.01} value={text.y} onChange={(e) => s.patchText(text.id, { y: Number(e.target.value) })} className="w-full" /></Field>
      <Field label="Animation">
        <select value={text.animation} onChange={(e) => s.patchText(text.id, { animation: e.target.value as EditorTextOverlay['animation'] })} className="mt-0.5 w-full border border-ink/20 px-2 py-1 text-xs">
          <option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide</option>
        </select>
      </Field>
      <button type="button" onClick={s.deleteSelected} className="border border-red-700 px-2 py-1 text-xs text-red-700">Delete text</button>
    </div>
  );
}

export function EditorView() {
  const params = useSearchParams();
  const draftId = Number(params.get('draft'));
  const hydrate = useEditorStore((state) => state.hydrate);
  const notice = useEditorStore((state) => state.notice);
  const setNotice = useEditorStore((state) => state.setNotice);
  const [draft, setDraft] = useState<ShortDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    let active = true;
    setLoading(true);
    api.load(draftId)
      .then((result) => {
        if (!active) return;
        hydrate(result.edit, result.versions, result.assets);
        setDraft(result.draft);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(api.message(error));
        setLoading(false);
      });
    return () => { active = false; };
  }, [draftId, hydrate]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  function seek(value: number) {
    if (videoRef.current) videoRef.current.currentTime = value / 1000;
    useEditorStore.getState().setCurrentMs(value);
  }

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { await video.play(); setPlaying(true); } else { video.pause(); setPlaying(false); }
  }

  if (!draftId) return <p className="text-sm text-ink-soft">Open a Short from <Link href="/shorts" className="text-accent underline">/shorts</Link> to start editing.</p>;
  if (loading) return <p className="text-sm text-ink-soft">Loading editor…</p>;
  if (loadError || !draft) return <p className="text-sm text-red-700">{loadError ?? 'Draft not found.'}</p>;

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[680px] flex-col border border-ink/15 bg-paper">
      <Toolbar onSaveVersion={() => {
        const label = window.prompt('Version label', `Checkpoint ${new Date().toLocaleString()}`);
        if (label) void useEditorStore.getState().checkpoint(label);
      }} />
      {notice ? <p className="border-b border-accent/30 bg-accent/10 px-4 py-1 text-xs text-accent">{notice}</p> : null}
      <div className="flex min-h-0 flex-1">
        <AssetPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <Preview draft={draft} videoRef={videoRef} seek={seek} playing={playing} toggle={() => void toggle()} />
          <Timeline seek={seek} />
        </div>
        <Properties />
      </div>
    </div>
  );
}
