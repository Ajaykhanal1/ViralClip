import { QUEUE_NAMES } from '@viralclip/shared';
import type { SubtitleSegment, SubtitleTrack } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import * as processing from '../processing/processing.service.js';
import * as repo from './subtitles.repository.js';

function assertOwnedSource(userId: number, source: { userId: number } | null) {
  if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', 'Source video not found');
}

function validateAndNormalizeSegments(
  segments: Array<{ startMs: number; endMs: number; text: string; speaker?: string | null }>,
  durationMs: number | null,
) {
  const max = durationMs ?? Number.MAX_SAFE_INTEGER;
  const out = segments
    .map((s) => {
      let startMs = Math.max(0, Math.min(max, Math.round(s.startMs)));
      let endMs = Math.max(0, Math.min(max, Math.round(s.endMs)));
      if (endMs < startMs) [startMs, endMs] = [endMs, startMs];
      return { startMs, endMs, text: String(s.text ?? ''), speaker: s.speaker ?? null };
    })
    .filter((s) => !(durationMs != null && s.startMs > durationMs));
  // keep order by start then end
  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return out;
}

function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }
function fmtSrt(ms: number) {
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000); const msr = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(msr).padStart(3, '0')}`;
}
function fmtVtt(ms: number) {
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000); const msr = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(msr).padStart(3, '0')}`;
}

export function toSrt(segments: SubtitleSegment[]): string {
  return segments.map((s, i) => `${i + 1}\n${fmtSrt(s.startMs)} --> ${fmtSrt(s.endMs)}\n${s.text}\n`).join('\n');
}
export function toVtt(segments: SubtitleSegment[]): string {
  const body = segments.map((s) => `${fmtVtt(s.startMs)} --> ${fmtVtt(s.endMs)}\n${s.text}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
export function toJson(track: SubtitleTrack): string {
  return JSON.stringify({
    track: { id: track.id, name: track.name, language: track.language, style: track.style },
    segments: (track.segments ?? []).map((s) => ({ index: s.segmentIndex, startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker })),
  }, null, 2);
}

export async function listForSource(userId: number, sourceVideoId: number) {
  const source = await repo.findSource(userId, sourceVideoId);
  assertOwnedSource(userId, source);
  const [transcripts, tracks] = await Promise.all([repo.listTranscripts(userId, sourceVideoId), repo.listTracks(userId, sourceVideoId)]);
  return { transcripts, tracks };
}

export async function getTrack(userId: number, trackId: number) {
  const track = await repo.getTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  return { track };
}

export async function getTranscript(userId: number, transcriptId: number) {
  const transcript = await repo.getTranscript(userId, transcriptId);
  if (!transcript) throw new AppError(404, 'TRANSCRIPT_NOT_FOUND', 'Transcript not found');
  return { transcript };
}

export async function updateTrack(userId: number, trackId: number, patch: { name?: string; language?: string | null; style?: any }) {
  const track = await repo.findTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  await repo.updateTrack(trackId, userId, patch);
  return getTrack(userId, trackId);
}

export async function replaceSegments(userId: number, trackId: number, segments: Array<{ startMs: number; endMs: number; text: string; speaker?: string | null }>) {
  const track = await repo.findTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  const durationMs = await repo.getSourceDurationMs(track.sourceVideoId);
  const normalized = validateAndNormalizeSegments(segments, durationMs);
  await repo.replaceSegments(trackId, normalized);
  return getTrack(userId, trackId);
}

export async function updateSegment(userId: number, trackId: number, segmentIndex: number, patch: { startMs?: number; endMs?: number; text?: string; speaker?: string | null }) {
  const track = await repo.getTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  const segs = [...(track.segments ?? [])];
  const idx = segs.findIndex((s) => s.segmentIndex === segmentIndex);
  if (idx < 0) throw new AppError(404, 'SUBTITLE_SEGMENT_NOT_FOUND', 'Subtitle segment not found');
  const cur = segs[idx]!;
  segs[idx] = { ...cur, ...patch, speaker: patch.speaker !== undefined ? (patch.speaker ?? null) : cur.speaker } as any;
  return replaceSegments(userId, trackId, segs.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker })));
}

export async function deleteSegment(userId: number, trackId: number, segmentIndex: number) {
  const track = await repo.getTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  const segs = (track.segments ?? []).filter((s) => s.segmentIndex !== segmentIndex);
  return replaceSegments(userId, trackId, segs.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker })));
}

export async function splitSegment(userId: number, trackId: number, segmentIndex: number, opts: { atMs?: number; textOffset?: number }) {
  const track = await repo.getTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  const segs = [...(track.segments ?? [])];
  const idx = segs.findIndex((s) => s.segmentIndex === segmentIndex);
  if (idx < 0) throw new AppError(404, 'SUBTITLE_SEGMENT_NOT_FOUND', 'Subtitle segment not found');
  const s = segs[idx]!;
  const mid = Math.floor((s.startMs + s.endMs) / 2);
  let splitMs = opts.atMs != null ? Math.round(opts.atMs) : mid;
  if (splitMs <= s.startMs) splitMs = Math.min(s.endMs - 1, s.startMs + 1);
  if (splitMs >= s.endMs) splitMs = Math.max(s.startMs + 1, s.endMs - 1);
  let leftText = s.text;
  let rightText = '';
  if (opts.textOffset != null) {
    const off = Math.max(1, Math.min(s.text.length - 1, Math.round(opts.textOffset)));
    leftText = s.text.slice(0, off).trimEnd();
    rightText = s.text.slice(off).trimStart();
  } else {
    const words = s.text.trim().split(/\s+/);
    if (words.length > 1) {
      const half = Math.ceil(words.length / 2);
      leftText = words.slice(0, half).join(' ');
      rightText = words.slice(half).join(' ');
    } else {
      // fallback: keep text on left, empty right avoided -> split by time only with same text split roughly
      leftText = s.text; rightText = s.text;
    }
  }
  if (!leftText || !rightText) {
    // ensure two valid segments
    leftText = s.text; rightText = s.text;
  }
  const left = { startMs: s.startMs, endMs: splitMs, text: leftText, speaker: s.speaker };
  const right = { startMs: splitMs, endMs: s.endMs, text: rightText, speaker: s.speaker };
  segs.splice(idx, 1, left as any, right as any);
  return replaceSegments(userId, trackId, segs.map((x) => ({ startMs: x.startMs, endMs: x.endMs, text: x.text, speaker: x.speaker })));
}

export async function mergeSegment(userId: number, trackId: number, segmentIndex: number, withWhich: 'next' | 'previous') {
  const track = await repo.getTrack(userId, trackId);
  if (!track) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  const segs = [...(track.segments ?? [])];
  const idx = segs.findIndex((s) => s.segmentIndex === segmentIndex);
  if (idx < 0) throw new AppError(404, 'SUBTITLE_SEGMENT_NOT_FOUND', 'Subtitle segment not found');
  const j = withWhich === 'next' ? idx + 1 : idx - 1;
  if (j < 0 || j >= segs.length) throw new AppError(400, 'INVALID_MERGE', 'No adjacent segment to merge');
  const a = segs[Math.min(idx, j)]!;
  const b = segs[Math.max(idx, j)]!;
  const merged = { startMs: Math.min(a.startMs, b.startMs), endMs: Math.max(a.endMs, b.endMs), text: `${a.text} ${b.text}`.trim(), speaker: a.speaker ?? b.speaker };
  segs.splice(Math.min(idx, j), 2, merged as any);
  return replaceSegments(userId, trackId, segs.map((x) => ({ startMs: x.startMs, endMs: x.endMs, text: x.text, speaker: x.speaker })));
}

export async function exportTrack(userId: number, trackId: number, format: 'srt' | 'vtt' | 'json') {
  const { track } = await getTrack(userId, trackId);
  const segments = track.segments ?? [];
  if (format === 'srt') return { content: toSrt(segments), contentType: 'application/x-subrip; charset=utf-8', filename: `track-${trackId}.srt` };
  if (format === 'vtt') return { content: toVtt(segments), contentType: 'text/vtt; charset=utf-8', filename: `track-${trackId}.vtt` };
  return { content: toJson(track), contentType: 'application/json; charset=utf-8', filename: `track-${trackId}.json` };
}

export async function requestTranscription(userId: number, input: { sourceVideoId: number; language?: string | null; translateToEnglish?: boolean; targetTrackId?: number | null; regenerate?: boolean }) {
  const source = await repo.findSource(userId, input.sourceVideoId);
  assertOwnedSource(userId, source);
  if (input.targetTrackId) {
    const t = await repo.findTrack(userId, input.targetTrackId);
    if (!t || t.sourceVideoId !== input.sourceVideoId) throw new AppError(404, 'SUBTITLE_TRACK_NOT_FOUND', 'Subtitle track not found');
  }
  const job = await processing.createJobForSource({
    userId,
    projectId: source!.projectId,
    sourceVideoId: input.sourceVideoId,
    queueName: QUEUE_NAMES.transcription,
    jobType: input.translateToEnglish ? 'subtitle-translation' : (input.regenerate ? 'subtitle-regeneration' : 'transcription'),
    payload: {
      language: input.language ?? null,
      translateToEnglish: !!input.translateToEnglish,
      targetTrackId: input.targetTrackId ?? null,
      regenerate: !!input.regenerate || !!input.targetTrackId,
    },
  });
  return { job };
}
