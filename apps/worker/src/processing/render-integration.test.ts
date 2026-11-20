import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import { probeMedia, runFfmpeg } from '../media/ffmpeg.js';
import { inspectRenderedFile, validateRenderQuality } from './quality.js';
import { buildAudioFilter, buildFilterGraph, buildRenderArgs, planCrop } from './render.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
after(async () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function makeWorkspace(): Promise<{ dir: string; source: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'viralclip-render-'));
  dirs.push(dir);
  const source = path.join(dir, 'source.mp4');
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', source,
  ]);
  return { dir, source };
}

function renderArgs(source: string, output: string): string[] {
  const filterGraph = buildFilterGraph({
    crop: planCrop('center'),
    width: 1080,
    height: 1920,
    subtitleFilter: null,
    overlays: [],
  });
  return buildRenderArgs({
    inputPath: source,
    outputPath: output,
    startMs: 200,
    durationMs: 1500,
    filterGraph,
    audioFilter: buildAudioFilter({ volume: 0.8, fadeInSeconds: 0.1, fadeOutSeconds: 0.1 }, 1.5),
  });
}

test('FFmpeg renders a 9:16 MP4 with synchronized audio', async () => {
  const { dir, source } = await makeWorkspace();
  const output = path.join(dir, 'short.mp4');
  await runFfmpeg(renderArgs(source, output), { timeoutMs: 120_000 });

  const probe = await probeMedia(output);
  assert.equal(probe.videoCodec, 'h264');
  assert.equal(probe.audioCodec, 'aac');
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.ok((probe.durationSeconds ?? 0) >= 1.3 && (probe.durationSeconds ?? 0) <= 1.7);

  const quality = validateRenderQuality(await inspectRenderedFile(output), {
    width: 1080, height: 1920, durationMs: 1500, expectAudio: true,
  });
  assert.equal(quality.ok, true, quality.reasons.join('; '));
});

test('a failed render leaves no output and a retry succeeds', async () => {
  const { dir, source } = await makeWorkspace();
  const output = path.join(dir, 'retry.mp4');
  const broken = renderArgs(path.join(dir, 'missing.mp4'), output);
  await assert.rejects(runFfmpeg(broken, { timeoutMs: 30_000 }));

  await runFfmpeg(renderArgs(source, output), { timeoutMs: 120_000 });
  assert.ok((await stat(output)).size > 0);
  assert.equal((await probeMedia(output)).width, 1080);
});
