import type { Job } from 'bullmq';
import type { ProcessingJobPayload } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { appendLog, isCancelled, markJobRunning, setSourceStatus, updateJob } from '../processing/jobs.js';
import { getAudioArtifactKey, getSourceDurationSeconds, insertTranscript, insertTranscriptSegments, createSubtitleTrack, clearSubtitleSegments, insertSubtitleSegments, updateSubtitleTrackTranscript, unsetDefaultTracks, findOwnedSubtitleTrack } from '../processing/transcripts.js';

class CancelledError extends Error {
  constructor() { super('Processing cancelled'); this.name = 'CancelledError'; }
}

type TranscriptionPayload = ProcessingJobPayload & {
  language?: string | null;
  translateToEnglish?: boolean;
  regenerate?: boolean;
  targetTrackId?: number | null;
};

interface AiSegment {
  index?: number;
  startMs?: number;
  endMs?: number;
  text?: string;
  speaker?: string | null;
  words?: Array<{ startMs?: number; endMs?: number; text?: string; confidence?: number | null }> | null;
}

interface AiTranscribeResult {
  language?: string | null;
  detectedLanguage?: string | null;
  duration?: number | null;
  model?: string | null;
  segments?: AiSegment[];
}

function clampMs(ms: number, maxMs: number | null, minMs = 0): number {
  const rounded = Math.round(ms);
  let v = Number.isFinite(rounded) ? Math.max(minMs, rounded) : minMs;
  if (maxMs != null) v = Math.min(v, maxMs);
  return v;
}

export function normalizeSegments(raw: AiSegment[] | undefined, durationSeconds: number | null) {
  const maxMs = durationSeconds != null && Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;
  const out: Array<{ index: number; startMs: number; endMs: number; text: string; speaker: string | null; words: any[] | null }> = [];
  const src = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < src.length; i++) {
    const s = src[i] ?? {};
    const text = String(s.text ?? '').trim();
    if (!text) continue; // never invent missing spoken words
    let startMs = clampMs(Number(s.startMs ?? 0), maxMs);
    let endMs = clampMs(Number(s.endMs ?? startMs), maxMs);
    if (endMs < startMs) [startMs, endMs] = [endMs, startMs];
    if (maxMs != null && startMs > maxMs) continue;
    const words = Array.isArray(s.words)
      ? s.words
          .map((w) => ({
            startMs: clampMs(Number(w.startMs ?? startMs), endMs, startMs),
            endMs: clampMs(Number(w.endMs ?? endMs), endMs, startMs),
            text: String(w.text ?? '').trim(),
            confidence: w.confidence ?? null,
          }))
          .filter((w) => w.text)
      : null;
    out.push({ index: out.length, startMs, endMs, text, speaker: s.speaker ?? null, words: words && words.length ? words : null });
  }
  return out;
}

async function callAiTranscribe(storageKey: string, language?: string | null, translate?: boolean): Promise<AiTranscribeResult> {
  const url = new URL('/api/v1/transcribe', env.AI_SERVICE_URL).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AI_SERVICE_TOKEN ? { 'x-ai-service-token': env.AI_SERVICE_TOKEN } : {}),
    },
    body: JSON.stringify({ storageKey, language: language || null, translateToEnglish: !!translate }),
  });
  const body = await res.json().catch(() => null) as any;
  if (!res.ok || !body || body.success === false) {
    const msg = body?.error?.message || body?.detail || `AI transcription failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return (body.data ?? body) as AiTranscribeResult;
}

export async function processTranscription(job: Job<ProcessingJobPayload>): Promise<{ ok: true; transcriptId?: number; trackId?: number }> {
  const data = job.data as TranscriptionPayload;
  const { processingJobId, userId, projectId, sourceVideoId } = data;
  const attempt = job.attemptsMade + 1;

  if (await isCancelled(processingJobId)) {
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    return { ok: true };
  }

  try {
    await markJobRunning(processingJobId, attempt);
    await appendLog(processingJobId, 'info', 'Transcription started', { attempt, language: data.language ?? 'auto', translate: !!data.translateToEnglish, regenerate: !!data.regenerate });

    const audioKey = await getAudioArtifactKey(sourceVideoId);
    if (!audioKey) throw new Error('Audio artifact not found. Run video ingestion first.');
    await updateJob(processingJobId, { progress: 10 });

    if (await isCancelled(processingJobId)) throw new CancelledError();
    const ai = await callAiTranscribe(audioKey, data.language ?? null, data.translateToEnglish);
    await updateJob(processingJobId, { progress: 70 });
    await appendLog(processingJobId, 'info', 'AI transcription completed', { language: ai.language, detected: ai.detectedLanguage, segments: (ai.segments || []).length });

    if (await isCancelled(processingJobId)) throw new CancelledError();

    const sourceDuration = await getSourceDurationSeconds(sourceVideoId);
    const segments = normalizeSegments(ai.segments, sourceDuration ?? (ai.duration ?? null));
    const durationSeconds = sourceDuration ?? (ai.duration != null ? Number(ai.duration) : null);
    const transcriptId = await insertTranscript({
      userId,
      projectId,
      sourceVideoId,
      processingJobId,
      language: data.language || ai.language || ai.detectedLanguage || null,
      detectedLanguage: ai.detectedLanguage || ai.language || null,
      model: ai.model || null,
      durationSeconds: durationSeconds != null && Number.isFinite(durationSeconds) ? durationSeconds : null,
      originalPayload: ai,
    });
    await insertTranscriptSegments(transcriptId, segments.map((s) => ({ index: s.index, startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker, words: s.words })));
    await updateJob(processingJobId, { progress: 85 });

    let trackId: number;
    const trackName = data.translateToEnglish ? 'Translated subtitles' : (data.regenerate ? 'Regenerated subtitles' : 'Default subtitles');
    const trackLang = data.translateToEnglish ? 'en' : (data.language || ai.language || ai.detectedLanguage || null);

    if (data.targetTrackId) {
      const owned = await findOwnedSubtitleTrack(data.targetTrackId, userId);
      if (!owned || owned.sourceVideoId !== sourceVideoId) throw new Error('Target subtitle track not found');
      trackId = data.targetTrackId;
      await clearSubtitleSegments(trackId);
      await insertSubtitleSegments(trackId, segments.map((s) => ({ index: s.index, startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker })));
      await updateSubtitleTrackTranscript(trackId, transcriptId, trackLang);
    } else {
      await unsetDefaultTracks(sourceVideoId);
      trackId = await createSubtitleTrack({ userId, projectId, sourceVideoId, transcriptId, name: trackName, language: trackLang, isDefault: true, style: null });
      await insertSubtitleSegments(trackId, segments.map((s) => ({ index: s.index, startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker })));
    }

    await updateJob(processingJobId, { status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null, result: { transcriptId, subtitleTrackId: trackId, segmentCount: segments.length, language: trackLang } });
    await appendLog(processingJobId, 'info', 'Transcription stored', { transcriptId, trackId, segments: segments.length });
    return { ok: true, transcriptId, trackId };
  } catch (err) {
    if (err instanceof CancelledError || (await isCancelled(processingJobId))) {
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
      await appendLog(processingJobId, 'info', 'Transcription cancelled').catch(() => {});
      return { ok: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = attempt >= (job.opts.attempts ?? 3);
    await appendLog(processingJobId, 'error', 'Transcription failed', { error: message, attempt, finalAttempt }).catch(() => {});
    await updateJob(processingJobId, { status: finalAttempt ? 'failed' : 'queued', errorCode: 'TRANSCRIPTION_FAILED', errorMessage: message, completed: finalAttempt, result: null }).catch(() => {});
    logger.error({ err, processingJobId, sourceVideoId }, 'transcription processing failed');
    throw err;
  }
}
