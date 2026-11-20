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
    width: 'trunc(min(iw\\,ih*9/16)/2)*2',
    height: 'trunc(min(ih\\,ow*16/9)/2)*2',
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
  x?: number;
  y?: number;
  fontSize?: number;
  color?: string;
}

export function buildTextFilter(overlay: TextOverlay): string | null {
  if (!overlay.text || overlay.seconds <= 0) return null;
  const x = overlay.x === undefined ? '(w-tw)/2' : `w*${round(overlay.x)}-tw/2`;
  const y = overlay.y === undefined ? 'h/2' : `h*${round(overlay.y)}`;
  return [
    `drawtext=textfile=${overlay.file}`,
    'expansion=none',
    `fontsize=${Math.round(overlay.fontSize ?? 56)}`,
    `fontcolor=${overlay.color ?? 'white'}`,
    `x=${x}`,
    `y=${y}`,
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
    `crop=${input.crop.width}:${input.crop.height}:x=${input.crop.x}:y=${input.crop.y}`,
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

export interface EditedClipInput {
  inputPath: string;
  sourceStartMs: number;
  durationMs: number;
  cropX: number;
  cropY: number;
  zoom: number;
  rotation: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  transitionMs: number;
}

function seconds(ms: number): string {
  return String(Math.round((ms / 1000) * 10000) / 10000);
}

function clipVideoFilter(clip: EditedClipInput, width: number, height: number, index: number): string {
  const crop = planCrop('center', clip.cropX, clip.cropY);
  const parts = [
    `fps=30`,
    `setpts=PTS/${round(Math.max(0.25, clip.speed))}`,
  ];
  if (clip.rotation) parts.push(`rotate=${round((clip.rotation * Math.PI) / 180)}:ow=iw:oh=ih`);
  const zoom = Math.max(0.5, Math.min(4, clip.zoom));
  if (zoom !== 1) parts.push(`scale=iw*${round(zoom)}:ih*${round(zoom)}`);
  parts.push(
    `crop=${crop.width}:${crop.height}:x=${crop.x}:y=${crop.y}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    'setsar=1',
  );
  const fadeIn = Math.max(clip.fadeInMs, clip.transitionMs);
  const fadeOut = Math.max(clip.fadeOutMs, clip.transitionMs);
  if (fadeIn > 0) parts.push(`fade=t=in:st=0:d=${seconds(fadeIn)}`);
  if (fadeOut > 0) parts.push(`fade=t=out:st=${seconds(Math.max(0, clip.durationMs - fadeOut))}:d=${seconds(fadeOut)}`);
  parts.push('format=yuv420p');
  return `[${index}:v]${parts.join(',')}[v${index}]`;
}

/** atempo only accepts 0.5..2; chain filters for wider editor speeds. */
function atempoFilter(speed: number): string {
  let remaining = Math.max(0.25, Math.min(4, speed));
  const parts: string[] = [];
  while (remaining > 2) { parts.push('atempo=2'); remaining /= 2; }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining *= 2; }
  parts.push(`atempo=${round(remaining)}`);
  return parts.join(',');
}

function clipAudioFilter(clip: EditedClipInput, index: number): string {
  const parts = ['asetpts=PTS-STARTPTS', atempoFilter(clip.speed)];
  parts.push(`volume=${clip.muted ? 0 : round(clip.volume)}`);
  if (clip.fadeInMs > 0) parts.push(`afade=t=in:st=0:d=${seconds(clip.fadeInMs)}`);
  if (clip.fadeOutMs > 0) parts.push(`afade=t=out:st=${seconds(Math.max(0, clip.durationMs - clip.fadeOutMs))}:d=${seconds(clip.fadeOutMs)}`);
  return `[${index}:a]${parts.join(',')}[a${index}]`;
}

/** Authorized audio asset placed on an audio track, mixed over the video's own audio. */
export interface EditedAudioInput {
  inputPath: string;
  sourceStartMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

/** Renders a non-destructive editor timeline. Transitions use clip fades where xfade is unsupported. */
export function buildEditedRenderArgs(input: {
  clips: EditedClipInput[];
  audioClips?: EditedAudioInput[];
  outputPath: string;
  width: number;
  height: number;
  subtitleFilter: string | null;
  overlays: Array<string | null>;
}): string[] {
  if (input.clips.length === 0) throw new Error('Timeline has no video clips');
  const args: string[] = ['-y'];
  const filters: string[] = [];
  for (const [index, clip] of input.clips.entries()) {
    const inputSeconds = seconds(clip.durationMs * Math.max(0.25, clip.speed));
    args.push('-ss', seconds(clip.sourceStartMs), '-t', inputSeconds, '-i', clip.inputPath);
    filters.push(clipVideoFilter(clip, input.width, input.height, index));
    filters.push(clipAudioFilter(clip, index));
  }
  const concatInputs = input.clips.flatMap((_, index) => `[v${index}][a${index}]`).join('');
  filters.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=1[vcat][acat]`);
  let current = 'vcat';
  for (const [step, overlay] of [...input.overlays, input.subtitleFilter].filter((item): item is string => !!item).entries()) {
    filters.push(`[${current}]${overlay}[tmp${step}]`);
    current = `tmp${step}`;
  }
  filters.push(`[${current}]format=yuv420p[vout]`);

  let audioOut = 'acat';
  const audioClips = input.audioClips ?? [];
  for (const [offset, audio] of audioClips.entries()) {
    const index = input.clips.length + offset;
    args.push('-ss', seconds(audio.sourceStartMs), '-t', seconds(audio.durationMs), '-i', audio.inputPath);
    const parts = ['asetpts=PTS-STARTPTS'];
    parts.push(`volume=${audio.muted ? 0 : round(audio.volume)}`);
    if (audio.fadeInMs > 0) parts.push(`afade=t=in:st=0:d=${seconds(audio.fadeInMs)}`);
    if (audio.fadeOutMs > 0) parts.push(`afade=t=out:st=${seconds(Math.max(0, audio.durationMs - audio.fadeOutMs))}:d=${seconds(audio.fadeOutMs)}`);
    const label = `ax${offset}`;
    filters.push(`[${index}:a]${parts.join(',')}[${label}]`);
    const next = `amix${offset}`;
    filters.push(`[${audioOut}][${label}]amix=inputs=2:duration=first[${next}]`);
    audioOut = next;
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', `[${audioOut}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-map_metadata', '0',
    input.outputPath,
  );
  return args;
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
