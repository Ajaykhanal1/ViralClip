import path from 'node:path';
import { Queue, type Job } from 'bullmq';
import type { ProcessingJobPayload } from '@viralclip/shared';
import { QUEUE_NAMES, redisConnectionFromUrl } from '@viralclip/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { extractAudio, generateThumbnail, generateWaveform, probeMedia } from '../media/ffmpeg.js';
import { appendLog, artifactExists, getSourceAsset, insertArtifact, isCancelled, markJobRunning, setSourceStatus, updateJob } from '../processing/jobs.js';
import { pool } from '../db/mysql.js';

let transcriptionQueue: Queue<ProcessingJobPayload> | null = null;
function getTranscriptionQueue() {
  if (!transcriptionQueue) {
    transcriptionQueue = new Queue<ProcessingJobPayload>(QUEUE_NAMES.transcription, {
      connection: { ...redisConnectionFromUrl(env.REDIS_URL), maxRetriesPerRequest: 1 },
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 24 * 3600, count: 1000 }, removeOnFail: { age: 7 * 24 * 3600 } },
    });
    transcriptionQueue.on('error', () => {});
  }
  return transcriptionQueue;
}

async function enqueueAutoTranscription(userId: number, projectId: number, sourceVideoId: number) {
  try {
    const [existing] = await pool.execute<any[]>(`SELECT id FROM processing_jobs WHERE source_video_id = ? AND queue_name = ? AND status IN ('queued','processing','completed') ORDER BY id DESC LIMIT 1`, [sourceVideoId, QUEUE_NAMES.transcription]);
    if (existing?.[0]) return;
    const [res] = await pool.execute<any>(
      `INSERT INTO processing_jobs (user_id, project_id, source_video_id, queue_name, job_type, status, progress, max_attempts, payload_json)
       VALUES (?, ?, ?, ?, 'transcription', 'queued', 0, 3, ?)`,
      [userId, projectId, sourceVideoId, QUEUE_NAMES.transcription, JSON.stringify({ auto: true })],
    );
    const id = res.insertId as number;
    await pool.execute(`INSERT INTO processing_job_logs (job_id, level, message, details_json) VALUES (?, 'info', ?, ?)`, [id, 'Queued automatic transcription', JSON.stringify({ queue: QUEUE_NAMES.transcription })]).catch(() => {});
    const payload: ProcessingJobPayload = { processingJobId: id, userId, projectId, sourceVideoId, requestedAt: new Date().toISOString() };
    const q = getTranscriptionQueue();
    const bull = await q.add(`job-${id}`, payload, { jobId: String(id) });
    await pool.execute(`UPDATE processing_jobs SET bullmq_job_id = ? WHERE id = ?`, [bull.id ?? String(id), id]);
  } catch (e) {
    logger.warn({ err: e, sourceVideoId }, 'failed to auto-enqueue transcription');
  }
}
import { ensureDir, fileSizeByPath, newTempDir, removePathSafe, resolveStoragePath, storeFileToKey } from '../storage/local.js';

export class CancelledError extends Error {
  constructor() {
    super('Processing cancelled');
    this.name = 'CancelledError';
  }
}

async function ensureNotCancelled(jobId: number) {
  if (await isCancelled(jobId)) throw new CancelledError();
}

function artifactKey(sourceVideoId: number, kind: string, ext: string): string {
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `artifacts/source-${sourceVideoId}/${kind}${safeExt}`;
}

export async function processVideoIngestion(job: Job<ProcessingJobPayload>): Promise<{ ok: true }> {
  const { processingJobId, userId, sourceVideoId } = job.data;
  const attempt = job.attemptsMade + 1;
  const tempDir = newTempDir(processingJobId);
  await ensureDir(tempDir);

  try {
    if (await isCancelled(processingJobId)) {
      await updateJob(processingJobId, { status: 'cancelled', completed: true, progress: 0, errorMessage: 'Cancelled before start' });
      await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled');
      return { ok: true };
    }

    await markJobRunning(processingJobId, attempt);
    await appendLog(processingJobId, 'info', 'Video ingestion started', { attempt, sourceVideoId });
    await setSourceStatus(userId, sourceVideoId, 'processing');

    const asset = await getSourceAsset(sourceVideoId);
    if (!asset) throw new Error('No source media asset found for processing');

    const inputPath = resolveStoragePath(asset.storageKey);
    await ensureNotCancelled(processingJobId);

    // Validation/probe (real work)
    const probe = await probeMedia(inputPath);
    if (!probe.durationSeconds && !probe.videoCodec) {
      throw new Error('FFprobe could not read a valid media stream');
    }
    await updateJob(processingJobId, { progress: 25, result: { probe } });
    await appendLog(processingJobId, 'info', 'Media probed', { probe });

    // Audio extraction
    await ensureNotCancelled(processingJobId);
    const audioKey = artifactKey(sourceVideoId, 'audio', '.wav');
    if (!(await artifactExists(sourceVideoId, 'audio'))) {
      const audioTmp = path.join(tempDir, 'audio.wav');
      await extractAudio(inputPath, audioTmp);
      const audioSize = await fileSizeByPath(audioTmp);
      await storeFileToKey(audioTmp, audioKey);
      await insertArtifact({ jobId: processingJobId, sourceVideoId, kind: 'audio', storageKey: audioKey, mimeType: 'audio/wav', sizeBytes: audioSize, metadata: { sampleRate: 16000, channels: 1 } });
      await appendLog(processingJobId, 'info', 'Audio extracted', { storageKey: audioKey, sizeBytes: audioSize });
    } else {
      await appendLog(processingJobId, 'info', 'Audio artifact already exists; skipping extraction', { storageKey: audioKey });
    }
    await updateJob(processingJobId, { progress: 50 });

    // Thumbnail generation
    await ensureNotCancelled(processingJobId);
    const thumbKey = artifactKey(sourceVideoId, 'thumbnail', '.jpg');
    if (!(await artifactExists(sourceVideoId, 'thumbnail'))) {
      const thumbTmp = path.join(tempDir, 'thumbnail.jpg');
      await generateThumbnail(inputPath, thumbTmp);
      const thumbSize = await fileSizeByPath(thumbTmp);
      await storeFileToKey(thumbTmp, thumbKey);
      await insertArtifact({ jobId: processingJobId, sourceVideoId, kind: 'thumbnail', storageKey: thumbKey, mimeType: 'image/jpeg', sizeBytes: thumbSize, metadata: null });
      await appendLog(processingJobId, 'info', 'Thumbnail generated', { storageKey: thumbKey, sizeBytes: thumbSize });
    } else {
      await appendLog(processingJobId, 'info', 'Thumbnail artifact already exists; skipping', { storageKey: thumbKey });
    }
    await updateJob(processingJobId, { progress: 70 });

    // Waveform generation
    await ensureNotCancelled(processingJobId);
    const waveKey = artifactKey(sourceVideoId, 'waveform', '.png');
    if (!(await artifactExists(sourceVideoId, 'waveform'))) {
      const waveTmp = path.join(tempDir, 'waveform.png');
      await generateWaveform(inputPath, waveTmp);
      const waveSize = await fileSizeByPath(waveTmp);
      await storeFileToKey(waveTmp, waveKey);
      await insertArtifact({ jobId: processingJobId, sourceVideoId, kind: 'waveform', storageKey: waveKey, mimeType: 'image/png', sizeBytes: waveSize, metadata: { width: 1200, height: 240 } });
      await appendLog(processingJobId, 'info', 'Waveform generated', { storageKey: waveKey, sizeBytes: waveSize });
    } else {
      await appendLog(processingJobId, 'info', 'Waveform artifact already exists; skipping', { storageKey: waveKey });
    }
    await updateJob(processingJobId, { progress: 90 });

    await ensureNotCancelled(processingJobId);
    await updateJob(processingJobId, { status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null });
    await setSourceStatus(userId, sourceVideoId, 'ready');
    await appendLog(processingJobId, 'info', 'Video ingestion completed');
    await enqueueAutoTranscription(userId, job.data.projectId, sourceVideoId);
    return { ok: true };
  } catch (err) {
    if (err instanceof CancelledError || (await isCancelled(processingJobId))) {
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorCode: null, errorMessage: 'Processing cancelled' }).catch(() => {});
      await appendLog(processingJobId, 'info', 'Video ingestion cancelled').catch(() => {});
      await setSourceStatus(userId, sourceVideoId, 'cancelled', 'Processing cancelled').catch(() => {});
      return { ok: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = attempt >= (job.opts.attempts ?? 3);
    await appendLog(processingJobId, 'error', 'Video ingestion failed', { error: message, attempt, finalAttempt }).catch(() => {});
    await updateJob(processingJobId, { status: finalAttempt ? 'failed' : 'queued', errorCode: 'PROCESSING_FAILED', errorMessage: message, completed: finalAttempt }).catch(() => {});
    if (finalAttempt) await setSourceStatus(userId, sourceVideoId, 'failed', message).catch(() => {});
    throw err;
  } finally {
    await removePathSafe(tempDir);
  }
}

// Named for queue registration
export const videoIngestionQueueName = QUEUE_NAMES.videoIngestion;
