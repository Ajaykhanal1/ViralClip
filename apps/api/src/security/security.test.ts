import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import express from 'express';
import { corsOrigins } from '../config/env.js';
import { logger } from '../config/logger.js';
import { errorHandler } from '../http/errors.js';
import { detectVideoKind, validateVideoFile } from '../lib/upload-validation.js';
import { resolveStoragePath } from '../storage/local.js';
import { csrfGuard } from './csrf.js';
import { decryptToken, encryptToken } from './token-crypto.js';

logger.level = 'silent';

const tempDirs: string[] = [];
after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fakeVideo(bytes: Buffer, name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viralclip-upload-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

test('csrfGuard accepts safe methods, same-origin writes and bearer clients', async () => {
  const app = express();
  app.use(csrfGuard);
  app.all('/probe', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/probe`;
  try {
    const cases = [
      { method: 'GET', headers: { origin: 'https://evil.example' }, status: 200 },
      { method: 'POST', headers: {}, status: 200 },
      { method: 'POST', headers: { origin: corsOrigins[0]! }, status: 200 },
      { method: 'PUT', headers: { origin: 'https://evil.example' }, status: 403 },
      { method: 'DELETE', headers: { origin: 'null' }, status: 403 },
    ];
    for (const item of cases) {
      const res = await fetch(base, { method: item.method, headers: item.headers });
      assert.equal(res.status, item.status, `${item.method} ${JSON.stringify(item.headers)}`);
      if (item.status === 403) {
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, 'CSRF_REJECTED');
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('storage keys cannot escape the configured root', () => {
  for (const key of ['../secret.mp4', '..\\secret.mp4', '/etc/passwd', 'a/../../b', 'a\0b']) {
    assert.throws(() => resolveStoragePath(key), /Invalid storage/);
  }
  const resolved = resolveStoragePath('uploads/2026-01-01/video.mp4');
  assert.ok(resolved.endsWith(path.join('uploads', '2026-01-01', 'video.mp4')));
});

test('video uploads reject mismatched content and unsupported files', async () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]);

  const mp4File = await fakeVideo(mp4, 'clip.mp4');
  assert.equal(await detectVideoKind(mp4File), 'mp4');
  await validateVideoFile(mp4File, 'clip.mp4', 'video/mp4');

  const webmFile = await fakeVideo(webm, 'clip.webm');
  assert.equal(await detectVideoKind(webmFile), 'webm');
  await validateVideoFile(webmFile, 'clip.webm', 'video/webm');
  await assert.rejects(validateVideoFile(webmFile, 'clip.mp4', 'video/mp4'), /extension/);
  await assert.rejects(validateVideoFile(webmFile, 'clip.webm', 'image/png'), /MIME/);

  const textFile = await fakeVideo(Buffer.from('<script>alert(1)</script>'), 'clip.mp4');
  assert.equal(await detectVideoKind(textFile), null);
  await assert.rejects(validateVideoFile(textFile, 'clip.mp4', 'video/mp4'), /not a supported video/);
  assert.throws(() => resolveStoragePath('../secrets.env'));
});

test('encrypted OAuth tokens are authenticated and tamper-evident', () => {
  const encrypted = encryptToken('ya29.refresh-token');
  assert.equal(decryptToken(encrypted), 'ya29.refresh-token');
  assert.notEqual(encrypted, 'ya29.refresh-token');

  const [iv, tag, body] = encrypted.split('.');
  assert.ok(iv && tag && body);
  const flipped = Buffer.from(body, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => decryptToken([iv, tag, flipped.toString('base64')].join('.')), /unable to authenticate/);
  assert.throws(() => decryptToken('broken.value'), /Invalid encrypted token/);
});
