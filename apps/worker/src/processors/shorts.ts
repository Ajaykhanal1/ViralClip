import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import type { RowDataPacket } from 'mysql2/promise';
import type { ProcessingJobPayload, ShortAudioConfig, ShortFramingMode, ShortTextConfig, SuggestedSubtitleConfig } from '@viralclip/shared';
import { env } from '../config/env.js';
import { pool } from '../db/mysql.js';
import { detectActiveCrop, probeMedia, runFfmpeg } from '../media/ffmpeg.js';
import { appendLog, getSourceAsset, insertArtifact, isCancelled, markJobRunning, updateJob } from '../processing/jobs.js';
import {
  buildAudioFilter,
  buildClipSrt,
  buildFilterGraph,
  buildRenderArgs,
  buildSubtitleFilter,
  buildTextFilter,
  planCrop,
} from '../processing/render.js';
import { ensureDir, newArtifactKey, newTempDir, resolveStoragePath, storeFileToKey } from '../storage/local.js';

class CancelledError extends Error {
  constructor() { super('Processing cancelled'); this.name = 'CancelledError'; }
}

const execFileAsync = promisify(execFile);
const timeoutMs = env.RENDER_TIMEOUT_SECONDS * 1000;

export interface RenderJobPayload extends ProcessingJobPayload {
  draftIds: number[];
}

interface DraftRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
  source_video_id: number;
  title: string;
  description: string;
  start_ms: number;
  end_ms: number;
  hook_ms: number;
  duration_ms: number;
  width: number;
  height: number;
  framing: ShortFramingMode;
  crop_x: number | string;
  crop_y: number | string;
  subtitle_config_json: string | null;
  audio_config_json: string;
  intro_json: string;
  outro_json: string;
  edit_data_json: string;
  version: number;
}

interface SegmentRow extends RowDataPacket {
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: string | null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function getDraft(userId: number, id: number): Promise<DraftRow | null> {
  const [rows] = await pool.execute<DraftRow[]>(
    `SELECT * FROM shorts_drafts WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ?? null;
}

async function getSegments(userId: number, sourceVideoId: number, startMs: number, endMs: number): Promise<SegmentRow[]> {
  const [rows] = await pool.execute<SegmentRow[]>(
    `SELECT seg.start_ms, seg.end_ms, seg.text, seg.speaker
       FROM transcript_segments seg
       JOIN transcripts t ON t.id = seg.transcript_id
      WHERE t.user_id = ? AND t.source_video_id = ? AND seg.start_ms < ? AND seg.end_ms > ?
      ORDER BY seg.start_ms ASC, seg.id ASC`,
    [userId, sourceVideoId, endMs, startMs],
  );
  return rows;
}

function speakerCues(segments: SegmentRow[]): { speakerIndex?: number; speakerCount?: number; activeX?: number } {
  const speakers: string[] = [];
  const counts = new Map<string, number>();
  for (const segment of segments) {
    if (!segment.speaker) continue;
    if (!speakers.includes(segment.speaker)) speakers.push(segment.speaker);
    counts.set(segment.speaker, (counts.get(segment.speaker) ?? 0) + 1);
  }
  if (speakers.length < 2) return {};
  const dominant = [...speakers].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
  return { speakerIndex: speakers.indexOf(dominant), speakerCount: speakers.length };
}

async function extractThumbnail(videoPath: string, outputPath: string, hookMs: number, durationMs: number): Promise<void> {
  const offset = Math.min(Math.max(hookMs, 0), Math.max(0, durationMs - 1)) / 1000;
  try {
    await execFileAsync('ffmpeg', ['-y', '-ss', String(offset), '-i', videoPath, '-frames:v', '1', '-q:v', '3', outputPath], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch {
    await execFileAsync('ffmpeg', ['-y', '-i', videoPath, '-frames:v', '1', '-q:v', '3', outputPath], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
    });
  }
}

async function renderDraft(input: {
  job: Job<RenderJobPayload>;
  draft: DraftRow;
  index: number;
  total: number;
}): Promise<void> {
  const { job, draft, index, total } = input;
  const { processingJobId, userId } = job.data;
  await pool.execute(`UPDATE shorts_drafts SET status = 'processing', error_message = NULL WHERE id = ?`, [draft.id]);

  const asset = await getSourceAsset(draft.source_video_id);
  if (!asset) throw new Error('Source media not found for rendering');
  const sourcePath = resolveStoragePath(asset.storageKey);
  const probe = await probeMedia(sourcePath);
  const sourceWidth = probe.width ?? 1920;
  const sourceHeight = probe.height ?? 1080;
  if (!probe.width || !probe.height) throw new Error('Unable to probe source video dimensions');

  const segments = await getSegments(userId, draft.source_video_id, Number(draft.start_ms), Number(draft.end_ms));
  const cues = speakerCues(segments);
  if (draft.framing === 'smart' || draft.framing === 'face') {
    const activeX = await detectActiveCrop(sourcePath, Number(draft.start_ms), Number(draft.duration_ms), sourceWidth, timeoutMs);
    if (activeX !== null) cues.activeX = activeX;
  }
  const crop = planCrop(draft.framing, Number(draft.crop_x), Number(draft.crop_y), cues);

  const tempDir = newTempDir(processingJobId);
  await ensureDir(tempDir);
  const videoPath = join(tempDir, `short-${draft.id}.mp4`);
  const thumbnailPath = join(tempDir, `short-${draft.id}.jpg`);

  const subtitleConfig = parseJson<SuggestedSubtitleConfig | null>(draft.subtitle_config_json, null);
  let subtitleFilter: string | null = null;
  if (subtitleConfig?.enabled) {
    const srt = buildClipSrt(
      segments.map((segment) => ({ startMs: Number(segment.start_ms), endMs: Number(segment.end_ms), text: segment.text })),
      Number(draft.start_ms),
      Number(draft.end_ms),
      subtitleConfig.maxWordsPerLine,
    );
    if (srt) {
      await writeFile(join(tempDir, 'subs.srt'), srt, 'utf8');
      subtitleFilter = buildSubtitleFilter(subtitleConfig);
    }
  }

  const durationSeconds = Number(draft.duration_ms) / 1000;
  const intro = parseJson<ShortTextConfig>(draft.intro_json, { text: '', seconds: 0 });
  const outro = parseJson<ShortTextConfig>(draft.outro_json, { text: '', seconds: 0 });
  const overlays = [
    intro.text && intro.seconds > 0
      ? await writeOverlay(tempDir, 'intro.txt', intro.text, `lt(t,${intro.seconds})`)
      : null,
    outro.text && outro.seconds > 0
      ? await writeOverlay(tempDir, 'outro.txt', outro.text, `gte(t,${Math.max(0, durationSeconds - outro.seconds)})`)
      : null,
  ];

  const filterGraph = buildFilterGraph({
    crop,
    width: Number(draft.width),
    height: Number(draft.height),
    subtitleFilter,
    overlays,
  });
  const audioConfig = parseJson<ShortAudioConfig>(draft.audio_config_json, { volume: 1, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 });
  const args = buildRenderArgs({
    inputPath: sourcePath,
    outputPath: videoPath,
    startMs: Number(draft.start_ms),
    durationMs: Number(draft.duration_ms),
    filterGraph,
    audioFilter: buildAudioFilter(audioConfig, durationSeconds),
  });
  await runFfmpeg(args, { cwd: tempDir, timeoutMs });
  await extractThumbnail(videoPath, thumbnailPath, Number(draft.hook_ms) - Number(draft.start_ms), Number(draft.duration_ms));

  const videoKey = newArtifactKey('shorts', `${draft.id}-v${draft.version}.mp4`);
  const thumbnailKey = newArtifactKey('shorts', `${draft.id}-v${draft.version}.jpg`);
  await storeFileToKey(videoPath, videoKey);
  await storeFileToKey(thumbnailPath, thumbnailKey);

  const editData = {
    ...parseJson<Record<string, unknown>>(draft.edit_data_json, {}),
    output: { storageKey: videoKey, thumbnailKey, width: Number(draft.width), height: Number(draft.height), container: 'mp4' },
    sourceDimensions: { width: sourceWidth, height: sourceHeight },
  };
  await pool.execute(
    `UPDATE shorts_drafts SET status = 'completed', storage_key = ?, thumbnail_key = ?, error_message = NULL, edit_data_json = ? WHERE id = ?`,
    [videoKey, thumbnailKey, JSON.stringify(editData), draft.id],
  );
  await insertArtifact({
    jobId: processingJobId,
    sourceVideoId: draft.source_video_id,
    kind: 'short-draft',
    storageKey: videoKey,
    mimeType: 'video/mp4',
    metadata: { draftId: draft.id, version: draft.version, width: Number(draft.width), height: Number(draft.height) },
  });
  await insertArtifact({
    jobId: processingJobId,
    sourceVideoId: draft.source_video_id,
    kind: 'short-thumbnail',
    storageKey: thumbnailKey,
    mimeType: 'image/jpeg',
    metadata: { draftId: draft.id },
  });
  await updateJob(processingJobId, { progress: 10 + Math.round((index / total) * 80) });
  await appendLog(processingJobId, 'info', 'Shorts draft rendered', { draftId: draft.id, version: draft.version, videoKey });
}

async function writeOverlay(tempDir: string, file: string, text: string, enable: string): Promise<string | null> {
  await writeFile(join(tempDir, file), text.replace(/\r?\n/g, ' ').slice(0, 160), 'utf8');
  return buildTextFilter({ text, seconds: 1, file, enable });
}

export async function processVideoRendering(job: Job<RenderJobPayload>): Promise<{ ok: true; draftIds: number[] }> {
  const { processingJobId, userId, sourceVideoId, draftIds } = job.data;
  const attempt = job.attemptsMade + 1;
  if (!Array.isArray(draftIds) || draftIds.length === 0) throw new Error('No Shorts drafts were supplied');

  if (await isCancelled(processingJobId)) {
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    return { ok: true, draftIds: [] };
  }

  try {
    await markJobRunning(processingJobId, attempt);
    await appendLog(processingJobId, 'info', 'Shorts rendering started', { attempt, drafts: draftIds.length });
    const rendered: number[] = [];
    for (const [index, draftId] of draftIds.entries()) {
      if (await isCancelled(processingJobId)) throw new CancelledError();
      const draft = await getDraft(userId, draftId);
      if (!draft || draft.user_id !== userId || draft.source_video_id !== sourceVideoId) {
        throw new Error(`Shorts draft ${draftId} not found for this source`);
      }
      await renderDraft({ job, draft, index, total: draftIds.length });
      rendered.push(draftId);
    }

    await updateJob(processingJobId, {
      status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null,
      result: { draftIds: rendered },
    });
    await appendLog(processingJobId, 'info', 'Shorts rendering completed', { draftIds: rendered });
    return { ok: true, draftIds: rendered };
  } catch (error) {
    if (error instanceof CancelledError || (await isCancelled(processingJobId))) {
      await pool.execute(`UPDATE shorts_drafts SET status = 'cancelled' WHERE id IN (${draftIds.map(() => '?').join(',')}) AND status IN ('queued','processing')`, draftIds).catch(() => {});
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
      return { ok: true, draftIds: [] };
    }
    const message = error instanceof Error ? error.message : String(error);
    await pool.execute(`UPDATE shorts_drafts SET status = 'failed', error_message = ? WHERE id IN (${draftIds.map(() => '?').join(',')}) AND status IN ('queued','processing')`, [message, ...draftIds]).catch(() => {});
    const finalAttempt = attempt >= (job.opts.attempts ?? 3);
    await appendLog(processingJobId, 'error', 'Shorts rendering failed', { error: message, attempt, finalAttempt }).catch(() => {});
    await updateJob(processingJobId, {
      status: finalAttempt ? 'failed' : 'queued',
      errorCode: 'RENDER_FAILED',
      errorMessage: message,
      completed: finalAttempt,
      result: null,
    }).catch(() => {});
    throw error;
  }
}
