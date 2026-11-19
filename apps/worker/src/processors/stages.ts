import type { Job } from 'bullmq';
import type { AiAnalysisOptions, ProcessingJobPayload } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { appendLog, getSourceAsset, isCancelled, markJobRunning, setSourceStatus, updateJob } from '../processing/jobs.js';
import { getAudioArtifactKey, getSourceDurationSeconds } from '../processing/transcripts.js';
import { getLatestTranscriptForAnalysis, normalizeClips, persistAnalysis, type AiAnalysis } from '../processing/clips.js';

export class CancelledError extends Error {
  constructor() { super('Processing cancelled'); this.name = 'CancelledError'; }
}

type AiAnalysisPayload = ProcessingJobPayload & AiAnalysisOptions;

interface AiEnvelope {
  success?: boolean;
  data?: AiAnalysis;
  error?: { message?: string };
  detail?: unknown;
}

async function callAiDetectClips(payload: Record<string, unknown>): Promise<AiAnalysis> {
  const url = new URL('/api/v1/detect-clips', env.AI_SERVICE_URL).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null) as AiEnvelope | null;
  if (!res.ok || !body || body.success === false || !body.data) {
    const message = body?.error?.message ?? body?.detail ?? `AI clip detection failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return body.data;
}

function toMs(seconds: number | null | undefined): number | null {
  return seconds != null && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

async function processStage(job: Job<ProcessingJobPayload>, stage: string): Promise<{ ok: true }> {
  const { processingJobId, userId, sourceVideoId } = job.data;
  const attempt = job.attemptsMade + 1;
  if (await isCancelled(processingJobId)) {
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
    return { ok: true };
  }
  try {
    await markJobRunning(processingJobId, attempt);
    await appendLog(processingJobId, 'info', `${stage} job started`, { attempt, stage });
    if (await isCancelled(processingJobId)) throw new CancelledError();
    // No further phase-6 processing for this stage; record completion of this queued step.
    await updateJob(processingJobId, { status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null, result: { stage, note: 'Stage queued infrastructure ready; downstream implementation pending later phases.' } });
    await appendLog(processingJobId, 'info', `${stage} job completed (infrastructure stage)`);
    return { ok: true };
  } catch (err) {
    if (err instanceof CancelledError || (await isCancelled(processingJobId))) {
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
      await appendLog(processingJobId, 'info', `${stage} job cancelled`).catch(() => {});
      await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
      return { ok: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = attempt >= (job.opts.attempts ?? 3);
    await appendLog(processingJobId, 'error', `${stage} job failed`, { error: message, attempt, finalAttempt }).catch(() => {});
    await updateJob(processingJobId, { status: finalAttempt ? 'failed' : 'queued', errorCode: 'PROCESSING_FAILED', errorMessage: message, completed: finalAttempt }).catch(() => {});
    if (finalAttempt) await setSourceStatus(userId, sourceVideoId, 'failed', message).catch(() => {});
    logger.error({ err, processingJobId, stage }, 'stage processing failed');
    throw err;
  }
}

export async function processAiAnalysis(job: Job<ProcessingJobPayload>): Promise<{ ok: true; analysisId?: number }> {
  const data = job.data as AiAnalysisPayload;
  const { processingJobId, userId, projectId, sourceVideoId } = data;
  const attempt = job.attemptsMade + 1;

  if (await isCancelled(processingJobId)) {
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
    return { ok: true };
  }

  try {
    await markJobRunning(processingJobId, attempt);
    await appendLog(processingJobId, 'info', 'AI analysis started', { attempt, options: { minDurationSeconds: data.minDurationSeconds, maxDurationSeconds: data.maxDurationSeconds, maxClips: data.maxClips } });

    const [asset, audioKey, transcript, sourceDurationSeconds] = await Promise.all([
      getSourceAsset(sourceVideoId),
      getAudioArtifactKey(sourceVideoId),
      getLatestTranscriptForAnalysis(userId, sourceVideoId),
      getSourceDurationSeconds(sourceVideoId),
    ]);
    if (!asset) throw new Error('Source media not found. Import an authorized source file first.');
    if (!transcript || transcript.segments.length === 0) throw new Error('No transcript found. Run transcription first.');
    const durationMs = toMs(sourceDurationSeconds) ?? transcript.durationMs ?? Math.max(...transcript.segments.map((s) => s.endMs));
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Source duration is unknown');
    const segments = transcript.segments
      .map((segment) => ({
        startMs: Math.max(0, Math.min(durationMs, Math.round(segment.startMs))),
        endMs: Math.max(0, Math.min(durationMs, Math.round(segment.endMs))),
        text: segment.text.trim(),
        speaker: segment.speaker,
      }))
      .filter((segment) => segment.text && segment.endMs > segment.startMs);
    if (segments.length === 0) throw new Error('Transcript has no timed segments');
    await updateJob(processingJobId, { progress: 20 });

    if (await isCancelled(processingJobId)) throw new CancelledError();
    const ai = await callAiDetectClips({
      sourceDurationMs: durationMs,
      storageKey: asset.storageKey,
      audioStorageKey: audioKey ?? undefined,
      segments,
      minDurationSeconds: data.minDurationSeconds,
      maxDurationSeconds: data.maxDurationSeconds,
      maxClips: data.maxClips,
      weights: data.weights,
    });
    if (!ai.analysisKey || !ai.model) throw new Error('AI service returned an incomplete analysis');
    const clips = normalizeClips(ai.clips, durationMs);
    if (clips.length === 0) throw new Error('AI service returned no usable clip recommendations');
    await updateJob(processingJobId, { progress: 70 });
    await appendLog(processingJobId, 'info', 'AI clip detection completed', { candidates: ai.candidatesGenerated, recommended: clips.length });

    if (await isCancelled(processingJobId)) throw new CancelledError();
    const analysisId = await persistAnalysis({
      userId,
      projectId,
      sourceVideoId,
      processingJobId,
      analysis: { ...ai, sourceDurationMs: durationMs, clips },
    });
    await updateJob(processingJobId, {
      status: 'completed',
      progress: 100,
      completed: true,
      errorCode: null,
      errorMessage: null,
      result: { analysisId, clipCount: clips.length, model: ai.model },
    });
    await appendLog(processingJobId, 'info', 'AI recommendations stored', { analysisId, clipCount: clips.length });
    return { ok: true, analysisId };
  } catch (err) {
    if (err instanceof CancelledError || (await isCancelled(processingJobId))) {
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
      await appendLog(processingJobId, 'info', 'AI analysis cancelled').catch(() => {});
      await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
      return { ok: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = attempt >= (job.opts.attempts ?? 3);
    await appendLog(processingJobId, 'error', 'AI analysis failed', { error: message, attempt, finalAttempt }).catch(() => {});
    await updateJob(processingJobId, { status: finalAttempt ? 'failed' : 'queued', errorCode: 'AI_ANALYSIS_FAILED', errorMessage: message, completed: finalAttempt, result: null }).catch(() => {});
    if (finalAttempt) await setSourceStatus(userId, sourceVideoId, 'failed', message).catch(() => {});
    logger.error({ err, processingJobId, sourceVideoId }, 'ai analysis failed');
    throw err;
  }
}

export const processClipGeneration = (job: Job<ProcessingJobPayload>) => processStage(job, 'clip-generation');
export { processVideoRendering } from './shorts.js';
export const processYoutubeUpload = (job: Job<ProcessingJobPayload>) => processStage(job, 'youtube-upload');
