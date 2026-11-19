import type { ShortFramingMode, SuggestedSubtitleConfig } from '@viralclip/shared';

export interface CropPlan {
  /** Expressions evaluated by FFmpeg against the source frame (iw/ih/ow/oh). */
  width: string;
  height: string;
  x: string;
  y: string;
  offsetX: number;
  offsetY: number;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(low, Math.min(high, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Center crop with optional content/speaker bias. User offsets are applied last. */
export function planCrop(
  framing: ShortFramingMode,
  cropX = 0,
  cropY = 0,
  cues: { activeX?: number; speakerIndex?: number; speakerCount?: number } = {},
): CropPlan {
  let bias = 0;
  if ((framing === 'smart' || framing === 'face') && cues.activeX !== undefined) {
    // Shortcut: smart/face framing uses the detected active region as a face proxy;
    // upgrade when a face detector is available. It never changes content, only crop.
    bias = clamp(cues.activeX, -1, 1) * 0.6;
  } else if (framing === 'speaker' && cues.speakerCount && cues.speakerCount > 1) {
    bias = clamp((2 * (cues.speakerIndex ?? 0)) / (cues.speakerCount - 1) - 1, -1, 1) * 0.5;
  }
  const offsetX = clamp(bias + cropX, -1, 1);
  const offsetY = clamp(cropY, -1, 1);
  return {
    width: 'trunc(min(iw,ih*9/16)/2)*2',
    height: 'trunc(min(ih,ow*16/9)/2)*2',
    x: `(iw-ow)/2+(${round(offsetX)})*(iw-ow)/2`,
    y: `(ih-oh)/2+(${round(offsetY)})*(ih-oh)/2`,
    offsetX,
    offsetY,
  };
}

function assColor(hex: string, alpha = '00'): string {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!value) return `&H${alpha}FFFFFF`;
  const rgb = value[1].toLowerCase();
  return `&H${alpha}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase();
}

export function buildSubtitleFilter(config: SuggestedSubtitleConfig | null): string | null {
  if (!config?.enabled) return null;
  const alignment = config.position === 'top' ? 8 : config.position === 'middle' ? 5 : 2;
  const outline = Math.max(0, Math.min(8, Math.round(config.fontSize / 12)));
  const style = [
    `Alignment=${alignment}`,
    `FontSize=${Math.round(config.fontSize)}`,
    `PrimaryColour=${assColor(config.textColor)}`,
    `OutlineColour=${assColor(config.outlineColor)}`,
    'BackColour=&H64000000',
    `Outline=${outline}`,
    'BorderStyle=3',
  ].join(',');
  return `subtitles=subs.srt:force_style='${style}'`;
}

export interface TextOverlay {
  text: string;
  seconds: number;
  file: string;
  enable: string;
}

export function buildTextFilter(overlay: TextOverlay): string | null {
  if (!overlay.text || overlay.seconds <= 0) return null;
  return [
    `drawtext=textfile=${overlay.file}`,
    'expansion=none',
    'fontsize=56',
    'fontcolor=white',
    'x=(w-tw)/2',
    'y=h/2',
    `enable='${overlay.enable}'`,
  ].join(':');
}

export function buildFilterGraph(input: {
  crop: CropPlan;
  width: number;
  height: number;
  subtitleFilter: string | null;
  overlays: Array<string | null>;
}): string {
  const parts = [
    `crop=${input.crop.width}:${input.crop.height}:x='${input.crop.x}':y='${input.crop.y}'`,
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease`,
    `pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2:black`,
    'setsar=1',
    ...input.overlays.filter((filter): filter is string => !!filter),
    ...(input.subtitleFilter ? [input.subtitleFilter] : []),
    'format=yuv420p',
  ];
  return `[0:v]${parts.join(',')}[v]`;
}

export function buildAudioFilter(config: {
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}, durationSeconds: number): string {
  const parts = [`volume=${round(clamp(config.volume, 0, 4))}`];
  if (config.fadeInSeconds > 0) parts.push(`afade=t=in:st=0:d=${round(config.fadeInSeconds)}`);
  if (config.fadeOutSeconds > 0) {
    parts.push(`afade=t=out:st=${round(Math.max(0, durationSeconds - config.fadeOutSeconds))}:d=${round(config.fadeOutSeconds)}`);
  }
  return parts.join(',');
}

export function buildRenderArgs(input: {
  inputPath: string;
  outputPath: string;
  startMs: number;
  durationMs: number;
  filterGraph: string;
  audioFilter: string;
}): string[] {
  return [
    '-y',
    '-ss', String(round(input.startMs / 1000)),
    '-i', input.inputPath,
    '-t', String(round(input.durationMs / 1000)),
    '-filter_complex', input.filterGraph,
    '-map', '[v]',
    '-map', '0:a?',
    '-af', input.audioFilter,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-map_metadata', '0',
    input.outputPath,
  ];
}

export interface SubtitleSegmentForRender {
  startMs: number;
  endMs: number;
  text: string;
}

function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(total % 1000).padStart(3, '0')}`;
}

/** SRT is written relative to the clip, never to the original source timeline. */
export function buildClipSrt(
  segments: SubtitleSegmentForRender[],
  startMs: number,
  endMs: number,
  maxWordsPerLine = 5,
): string {
  const blocks: string[] = [];
  let index = 1;
  for (const segment of segments) {
    const from = Math.max(startMs, segment.startMs);
    const to = Math.min(endMs, segment.endMs);
    if (to <= from) continue;
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    for (let i = 0; i < words.length; i += Math.max(1, maxWordsPerLine)) {
      lines.push(words.slice(i, i + Math.max(1, maxWordsPerLine)).join(' '));
    }
    if (lines.length === 0) continue;
    blocks.push(`${index++}\n${srtTime(from - startMs)} --> ${srtTime(to - startMs)}\n${lines.join('\n')}\n`);
  }
  return blocks.join('\n');
}
