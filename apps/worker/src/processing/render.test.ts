import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAudioFilter,
  buildClipSrt,
  buildFilterGraph,
  buildRenderArgs,
  buildSubtitleFilter,
  planCrop,
} from './render.js';

test('planCrop biases framing and keeps offsets inside the source', () => {
  const center = planCrop('center', 0, 0);
  assert.equal(center.offsetX, 0);
  assert.equal(center.offsetY, 0);
  const biased = planCrop('speaker', 1, 1, { speakerIndex: 0, speakerCount: 2 });
  assert.equal(biased.offsetX, 0.5);
  assert.equal(biased.offsetY, 1);
  const clamped = planCrop('smart', 4, -4, { activeX: 8 });
  assert.ok(clamped.offsetX >= -1 && clamped.offsetX <= 1);
  assert.ok(clamped.offsetY >= -1 && clamped.offsetY <= 1);
  assert.match(clamped.width, /iw/);
});

test('clip subtitles are relative to the clip and dropped outside it', () => {
  const srt = buildClipSrt([
    { startMs: 1000, endMs: 2500, text: 'one two three four five six' },
    { startMs: 9000, endMs: 11000, text: 'outside' },
  ], 1000, 3000, 5);
  assert.match(srt, /00:00:00,000 --> 00:00:01,500/);
  assert.doesNotMatch(srt, /outside/);
  assert.match(srt, /one two three four five/);
});

test('render args keep source metadata and emit MP4/H.264/AAC', () => {
  const args = buildRenderArgs({
    inputPath: 'in.mp4',
    outputPath: 'out.mp4',
    startMs: 2500,
    durationMs: 15000,
    filterGraph: '[0:v]crop=1080:1920[v]',
    audioFilter: 'volume=1',
  });
  assert.deepEqual(args.slice(1, 5), ['-ss', '2.5', '-i', 'in.mp4']);
  assert.ok(args.includes('-map_metadata'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('+faststart'));
  assert.equal(args.at(-1), 'out.mp4');
});

test('subtitle and audio filters honor configuration', () => {
  const none = buildSubtitleFilter({ enabled: false } as never);
  assert.equal(none, null);
  const filter = buildSubtitleFilter({
    enabled: true, position: 'top', fontSize: 40, textColor: '#112233',
    backgroundColor: 'rgba(0,0,0,0.6)', outlineColor: '#000000', maxWordsPerLine: 4, highlightKeywords: [],
  });
  assert.match(filter ?? '', /Alignment=8/);
  assert.match(filter ?? '', /&H00332211/);
  assert.match(buildAudioFilter({ volume: 1, fadeInSeconds: 0, fadeOutSeconds: 1 }, 10), /afade=t=out:st=9/);
  assert.match(
    buildFilterGraph({ crop: planCrop('center'), width: 1080, height: 1920, subtitleFilter: filter, overlays: [] }),
    /pad=1080:1920/,
  );
});
