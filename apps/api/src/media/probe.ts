import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = data.format?.duration ? Number(data.format.duration) : null;
  const width = typeof video?.width === 'number' ? video.width : null;
  const height = typeof video?.height === 'number' ? video.height : null;
  const sampleRate = audio?.sample_rate ? Number(audio.sample_rate) : null;

  return {
    durationSeconds: duration != null && Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
    width,
    height,
    frameRate: parseRate((video?.avg_frame_rate as string) || (video?.r_frame_rate as string)),
    videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : null,
    audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : null,
    audioChannels: typeof audio?.channels === 'number' ? audio.channels : null,
    audioSampleRate: sampleRate != null && Number.isFinite(sampleRate) ? sampleRate : null,
  };
}
