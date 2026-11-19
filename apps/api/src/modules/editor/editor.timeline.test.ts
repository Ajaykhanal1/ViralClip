import assert from 'node:assert/strict';
import test from 'node:test';
import type { EditorTimeline, TimelineClip } from '@viralclip/shared';
import { validateTimeline } from './editor.timeline.js';

const clip = (id: string, startMs: number, durationMs: number): TimelineClip => ({
  id, trackId: 'video', assetId: null, label: id,
  sourceStartMs: startMs, sourceEndMs: startMs + durationMs,
  startMs, durationMs,
  cropX: 0, cropY: 0, zoom: 1, rotation: 0, speed: 1,
  volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, transitionMs: 0,
});

const timeline = (clips: TimelineClip[]): EditorTimeline => ({
  tracks: [{ id: 'video', kind: 'video', name: 'Video', visible: true, locked: false, clips }],
  subtitles: [],
  texts: [],
  settings: { width: 1080, height: 1920, snapMs: 100, timelineZoom: 1 },
});

test('validateTimeline accepts adjacent trimmed clips', () => {
  assert.doesNotThrow(() => validateTimeline(timeline([clip('a', 0, 2000), clip('b', 2000, 1000)]), 3000));
});

test('validateTimeline rejects overlapping clips and out-of-range timing', () => {
  assert.throws(() => validateTimeline(timeline([clip('a', 0, 2000), clip('b', 1000, 1000)]), 3000), /overlap/i);
  assert.throws(() => validateTimeline(timeline([clip('a', 0, 4000)]), 3000), /inside the draft/i);
  assert.throws(() => validateTimeline(timeline([{ ...clip('a', 0, 1000), sourceStartMs: 800, sourceEndMs: 500 }]), 3000), /source end/i);
});

test('validateTimeline rejects invalid cue and text timing', () => {
  const value = timeline([]);
  value.subtitles.push({ id: 'cue', startMs: 1000, endMs: 800, text: 'x', style: {} });
  assert.throws(() => validateTimeline(value, 3000), /subtitle timing/i);
  value.subtitles.length = 0;
  value.texts.push({ id: 't', startMs: 1000, endMs: 4000, text: 'x', x: 0.5, y: 0.5, fontSize: 30, color: '#fff', animation: 'none' });
  assert.throws(() => validateTimeline(value, 3000), /text overlay timing/i);
});
