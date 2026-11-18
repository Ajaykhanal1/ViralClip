export const API_PREFIX = '/api/v1';

/** Auth cookies are HTTP-only. Shared so the API and the web proxy cannot drift. */
export const AUTH_COOKIE_NAMES = {
  access: 'vc_access',
  refresh: 'vc_refresh',
} as const;

/** Development only. The API refuses to start in production with this value. */
export const DEV_AUTH_ACCESS_SECRET = 'viralclip-dev-only-access-secret-change-me-32';

/** BullMQ queue names. Kept here so producers and workers cannot drift apart. */
export const QUEUE_NAMES = {
  videoPipeline: 'video-pipeline',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Payload for the video processing pipeline. Processing happens in workers only. */
export interface VideoPipelineJob {
  videoId: number;
  projectId: number;
  storageKey: string;
  requestedAt: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId?: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface HealthPayload {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export type DependencyStatus = 'up' | 'down';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
  error?: string;
}

export interface ReadinessPayload {
  status: 'ok' | 'degraded';
  checks: {
    mysql: DependencyCheck;
    redis: DependencyCheck;
  };
  timestamp: string;
}

export type UserRole = 'user' | 'admin';

/** Safe user shape returned by the API. Never includes password hashes or tokens. */
export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
}

export type ProjectStatus = 'draft' | 'processing' | 'ready' | 'failed';
export type VideoStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
export type ClipStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type SourceVideoType = 'upload' | 'youtube';
export type SourceVideoStatus = 'pending' | 'awaiting_authorized_source' | 'ready' | 'failed';
export type UploadSessionStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'canceled' | 'expired';

export interface UploadSession {
  id: number;
  projectId: number;
  originalFilename: string;
  mimeType: string | null;
  declaredSizeBytes: number | null;
  status: UploadSessionStatus;
  bytesReceived: number;
  expiresAt: string;
  createdAt: string;
}

export interface MediaAsset {
  id: number;
  sourceVideoId: number;
  kind: 'original' | 'authorized_source';
  storageKey: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  createdAt: string;
}

export interface SourceVideo {
  id: number;
  projectId: number;
  sourceType: SourceVideoType;
  status: SourceVideoStatus;
  title: string;
  originalFilename: string | null;
  sourceUrl: string | null;
  youtubeVideoId: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  assets: MediaAsset[];
}

export interface Project {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectActivity {
  id: number;
  projectId: number;
  userId: number;
  action: string;
  message: string;
  createdAt: string;
}

export interface ProjectListResult {
  projects: Project[];
  total: number;
}

export interface DashboardStats {
  totalProjects: number;
  totalImportedVideos: number;
  totalGeneratedClips: number;
  totalRenderedShorts: number;
  recentProjects: Project[];
  recentActivities: Array<ProjectActivity & { projectName: string }>;
  processingJobs: Array<{ type: 'project' | 'video' | 'clip'; id: number; name: string; status: string }>;
}

export interface Video {
  id: number;
  projectId: number;
  originalFilename: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  status: VideoStatus;
  createdAt: string;
}

export interface Clip {
  id: number;
  videoId: number;
  title: string;
  startSeconds: number;
  endSeconds: number;
  storageKey: string | null;
  status: ClipStatus;
  viralityScore: number | null;
  createdAt: string;
}

export interface RedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: Record<string, never>;
}

export function redisConnectionFromUrl(url: string): RedisConnection {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis protocol: ${parsed.protocol}`);
  }

  const db = Number(parsed.pathname.replace('/', '') || 0);
  if (!Number.isInteger(db) || db < 0) {
    throw new Error(`Invalid Redis database index in URL: ${url}`);
  }

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    db,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
