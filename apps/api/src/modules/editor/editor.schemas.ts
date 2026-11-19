import { z } from 'zod';

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const draftParamSchema = z.object({ draftId: z.coerce.number().int().positive() });

const clip = z.object({
  id: z.string().min(1).max(80),
  trackId: z.string().min(1).max(80),
  assetId: z.number().int().positive().nullable(),
  label: z.string().max(200),
  sourceStartMs: z.number().int().min(0),
  sourceEndMs: z.number().int().min(0),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().min(1).max(600000),
  cropX: z.number().min(-1).max(1),
  cropY: z.number().min(-1).max(1),
  zoom: z.number().min(0.5).max(4),
  rotation: z.number().min(-180).max(180),
  speed: z.number().min(0.25).max(4),
  volume: z.number().min(0).max(4),
  muted: z.boolean(),
  fadeInMs: z.number().int().min(0).max(60000),
  fadeOutMs: z.number().int().min(0).max(60000),
  transitionMs: z.number().int().min(0).max(5000),
});

const track = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['video', 'audio', 'subtitle', 'text']),
  name: z.string().max(120),
  visible: z.boolean(),
  locked: z.boolean(),
  clips: z.array(clip).max(200),
});

const cue = z.object({
  id: z.string().min(1).max(80),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  text: z.string().max(1000),
  style: z.object({}).passthrough(),
});

const textOverlay = z.object({
  id: z.string().min(1).max(80),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  text: z.string().max(500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  fontSize: z.number().int().min(8).max(200),
  color: z.string().max(32),
  animation: z.enum(['none', 'fade', 'slide']),
});

export const timelineSchema = z.object({
  tracks: z.array(track).max(20),
  subtitles: z.array(cue).max(1000),
  texts: z.array(textOverlay).max(200),
  settings: z.object({
    width: z.number().int().min(360).max(2160),
    height: z.number().int().min(640).max(3840),
    snapMs: z.number().int().min(0).max(1000),
    timelineZoom: z.number().min(0.2).max(20),
  }),
});

export const saveTimelineSchema = z.object({ timeline: timelineSchema });
export const versionSchema = z.object({ label: z.string().min(1).max(120).default('Manual checkpoint') });

export const assetSchema = z.object({
  kind: z.enum(['video', 'audio', 'text', 'image']),
  label: z.string().min(1).max(200),
  storageKey: z.string().max(255).nullable().optional(),
  rightsId: z.number().int().positive().nullable().optional(),
  config: z.object({}).passthrough().default({}),
}).refine(
  (value) => (value.storageKey ? value.rightsId != null : true),
  { message: 'Media assets require a verified rights declaration', path: ['rightsId'] },
);
