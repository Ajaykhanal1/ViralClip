import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

/** Logs installed media tool versions. Missing tools warn instead of blocking startup. */
export async function logMediaToolVersions(log: Logger): Promise<void> {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      const { stdout } = await execFileAsync(tool, ['-version']);
      log.info({ tool, version: stdout.split('\n')[0]?.trim() }, 'media tool available');
    } catch {
      log.warn({ tool }, 'media tool not found on PATH; media processing will fail');
    }
  }
}
