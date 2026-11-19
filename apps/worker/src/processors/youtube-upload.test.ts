import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyError, nextOffsetFromRange, quotaReason } from './youtube-upload.js';

test('resumable Range header advances to the next unwritten byte', () => {
  assert.equal(nextOffsetFromRange('bytes=0-5242879', 100), 5242880);
  assert.equal(nextOffsetFromRange(null, 100), 100);
  assert.equal(nextOffsetFromRange('garbage', 100), 100);
});

test('quota and rate-limit responses are detected', () => {
  assert.equal(quotaReason('', 429), true);
  assert.equal(quotaReason('quotaExceeded', 403), true);
  assert.equal(quotaReason('', 400), false);
});

test('auth, restriction, and generic errors are classified distinctly', () => {
  const auth = classifyError({ message: 'bad token', reason: 'invalid_grant', status: 401 });
  assert.equal(auth.name, 'UploadFailure');
  assert.equal((auth as Error & { code: string }).code, 'YOUTUBE_AUTH_ERROR');

  const forbidden = classifyError({ message: 'not enabled', reason: 'forbidden', status: 403 });
  assert.equal((forbidden as Error & { code: string }).code, 'YOUTUBE_FORBIDDEN');

  const quota = classifyError({ message: 'slow down', reason: 'rateLimitExceeded', status: 403 });
  assert.match(quota.message, /quota/i);
});
