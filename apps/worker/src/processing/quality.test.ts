import assert from 'node:assert/strict';
import test from 'node:test';
import type { RenderFileInfo, QualityExpectation } from './quality.js';
import { validateRenderQuality } from './quality.js';

const expected: QualityExpectation = { width: 1080, height: 1920, durationMs: 15000, expectAudio: true };
const good: RenderFileInfo = {
  fileExists: true, readable: true, fileSize: 2_000_000,
  width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac', durationSeconds: 15,
};

test('valid 1080x1920 MP4 with audio passes quality checks', () => {
  const result = validateRenderQuality(good, expected);
  assert.equal(result.ok, true);
  assert.equal(result.reasons.length, 0);
});

test('missing audio, wrong ratio, and bad duration are rejected', () => {
  const noAudio = validateRenderQuality({ ...good, audioCodec: null }, expected);
  assert.equal(noAudio.ok, false);
  assert.match(noAudio.reasons.join(' '), /audio track/);

  const wide = validateRenderQuality({ ...good, width: 1920, height: 1080 }, expected);
  assert.equal(wide.correctAspectRatio, false);
  assert.equal(wide.ok, false);

  const short = validateRenderQuality({ ...good, durationSeconds: 2 }, expected);
  assert.equal(short.durationValid, false);
});

test('empty or unreadable files never pass', () => {
  assert.equal(validateRenderQuality({ ...good, fileSize: 0 }, expected).ok, false);
  assert.equal(validateRenderQuality({ ...good, readable: false }, expected).ok, false);
});

test('audio is optional when no source audio is expected', () => {
  const result = validateRenderQuality({ ...good, audioCodec: null }, { ...expected, expectAudio: false });
  assert.equal(result.ok, true);
});
