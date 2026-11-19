import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeClips } from './clips.js';

const base = {
  candidateId: 'clip-1',
  startMs: 0,
  endMs: 6000,
  durationMs: 6000,
  hookMs: 1000,
  transcript: 'A complete idea.',
  suggestedTitle: 'A complete idea',
  description: 'A short description.',
  engagementScore: 80,
  explanation: 'Heuristic explanation.',
  signals: {},
  subtitleConfig: {},
};

test('normalizeClips clamps timestamps to the actual source duration', () => {
  const clips = normalizeClips([{ ...base, startMs: -500, endMs: 99_000, hookMs: 99_000 }], 24_000);
  assert.equal(clips.length, 1);
  assert.equal(clips[0]?.startMs, 0);
  assert.equal(clips[0]?.endMs, 24_000);
  assert.equal(clips[0]?.durationMs, 24_000);
  assert.equal(clips[0]?.hookMs, 24_000);
});

test('normalizeClips drops unusable recommendations', () => {
  const clips = normalizeClips(
    [
      { ...base, startMs: 1000, endMs: 1000 },
      { ...base, candidateId: '' },
      { ...base, transcript: '' },
    ],
    24_000,
  );
  assert.equal(clips.length, 0);
});
