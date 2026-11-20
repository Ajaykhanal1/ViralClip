import type { ClipEdit, EditorTimeline, TimelineClip } from '@viralclip/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/editor-api', () => ({
  save: vi.fn(), createVersion: vi.fn(), restoreVersion: vi.fn(), requestExport: vi.fn(),
  mediaUrl: vi.fn(), message: (error: unknown) => String(error),
}));

import { useEditorStore } from '@/store/editor-store';

const clip: TimelineClip = {
  id: 'clip-1', trackId: 'track-1', assetId: null, label: 'Segment',
  sourceStartMs: 0, sourceEndMs: 6000, startMs: 1000, durationMs: 6000,
  cropX: 0, cropY: 0, zoom: 1, rotation: 0, speed: 1,
  volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, transitionMs: 0,
};
const timeline: EditorTimeline = {
  tracks: [{ id: 'track-1', kind: 'video', name: 'Video', visible: true, locked: false, clips: [clip] }],
  subtitles: [], texts: [],
  settings: { width: 1080, height: 1920, snapMs: 100, timelineZoom: 1 },
};
const edit: ClipEdit = {
  id: 7, userId: 1, draftId: 2, projectId: 3, sourceVideoId: 4,
  timeline, version: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const initial = useEditorStore.getState();

describe('editor interactions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState(initial, true);
    useEditorStore.getState().hydrate(edit, [], []);
  });

  it('tracks changes and restores them with undo/redo', () => {
    useEditorStore.getState().patchClip('track-1', 'clip-1', { startMs: 2500 });
    expect(useEditorStore.getState().timeline.tracks[0]!.clips[0]!.startMs).toBe(2500);
    expect(useEditorStore.getState().dirty).toBe(true);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().timeline.tracks[0]!.clips[0]!.startMs).toBe(1000);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().timeline.tracks[0]!.clips[0]!.startMs).toBe(2500);
  });

  it('splits a selected clip into two adjacent clips', () => {
    useEditorStore.getState().select({ kind: 'clip', trackId: 'track-1', clipId: 'clip-1' });
    useEditorStore.getState().splitSelected();
    const clips = useEditorStore.getState().timeline.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.durationMs + clips[1]!.durationMs).toBe(6000);
    expect(clips[1]!.startMs).toBe(4000);
  });

  it('refuses edits on a locked track', () => {
    useEditorStore.getState().toggleTrack('track-1', 'locked');
    useEditorStore.getState().select({ kind: 'clip', trackId: 'track-1', clipId: 'clip-1' });
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().timeline.tracks[0]!.clips).toHaveLength(1);
  });

  it('adds and selects a text overlay at the playhead', () => {
    useEditorStore.getState().setCurrentMs(5000);
    useEditorStore.getState().addText();
    const state = useEditorStore.getState();
    expect(state.timeline.texts).toHaveLength(1);
    expect(state.timeline.texts[0]!.startMs).toBe(5000);
    expect(state.selection?.kind).toBe('text');
  });
});
