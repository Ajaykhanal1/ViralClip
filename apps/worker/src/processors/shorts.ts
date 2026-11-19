import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import type { RowDataPacket } from 'mysql2/promise';
import type { ProcessingJobPayload, RenderQuality, ShortAudioConfig, ShortFramingMode, ShortTextConfig, SuggestedSubtitleConfig } from '@viralclip/shared';
import { env } from '../config/env.js';
import { pool } from '../db/mysql.js';
import { detectActiveCrop, probeMedia, runFfmpeg } from '../media/ffmpeg.js';
import { appendLog, getSourceAsset, insertArtifact, isCancelled, markJobRunning, updateJob } from '../processing/jobs.js';
import { emitEvent } from '../processing/notifications.js';
import { insertRenderedVideo, isRenderCancelled, updateRenderJob } from '../processing/render-jobs.js';
import { inspectRenderedFile, validateRenderQuality } from '../processing/quality.js';
import {
  buildAudioFilter,
  buildClipSrt,
  buildEditedRenderArgs,
  buildFilterGraph,
  buildRenderArgs,
  buildSubtitleFilter,
  buildTextFilter,
  planCrop,
  type EditedAudioInput,
  type EditedClipInput,
} from '../processing/render.js';
import { ensureDir, newArtifactKey, newTempDir, resolveStoragePath, storeFileToKey } from '../storage/local.js';

class CancelledError extends Error {
  constructor() { super('Processing cancelled'); this.name = 'CancelledError'; }
}

const execFileAsync = promisify(execFile);
const timeoutMs = env.RENDER_TIMEOUT_SECONDS * 1000;

export interface RenderJobPayload extends ProcessingJobPayload {
  draftIds: number[];
  /** Present when an editor export supplies a structured timeline. */
  editId?: number;
  /** Present for tracked Phase 11 final renders. */
  renderJobId?: number;
}

interface EditRow extends RowDataPacket {
  id: number;
  timeline_json: string;
}

interface AssetRow extends RowDataPacket {
  id: number;
  storage_key: string | null;
}

async function getEdit(userId: number, editId: number): Promise<{ timeline: import('@viralclip/shared').EditorTimeline; assets: Map<number, string> } | null> {
  const [rows] = await pool.execute<EditRow[]>(
    `SELECT id, timeline_json FROM clip_edits WHERE id = ? AND user_id = ? LIMIT 1`,
    [editId, userId],
  );
  if (!rows[0]) return null;
  const [assetRows] = await pool.execute<AssetRow[]>(
    `SELECT id, storage_key FROM editor_assets WHERE edit_id = ? AND storage_key IS NOT NULL`,
    [editId],
  );
  const assets = new Map<number, string>();
  for (const row of assetRows) if (row.storage_key) assets.set(Number(row.id), row.storage_key);
  return { timeline: parseJson(rows[0].timeline_json, { tracks: [], subtitles: [], texts: [], settings: { width: 1080, height: 1920, snapMs: 100, timelineZoom: 1 } }), assets };
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

  const version = await finalizeRender({
    processingJobId, draft, version: Number(draft.version), videoPath, thumbnailPath, sourceWidth, sourceHeight,
    renderJobId: job.data.renderJobId, editId: job.data.editId,
    expectedDurationMs: Number(draft.duration_ms), expectAudio: !!probe.audioCodec,
  });
  await updateJob(processingJobId, { progress: 10 + Math.round((index / total) * 80) });
  await appendLog(processingJobId, 'info', 'Shorts draft rendered', { draftId: draft.id, version, videoKey: newArtifactKey('shorts', `${draft.id}-v${version}.mp4`) });
}

async function finalizeRender(input: {
  processingJobId: number;
  draft: DraftRow;
  version: number;
  videoPath: string;
  thumbnailPath: string;
  sourceWidth: number;
  sourceHeight: number;
  renderJobId?: number;
  editId?: number;
  expectedDurationMs?: number;
  expectAudio?: boolean;
  expectedWidth?: number;
  expectedHeight?: number;
}): Promise<number> {
  const { draft, version } = input;
  if (input.renderJobId && !input.editId) throw new Error('Tracked renders require an editor project');
  const videoKey = newArtifactKey('shorts', `${draft.id}-v${version}.mp4`);
  const thumbnailKey = newArtifactKey('shorts', `${draft.id}-v${version}.jpg`);
  await storeFileToKey(input.videoPath, videoKey);
  await storeFileToKey(input.thumbnailPath, thumbnailKey);

  if (input.renderJobId) {
    // Validate before marking the draft complete so a failed check cannot publish a bad file.
    const info = await inspectRenderedFile(input.videoPath);
    const quality: RenderQuality = validateRenderQuality(info, {
      width: input.expectedWidth ?? Number(draft.width),
      height: input.expectedHeight ?? Number(draft.height),
      durationMs: input.expectedDurationMs ?? Number(draft.duration_ms),
      expectAudio: input.expectAudio ?? true,
    });
    if (!quality.ok) throw new Error(`Render quality check failed: ${quality.reasons.join('; ')}`);
    await insertRenderedVideo({
      userId: Number(draft.user_id),
      renderJobId: input.renderJobId,
      editId: input.editId!,
      draftId: draft.id,
      projectId: Number(draft.project_id),
      sourceVideoId: Number(draft.source_video_id),
      storageKey: videoKey,
      thumbnailKey,
      width: info.width ?? Number(draft.width),
      height: info.height ?? Number(draft.height),
      durationMs: Math.round((info.durationSeconds ?? (input.expectedDurationMs ?? Number(draft.duration_ms)) / 1000) * 1000),
      fileSize: info.fileSize,
      configurationVersion: version,
      quality,
    });
    await updateRenderJob(input.renderJobId, { progress: 95, result: { storageKey: videoKey, quality } });
  }

  const editData = {
    ...parseJson<Record<string, unknown>>(draft.edit_data_json, {}),
    output: { storageKey: videoKey, thumbnailKey, width: input.expectedWidth ?? Number(draft.width), height: input.expectedHeight ?? Number(draft.height), container: 'mp4' },
    sourceDimensions: { width: input.sourceWidth, height: input.sourceHeight },
  };
  await pool.execute(
    `UPDATE shorts_drafts SET status = 'completed', storage_key = ?, thumbnail_key = ?, version = ?, error_message = NULL, edit_data_json = ? WHERE id = ?`,
    [videoKey, thumbnailKey, version, JSON.stringify(editData), draft.id],
  );
  await insertArtifact({
    jobId: input.processingJobId,
    sourceVideoId: draft.source_video_id,
    kind: 'short-draft',
    storageKey: videoKey,
    mimeType: 'video/mp4',
    metadata: { draftId: draft.id, version, width: Number(draft.width), height: Number(draft.height) },
  });
  await insertArtifact({
    jobId: input.processingJobId,
    sourceVideoId: draft.source_video_id,
    kind: 'short-thumbnail',
    storageKey: thumbnailKey,
    mimeType: 'image/jpeg',
    metadata: { draftId: draft.id },
  });
  return version;
}

async function renderEditedDraft(input: {
  job: Job<RenderJobPayload>;
  draft: DraftRow;
  editId: number;
  index: number;
  total: number;
}): Promise<void> {
  const { job, draft, editId, index, total } = input;
  const { processingJobId, userId } = job.data;
  await pool.execute(`UPDATE shorts_drafts SET status = 'processing', error_message = NULL WHERE id = ?`, [draft.id]);

  const loaded = await getEdit(userId, editId);
  if (!loaded) throw new Error('Editor project not found');
  const { timeline, assets } = loaded;

  const sourceAsset = await getSourceAsset(draft.source_video_id);
  if (!sourceAsset) throw new Error('Source media not found for rendering');
  const sourcePath = resolveStoragePath(sourceAsset.storageKey);
  const probe = await probeMedia(sourcePath);
  const sourceWidth = probe.width ?? 1920;
  const sourceHeight = probe.height ?? 1080;

  // Asset storage keys come only from rights-declared editor_assets rows, never from client input.
  const resolvePath = (assetId: number | null): string => {
    if (assetId != null) {
      const key = assets.get(assetId);
      if (!key) throw new Error(`Authorized media for asset ${assetId} is missing`);
      return resolveStoragePath(key);
    }
    return sourcePath;
  };

  const videoClips: EditedClipInput[] = [];
  const audioClips: EditedAudioInput[] = [];
  let durationMs = 0;
  for (const track of timeline.tracks) {
    if (!track.visible) continue;
    // shortcut: timeline gaps are collapsed by concat; add padding when exact gaps must be preserved.
    for (const clip of [...track.clips].sort((a, b) => a.startMs - b.startMs)) {
      durationMs = Math.max(durationMs, clip.startMs + clip.durationMs);
      const inputPath = resolvePath(clip.assetId);
      if (track.kind === 'video') {
        videoClips.push({
          inputPath,
          sourceStartMs: clip.sourceStartMs,
          durationMs: clip.durationMs,
          cropX: clip.cropX, cropY: clip.cropY, zoom: clip.zoom, rotation: clip.rotation,
          speed: clip.speed, volume: clip.volume, muted: clip.muted,
          fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, transitionMs: clip.transitionMs,
        });
      } else if (track.kind === 'audio' && clip.assetId != null) {
        audioClips.push({
          inputPath,
          sourceStartMs: clip.sourceStartMs,
          durationMs: clip.durationMs,
          volume: clip.volume, muted: clip.muted,
          fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs,
        });
      }
    }
  }
  if (videoClips.length === 0) throw new Error('Timeline has no visible video clips');

  const tempDir = newTempDir(processingJobId);
  await ensureDir(tempDir);
  const videoPath = join(tempDir, `short-${draft.id}-edit.mp4`);
  const thumbnailPath = join(tempDir, `short-${draft.id}-edit.jpg`);

  let subtitleFilter: string | null = null;
  if (timeline.subtitles.length > 0) {
    const srt = buildClipSrt(
      timeline.subtitles.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text })),
      0,
      durationMs,
    );
    if (srt) {
      await writeFile(join(tempDir, 'subs.srt'), srt, 'utf8');
      const style = timeline.subtitles[0].style;
      subtitleFilter = buildSubtitleFilter({
        enabled: true,
        position: style.position ?? 'bottom',
        fontSize: Number(style.fontSize ?? 48),
        textColor: String(style.textColor ?? '#FFFFFF'),
        backgroundColor: String(style.background ?? ''),
        outlineColor: String(style.outline ?? '#000000'),
        maxWordsPerLine: 5,
        highlightKeywords: [],
      });
    }
  }

  const overlays: Array<string | null> = [];
  for (const [step, text] of timeline.texts.entries()) {
    const file = `editor-text-${step}.txt`;
    await writeFile(join(tempDir, file), text.text.slice(0, 200), 'utf8');
    overlays.push(buildTextFilter({
      text: text.text,
      seconds: (text.endMs - text.startMs) / 1000,
      file,
      enable: `between(t,${text.startMs / 1000},${text.endMs / 1000})`,
      x: text.x, y: text.y, fontSize: text.fontSize, color: text.color,
    }));
  }
  // shortcut: text animation is a preview feature; the final render shows static text in its time window.

  const args = buildEditedRenderArgs({
    clips: videoClips,
    audioClips,
    outputPath: videoPath,
    width: timeline.settings.width,
    height: timeline.settings.height,
    subtitleFilter,
    overlays,
  });
  await runFfmpeg(args, { cwd: tempDir, timeoutMs });
  await extractThumbnail(videoPath, thumbnailPath, Number(draft.hook_ms) - Number(draft.start_ms), Number(draft.duration_ms));

  const version = await finalizeRender({
    processingJobId, draft, version: Number(draft.version) + 1, videoPath, thumbnailPath, sourceWidth, sourceHeight,
    renderJobId: job.data.renderJobId, editId,
    expectedDurationMs: durationMs, expectAudio: !!probe.audioCodec || audioClips.length > 0,
    expectedWidth: timeline.settings.width, expectedHeight: timeline.settings.height,
  });
  await updateJob(processingJobId, { progress: 10 + Math.round((index / total) * 80) });
  await appendLog(processingJobId, 'info', 'Edited timeline rendered', { draftId: draft.id, editId, version });
}

async function writeOverlay(tempDir: string, file: string, text: string, enable: string): Promise<string | null> {
  await writeFile(join(tempDir, file), text.replace(/\r?\n/g, ' ').slice(0, 160), 'utf8');
  return buildTextFilter({ text, seconds: 1, file, enable });
}

export async function processVideoRendering(job: Job<RenderJobPayload>): Promise<{ ok: true; draftIds: number[] }> {
  const { processingJobId, userId, sourceVideoId, draftIds, editId, renderJobId } = job.data;
  const attempt = job.attemptsMade + 1;
  if (!Array.isArray(draftIds) || draftIds.length === 0) throw new Error('No Shorts drafts were supplied');
  const cancelled = async () => (await isCancelled(processingJobId)) || (!!renderJobId && await isRenderCancelled(renderJobId));

  if (await cancelled()) {
    await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    if (renderJobId) await updateRenderJob(renderJobId, { status: 'cancelled', completed: true, errorMessage: 'Cancelled before start' }).catch(() => {});
    return { ok: true, draftIds: [] };
  }

  try {
    await markJobRunning(processingJobId, attempt);
    if (renderJobId) {
      await updateRenderJob(renderJobId, {
        status: 'processing', progress: 5, attempt, started: true,
        errorCode: null, errorMessage: null, result: null,
      });
    }
    await appendLog(processingJobId, 'info', 'Shorts rendering started', { attempt, drafts: draftIds.length, renderJobId });
    const rendered: number[] = [];
    for (const [index, draftId] of draftIds.entries()) {
      if (await cancelled()) throw new CancelledError();
      const draft = await getDraft(userId, draftId);
      if (!draft || draft.user_id !== userId || draft.source_video_id !== sourceVideoId) {
        throw new Error(`Shorts draft ${draftId} not found for this source`);
      }
      if (editId) {
        await renderEditedDraft({ job, draft, editId, index, total: draftIds.length });
      } else {
        await renderDraft({ job, draft, index, total: draftIds.length });
      }
      rendered.push(draftId);
      const progress = 10 + Math.round(((index + 1) / draftIds.length) * 80);
      if (renderJobId) await updateRenderJob(renderJobId, { progress: Math.min(95, progress) });
    }

    await updateJob(processingJobId, {
      status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null,
      result: { draftIds: rendered },
    });
    if (renderJobId) {
      await updateRenderJob(renderJobId, {
        status: 'completed', progress: 100, completed: true, errorCode: null, errorMessage: null,
        result: { draftIds: rendered },
      });
    }
    await appendLog(processingJobId, 'info', 'Shorts rendering completed', { draftIds: rendered });
    await emitEvent({
      userId,
      type: 'render_completed',
      title: 'Render completed',
      message: `${rendered.length} Short${rendered.length === 1 ? '' : 's'} finished rendering.`,
      severity: 'success',
      data: { projectId: job.data.projectId, sourceVideoId, processingJobId, renderJobId: renderJobId ?? null, draftIds: rendered },
      usage: { metric: 'renderedVideos', amount: rendered.length, key: `render:${processingJobId}` },
    });
    return { ok: true, draftIds: rendered };
  } catch (error) {
    if (error instanceof CancelledError || (await cancelled())) {
      await pool.execute(`UPDATE shorts_drafts SET status = 'cancelled' WHERE id IN (${draftIds.map(() => '?').join(',')}) AND status IN ('queued','processing')`, draftIds).catch(() => {});
      await updateJob(processingJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
      if (renderJobId) await updateRenderJob(renderJobId, { status: 'cancelled', completed: true, errorMessage: 'Processing cancelled' }).catch(() => {});
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
    if (renderJobId) {
      await updateRenderJob(renderJobId, {
        status: finalAttempt ? 'failed' : 'queued',
        errorCode: 'RENDER_FAILED',
        errorMessage: message,
        completed: finalAttempt,
        result: null,
      }).catch(() => {});
    }
    if (finalAttempt) {
      await emitEvent({
        userId,
        type: 'render_failed',
        title: 'Render failed',
        message: `Rendering failed for source video #${sourceVideoId}: ${message}`,
        severity: 'error',
        data: { projectId: job.data.projectId, sourceVideoId, processingJobId, renderJobId: renderJobId ?? null, error: message },
      });
    }
    throw error;
  }
}
