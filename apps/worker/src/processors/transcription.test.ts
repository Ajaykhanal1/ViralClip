import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSegments } from './transcription.js';

test('invalid AI segments are dropped or clamped to the source duration', () => {
  const result = normalizeSegments(
    [
      { startMs: 1000, endMs: 2000, text: 'valid' },
      { startMs: -500, endMs: 1500, text: 'negative start' },
      { startMs: 9000, endMs: 12000, text: 'past the end' },
      { startMs: 3000, endMs: 2500, text: 'inverted' },
      { startMs: 4000, endMs: 5000, text: '   ' },
      { text: 'missing timestamps' },
    ],
    10,
  );

  assert.deepEqual(result.map((segment) => segment.text), [
    'valid', 'negative start', 'past the end', 'inverted', 'missing timestamps',
  ]);
  assert.equal(result[0]!.startMs, 1000);
  assert.equal(result[1]!.startMs, 0);
  assert.equal(result[2]!.endMs, 10_000);
  assert.equal(result[3]!.startMs, 2500);
  assert.equal(result[3]!.endMs, 3000);
  assert.ok(result.every((segment) => segment.endMs <= 10_000));
});

test('non-array and malformed AI responses produce no segments', () => {
  assert.deepEqual(normalizeSegments(undefined, null), []);
  assert.deepEqual(normalizeSegments({ nope: true } as never, null), []);
  assert.deepEqual(normalizeSegments([{}, null] as never, null), []);
});

test('word timestamps stay inside their segment', () => {
  const [segment] = normalizeSegments(
    [{ startMs: 1000, endMs: 2000, text: 'hello world', words: [
      { startMs: 500, endMs: 9000, text: 'hello' },
      { startMs: 1800, endMs: 2200, text: 'world' },
    ] }],
    3,
  );
  assert.equal(segment!.words!.length, 2);
  assert.equal(segment!.words![0]!.startMs, 1000);
  assert.equal(segment!.words![0]!.endMs, 2000);
  assert.equal(segment!.words![1]!.endMs, 2000);
});
