import { create } from 'zustand';
import type {
  ClipEdit,
  EditVersion,
  EditorAsset,
  EditorCue,
  EditorTextOverlay,
  EditorTimeline,
  EditorTrack,
  TimelineClip,
} from '@viralclip/shared';
import * as api from '@/lib/editor-api';

export type Selection =
  | { kind: 'clip'; trackId: string; clipId: string }
  | { kind: 'cue'; id: string }
  | { kind: 'text'; id: string }
  | null;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function newId(prefix: string): string {
  return `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
}

function makeClip(trackId: string, assetId: number | null, label: string, startMs: number, durationMs: number): TimelineClip {
  return {
    id: newId('clip'), trackId, assetId, label,
    sourceStartMs: 0, sourceEndMs: durationMs, startMs, durationMs,
    cropX: 0, cropY: 0, zoom: 1, rotation: 0, speed: 1,
    volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, transitionMs: 0,
  };
}

function mapClip(timeline: EditorTimeline, trackId: string, clipId: string, patch: Partial<TimelineClip>): EditorTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id !== trackId ? track : { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)) },
    ),
  };
}

export interface EditorStore {
  edit: ClipEdit | null;
  timeline: EditorTimeline;
  versions: EditVersion[];
  assets: EditorAsset[];
  selection: Selection;
  currentMs: number;
  past: EditorTimeline[];
  future: EditorTimeline[];
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  error: string | null;
  notice: string | null;

  hydrate(edit: ClipEdit, versions: EditVersion[], assets: EditorAsset[]): void;
  commit(next: EditorTimeline): void;
  transient(next: EditorTimeline): void;
  remember(snapshot: EditorTimeline): void;
  patchSettings(patch: Partial<EditorTimeline['settings']>): void;
  undo(): void;
  redo(): void;
  saveNow(): Promise<void>;
  checkpoint(label: string): Promise<void>;
  restore(versionId: number): Promise<void>;
  exportEdit(): Promise<void>;
  select(selection: Selection): void;
  setCurrentMs(ms: number): void;
  setNotice(notice: string | null): void;
  patchClip(trackId: string, clipId: string, patch: Partial<TimelineClip>): void;
  patchCue(id: string, patch: Partial<EditorCue>): void;
  patchText(id: string, patch: Partial<EditorTextOverlay>): void;
  splitSelected(): void;
  mergeSelected(): void;
  deleteSelected(): void;
  addText(): void;
  addCue(): void;
  addAudioAsset(rightsId: number, label: string): Promise<void>;
  deleteAsset(assetId: number): Promise<void>;
  toggleTrack(trackId: string, field: 'visible' | 'locked'): void;
}

const blank: EditorTimeline = {
  tracks: [],
  subtitles: [],
  texts: [],
  settings: { width: 1080, height: 1920, snapMs: 100, timelineZoom: 1 },
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  edit: null,
  timeline: blank,
  versions: [],
  assets: [],
  selection: null,
  currentMs: 0,
  past: [],
  future: [],
  dirty: false,
  saving: false,
  savedAt: null,
  error: null,
  notice: null,

  hydrate(edit, versions, assets) {
    clearTimeout(saveTimer);
    set({
      edit, timeline: edit.timeline, versions, assets,
      selection: null, currentMs: 0, past: [], future: [],
      dirty: false, savedAt: new Date().toISOString(), error: null,
    });
  },

  commit(next) {
    clearTimeout(saveTimer);
    set((state) => ({ past: [...state.past.slice(-49), state.timeline], timeline: next, future: [], dirty: true }));
    if (get().edit) saveTimer = setTimeout(() => void get().saveNow(), 1200);
  },

  transient(next) {
    set({ timeline: next, dirty: true });
  },

  remember(snapshot) {
    set((state) => ({ past: [...state.past.slice(-49), snapshot], future: [], dirty: true }));
    if (get().edit) saveTimer = setTimeout(() => void get().saveNow(), 1200);
  },

  patchSettings(patch) {
    set((state) => ({ timeline: { ...state.timeline, settings: { ...state.timeline.settings, ...patch } }, dirty: true }));
    if (get().edit) saveTimer = setTimeout(() => void get().saveNow(), 1200);
  },

  undo() {
    clearTimeout(saveTimer);
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return {};
      return {
        past: state.past.slice(0, -1),
        timeline: previous,
        future: [state.timeline, ...state.future].slice(0, 50),
        dirty: true,
      };
    });
    if (get().edit) saveTimer = setTimeout(() => void get().saveNow(), 1200);
  },

  redo() {
    clearTimeout(saveTimer);
    set((state) => {
      const next = state.future[0];
      if (!next) return {};
      return {
        past: [...state.past, state.timeline].slice(-50),
        timeline: next,
        future: state.future.slice(1),
        dirty: true,
      };
    });
    if (get().edit) saveTimer = setTimeout(() => void get().saveNow(), 1200);
  },

  async saveNow() {
    const { edit, timeline, saving, dirty } = get();
    if (!edit || saving || !dirty) return;
    set({ saving: true, error: null });
    try {
      const { edit: updated } = await api.save(edit.id, timeline);
      set({ edit: updated, saving: false, dirty: false, savedAt: new Date().toISOString() });
    } catch (error) {
      set({ saving: false, error: api.message(error) });
    }
  },

  async checkpoint(label) {
    await get().saveNow();
    const { edit } = get();
    if (!edit) return;
    try {
      const result = await api.createVersion(edit.id, label);
      set((state) => ({ versions: [result.version, ...state.versions], edit: result.edit, notice: `Version ${result.version.version} saved` }));
    } catch (error) {
      set({ error: api.message(error) });
    }
  },

  async restore(versionId) {
    const { edit } = get();
    if (!edit) return;
    try {
      const result = await api.restoreVersion(edit.id, versionId);
      get().hydrate(result.edit, get().versions, get().assets);
      set({ notice: 'Version restored' });
    } catch (error) {
      set({ error: api.message(error) });
    }
  },

  async exportEdit() {
    await get().saveNow();
    const { edit } = get();
    if (!edit) return;
    try {
      const { job } = await api.requestExport(edit.id);
      set({ notice: `Export queued (job #${job.id})` });
      window.location.assign(`/render?editId=${edit.id}`);
    } catch (error) {
      set({ error: api.message(error) });
    }
  },

  select(selection) { set({ selection }); },
  setCurrentMs(currentMs) { set({ currentMs }); },
  setNotice(notice) { set({ notice }); },

  patchClip(trackId, clipId, patch) { get().commit(mapClip(get().timeline, trackId, clipId, patch)); },

  patchCue(id, patch) {
    const timeline = get().timeline;
    get().commit({ ...timeline, subtitles: timeline.subtitles.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)) });
  },

  patchText(id, patch) {
    const timeline = get().timeline;
    get().commit({ ...timeline, texts: timeline.texts.map((text) => (text.id === id ? { ...text, ...patch } : text)) });
  },

  splitSelected() {
    const { selection, timeline } = get();
    if (selection?.kind !== 'clip') return;
    const track = timeline.tracks.find((item) => item.id === selection.trackId);
    const clip = track?.clips.find((item) => item.id === selection.clipId);
    if (!track || !clip || track.locked) return;
    const half = Math.max(1, Math.round(clip.durationMs / 2));
    const first = { ...clip, durationMs: half, sourceEndMs: clip.sourceStartMs + half };
    const second = {
      ...clip, id: newId('clip'), startMs: clip.startMs + half,
      sourceStartMs: clip.sourceStartMs + half, durationMs: clip.durationMs - half,
    };
    get().commit({
      ...timeline,
      tracks: timeline.tracks.map((item) =>
        item.id !== track.id ? item : {
          ...item,
          clips: item.clips.flatMap((existing) => (existing.id === clip.id ? [first, second] : [existing])).sort((a, b) => a.startMs - b.startMs),
        },
      ),
    });
    get().select({ kind: 'clip', trackId: track.id, clipId: second.id });
  },

  mergeSelected() {
    const { selection, timeline } = get();
    if (selection?.kind !== 'clip') return;
    const track = timeline.tracks.find((item) => item.id === selection.trackId);
    const clip = track?.clips.find((item) => item.id === selection.clipId);
    if (!track || !clip || track.locked) return;
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    const next = sorted[sorted.findIndex((item) => item.id === clip.id) + 1];
    if (!next) return;
    const merged = {
      ...clip,
      durationMs: next.startMs + next.durationMs - clip.startMs,
      sourceEndMs: next.sourceEndMs,
    };
    get().commit({
      ...timeline,
      tracks: timeline.tracks.map((item) =>
        item.id !== track.id ? item : {
          ...item, clips: [...item.clips.filter((c) => c.id !== clip.id && c.id !== next.id), merged].sort((a, b) => a.startMs - b.startMs),
        },
      ),
    });
  },

  deleteSelected() {
    const { selection, timeline } = get();
    if (!selection) return;
    if (selection.kind === 'clip') {
      const track = timeline.tracks.find((item) => item.id === selection.trackId);
      if (!track || track.locked) return;
      get().commit({
        ...timeline,
        tracks: timeline.tracks.map((item) => (item.id !== track.id ? item : { ...item, clips: item.clips.filter((c) => c.id !== selection.clipId) })),
      });
    } else if (selection.kind === 'cue') {
      get().commit({ ...timeline, subtitles: timeline.subtitles.filter((cue) => cue.id !== selection.id) });
    } else {
      get().commit({ ...timeline, texts: timeline.texts.filter((text) => text.id !== selection.id) });
    }
    get().select(null);
  },

  addText() {
    const { currentMs, timeline } = get();
    const overlay: EditorTextOverlay = {
      id: newId('text'), startMs: currentMs, endMs: currentMs + 2000,
      text: 'New text', x: 0.5, y: 0.5, fontSize: 56, color: '#FFFFFF', animation: 'fade',
    };
    get().commit({ ...timeline, texts: [...timeline.texts, overlay] });
    get().select({ kind: 'text', id: overlay.id });
  },

  addCue() {
    const { currentMs, timeline } = get();
    const cue: EditorCue = {
      id: newId('cue'), startMs: currentMs, endMs: currentMs + 2000, text: 'New subtitle',
      style: { fontFamily: 'Arial', fontSize: 48, textColor: '#FFFFFF', position: 'bottom', alignment: 'center', highlightedWords: true },
    };
    get().commit({ ...timeline, subtitles: [...timeline.subtitles, cue] });
    get().select({ kind: 'cue', id: cue.id });
  },

  async addAudioAsset(rightsId, label) {
    const { edit, timeline, currentMs } = get();
    if (!edit) return;
    try {
      const { asset } = await api.addAsset(edit.id, { kind: 'audio', label, rightsId });
      let tracks: EditorTrack[] = timeline.tracks;
      const existing = tracks.find((track) => track.kind === 'audio');
      if (existing) {
        tracks = tracks.map((track) => (track.id === existing.id ? { ...track, clips: [...track.clips, makeClip(track.id, asset.id, label, currentMs, 5000)] } : track));
      } else {
        const track: EditorTrack = { id: newId('track'), kind: 'audio', name: 'Authorized audio', visible: true, locked: false, clips: [] };
        track.clips.push(makeClip(track.id, asset.id, label, currentMs, 5000));
        tracks = [...tracks, track];
      }
      set((state) => ({ assets: [asset, ...state.assets] }));
      get().commit({ ...timeline, tracks });
    } catch (error) {
      set({ error: api.message(error) });
    }
  },

  async deleteAsset(assetId) {
    const { edit, timeline } = get();
    if (!edit) return;
    try {
      await api.removeAsset(edit.id, assetId);
      set((state) => ({ assets: state.assets.filter((asset) => asset.id !== assetId) }));
      get().commit({
        ...timeline,
        tracks: timeline.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.assetId !== assetId) })),
      });
    } catch (error) {
      set({ error: api.message(error) });
    }
  },

  toggleTrack(trackId, field) {
    const timeline = get().timeline;
    get().commit({
      ...timeline,
      tracks: timeline.tracks.map((track) => (track.id === trackId ? { ...track, [field]: !track[field] } : track)),
    });
  },
}));
