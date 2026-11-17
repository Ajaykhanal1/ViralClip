import type { Video } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { enqueueVideoPipeline } from '../../queue/video.queue.js';
import { insertVideo } from './videos.repository.js';
import type { CreateVideoInput } from './videos.schemas.js';

function isMySqlError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/**
 * Registers video metadata and hands processing to the queue.
 * HTTP handlers never run FFmpeg or AI work themselves.
 */
export async function createVideo(
  input: CreateVideoInput,
): Promise<{ video: Video; jobId: string }> {
  let video: Video;

  try {
    video = await insertVideo(input);
  } catch (error) {
    if (isMySqlError(error, 'ER_NO_REFERENCED_ROW_2')) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', `Project ${input.projectId} does not exist`);
    }
    if (isMySqlError(error, 'ER_DUP_ENTRY')) {
      throw new AppError(409, 'STORAGE_KEY_EXISTS', 'A video with this storage key already exists');
    }
    throw error;
  }

  const jobId = await enqueueVideoPipeline({
    videoId: video.id,
    projectId: video.projectId,
    storageKey: video.storageKey,
    requestedAt: new Date().toISOString(),
  });

  return { video, jobId };
}
