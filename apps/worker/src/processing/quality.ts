import { open, stat } from 'node:fs/promises';
import type { RenderQuality } from '@viralclip/shared';
import { probeMedia } from '../media/ffmpeg.js';

export interface RenderFileInfo {
  fileExists: boolean;
  readable: boolean;
  fileSize: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
}

export interface QualityExpectation {
  width: number;
  height: number;
  durationMs: number;
  expectAudio: boolean;
}

/** Pure quality gate. All thresholds are explicit so results are reproducible in tests. */
export function validateRenderQuality(info: RenderFileInfo, expected: QualityExpectation): RenderQuality {
  const reasons: string[] = [];
  const fileExists = info.fileExists && info.fileSize > 0;
  if (!fileExists) reasons.push('output file is missing or empty');
  if (!info.readable) reasons.push('output file is not readable');

  const correctDimensions = info.width === expected.width && info.height === expected.height;
  if (!correctDimensions) reasons.push(`dimensions ${info.width ?? '?'}x${info.height ?? '?'} do not match ${expected.width}x${expected.height}`);

  const ratio = info.width && info.height ? info.width / info.height : 0;
  const correctAspectRatio = Math.abs(ratio - 9 / 16) <= 0.01;
  if (!correctAspectRatio) reasons.push('aspect ratio is not 9:16');

  const audioPresent = !!info.audioCodec && info.audioCodec !== 'none';
  if (expected.expectAudio && !audioPresent) reasons.push('expected audio track is missing');

  const toleranceMs = Math.max(1000, expected.durationMs * 0.1);
  const durationValid = info.durationSeconds != null
    && Math.abs(info.durationSeconds * 1000 - expected.durationMs) <= toleranceMs;
  if (!durationValid) reasons.push(`duration ${info.durationSeconds ?? '?'}s is outside the expected window`);

  const videoOk = !!info.videoCodec && info.videoCodec !== 'none';
  if (!videoOk) reasons.push('video stream is missing');

  return {
    fileExists, readable: info.readable, correctAspectRatio, correctDimensions,
    audioPresent, durationValid,
    ok: fileExists && info.readable && correctDimensions && correctAspectRatio && durationValid && videoOk
      && (!expected.expectAudio || audioPresent),
    reasons,
  };
}

/** Reads a byte and probes the rendered file; probe failures become validation reasons. */
export async function inspectRenderedFile(path: string): Promise<RenderFileInfo> {
  let fileExists = false;
  let readable = false;
  let fileSize = 0;
  try {
    const stats = await stat(path);
    fileExists = stats.isFile();
    fileSize = stats.size;
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(1);
      await handle.read(buffer, 0, 1, 0);
      readable = true;
    } finally {
      await handle.close();
    }
  } catch {
    // Reported through the pure validator.
  }

  let probe: Awaited<ReturnType<typeof probeMedia>> | null = null;
  try {
    probe = await probeMedia(path);
  } catch {
    // Reported through the pure validator.
  }
  return {
    fileExists, readable, fileSize,
    width: probe?.width ?? null,
    height: probe?.height ?? null,
    videoCodec: probe?.videoCodec ?? null,
    audioCodec: probe?.audioCodec ?? null,
    durationSeconds: probe?.durationSeconds ?? null,
  };
}
