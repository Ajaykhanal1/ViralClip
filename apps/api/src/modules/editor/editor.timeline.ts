import type { EditorTimeline } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';

/** Guards structured timeline JSON before it is persisted or rendered. */
export function validateTimeline(timeline: EditorTimeline, durationMs: number): void {
  const seenTracks = new Set<string>();
  for (const track of timeline.tracks) {
    if (seenTracks.has(track.id)) throw new AppError(400, 'DUPLICATE_TRACK', `Duplicate track id ${track.id}`);
    seenTracks.add(track.id);
    if (track.kind !== 'video' && track.kind !== 'audio') continue;
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < sorted.length; i += 1) {
      const clip = sorted[i];
      if (clip.sourceEndMs <= clip.sourceStartMs) throw new AppError(400, 'INVALID_CLIP_TRIM', 'Clip source end must follow start');
      if (clip.durationMs <= 0 || clip.startMs < 0 || clip.startMs + clip.durationMs > durationMs + 100) {
        throw new AppError(400, 'INVALID_CLIP_TIMING', 'Clips must stay inside the draft duration');
      }
      const next = sorted[i + 1];
      if (next && clip.startMs + clip.durationMs > next.startMs + 100) {
        throw new AppError(400, 'CLIP_OVERLAP', 'Clips on a track cannot overlap');
      }
    }
  }
  for (const cue of timeline.subtitles) {
    if (cue.endMs <= cue.startMs || cue.endMs > durationMs + 100) {
      throw new AppError(400, 'INVALID_SUBTITLE_TIMING', 'Subtitle timing is outside the draft');
    }
  }
  for (const text of timeline.texts) {
    if (text.endMs <= text.startMs || text.endMs > durationMs + 100) {
      throw new AppError(400, 'INVALID_TEXT_TIMING', 'Text overlay timing is outside the draft');
    }
  }
}
