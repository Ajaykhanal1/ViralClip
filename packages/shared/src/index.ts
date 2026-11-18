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
  videoIngestion: 'video-ingestion',
  transcription: 'transcription',
  aiAnalysis: 'ai-analysis',
  clipGeneration: 'clip-generation',
  videoRendering: 'video-rendering',
  youtubeUpload: 'youtube-upload',
  /** @deprecated use videoIngestion; kept for Phase 1 compatibility */
  videoPipeline: 'video-pipeline',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type ProcessingJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ProcessingJob {
  id: number;
  userId: number;
  projectId: number;
  sourceVideoId: number;
  queueName: string;
  jobType: string;
  bullmqJobId: string | null;
  status: ProcessingJobStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  cancelRequested: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingJobLog {
  id: number;
  jobId: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProcessingArtifact {
  id: number;
  jobId: number;
  sourceVideoId: number;
  kind: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Base payload for processing jobs. Processing happens in workers only. */
export interface ProcessingJobPayload {
  processingJobId: number;
  userId: number;
  projectId: number;
  sourceVideoId: number;
  storageKey?: string;
  requestedAt: string;
}

export interface VideoIngestionJob extends ProcessingJobPayload {
  queue: 'video-ingestion';
}
export interface TranscriptionJob extends ProcessingJobPayload {
  queue: 'transcription';
}
export interface AiAnalysisJob extends ProcessingJobPayload {
  queue: 'ai-analysis';
}
export interface ClipGenerationJob extends ProcessingJobPayload {
  queue: 'clip-generation';
}
export interface VideoRenderingJob extends ProcessingJobPayload {
  queue: 'video-rendering';
}
export interface YoutubeUploadJob extends ProcessingJobPayload {
  queue: 'youtube-upload';
}

/** Legacy payload; Phase 1 compatibility. */
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
export type SourceVideoStatus =
  | 'pending'
  | 'awaiting_authorized_source'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';
export type UploadSessionStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'canceled' | 'expired';

export type RightsOwnershipType = 'original' | 'licensed' | 'public_domain' | 'unknown';
export type RightsStatus = 'declared' | 'pending_review' | 'verified' | 'rejected' | 'expired';
export type RightsSubjectType = 'source_video' | 'music' | 'audio_asset' | 'other';
export type CopyrightCheckContext = 'publish' | 'render' | 'upload_youtube' | 'manual';
export type CopyrightCheckResult = 'pass' | 'blocked';
export type CopyrightClaimStatus = 'open' | 'disputed' | 'resolved' | 'rejected';

export interface ContentLicense {
  id: number;
  contentRightsId: number;
  licenseType: string;
  licensor: string | null;
  licenseReference: string | null;
  permissionDetails: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface RightsDocument {
  id: number;
  contentRightsId: number;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface ContentRights {
  id: number;
  projectId: number;
  sourceVideoId: number | null;
  subjectType: RightsSubjectType;
  subjectLabel: string;
  ownershipType: RightsOwnershipType;
  status: RightsStatus;
  commercialUse: boolean;
  derivativeWork: boolean;
  youtubePublication: boolean;
  musicRightsConfirmed: boolean;
  userConfirmed: boolean;
  confirmedAt: string | null;
  permissionDetails: string | null;
  notes: string | null;
  createdBy: number;
  updatedBy: number;
  createdAt: string;
  updatedAt: string;
  licenses: ContentLicense[];
  documents: RightsDocument[];
}

export interface CopyrightCheck {
  id: number;
  projectId: number;
  sourceVideoId: number | null;
  context: CopyrightCheckContext;
  result: CopyrightCheckResult;
  reasons: string[];
  checkedBy: number;
  createdAt: string;
}

export interface CopyrightClaim {
  id: number;
  projectId: number;
  sourceVideoId: number | null;
  claimant: string;
  claimReference: string | null;
  status: CopyrightClaimStatus;
  description: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface CopyrightEvent {
  id: number;
  projectId: number;
  sourceVideoId: number | null;
  contentRightsId: number | null;
  eventType: string;
  actorId: number;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface PublishingRightsCheck {
  allowed: boolean;
  reasons: string[];
  checks: Array<{ code: string; ok: boolean; message: string }>;
}

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
  processingJobs: Array<{ type: 'project' | 'video' | 'clip' | 'processing'; id: number; name: string; status: string }>;
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
