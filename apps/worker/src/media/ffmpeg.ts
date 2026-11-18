import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
}

function parseRate(rate?: string | null): number | null {
  if (!rate || rate === '0/0' || rate === 'N/A') return null;
  if (rate.includes('/')) {
    const [a, b] = rate.split('/').map(Number);
    if (!a || !b) return null;
    return Math.round((a / b) * 10000) / 10000;
  }
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null;
}

export async function logMediaToolVersions(log: Logger): Promise<void> {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      const { stdout } = await execFileAsync(tool, ['-version']);
      log.info({ tool, version: stdout.split('\n')[0]?.trim() }, 'media tool available');
    } catch {
      log.warn({ tool }, 'media tool not found on PATH; media processing will fail');
    }
  }
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { maxBuffer: 10 * 1024 * 1024 });
  const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = data.format?.duration ? Number(data.format.duration) : null;
  const width = typeof video?.width === 'number' ? (video.width as number) : null;
  const height = typeof video?.height === 'number' ? (video.height as number) : null;
  const sampleRate = audio?.sample_rate ? Number(audio.sample_rate) : null;
  return {
    durationSeconds: duration != null && Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
    width,
    height,
    frameRate: parseRate((video?.avg_frame_rate as string) || (video?.r_frame_rate as string)),
    videoCodec: typeof video?.codec_name === 'string' ? (video.codec_name as string) : null,
    audioCodec: typeof audio?.codec_name === 'string' ? (audio.codec_name as string) : null,
    audioChannels: typeof audio?.channels === 'number' ? (audio.channels as number) : null,
    audioSampleRate: sampleRate != null && Number.isFinite(sampleRate) ? sampleRate : null,
  };
}

export async function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  // 16kHz mono WAV suitable for transcription; idempotent if caller overwrites temp output.
  await execFileAsync('ffmpeg', [
    '-y', '-i', inputPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', outputPath,
  ], { maxBuffer: 20 * 1024 * 1024 });
}

export async function generateThumbnail(inputPath: string, outputPath: string): Promise<void> {
  // Try a small seek; fall back to first frame if seek fails.
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-ss', '00:00:01', '-i', inputPath, '-frames:v', '1', '-q:v', '3', outputPath,
    ], { maxBuffer: 20 * 1024 * 1024 });
  } catch {
    await execFileAsync('ffmpeg', [
      '-y', '-i', inputPath, '-frames:v', '1', '-q:v', '3', outputPath,
    ], { maxBuffer: 20 * 1024 * 1024 });
  }
}

export async function generateWaveform(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y', '-i', inputPath,
    '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x240:colors=#2563eb',
    '-frames:v', '1', outputPath,
  ], { maxBuffer: 20 * 1024 * 1024 });
}
