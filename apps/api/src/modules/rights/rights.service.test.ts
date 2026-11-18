import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentRights } from '@viralclip/shared';
import { evaluatePublishingRights } from './rights.service.js';

function baseRights(overrides: Partial<ContentRights> = {}): ContentRights {
  return {
    id: 1,
    projectId: 1,
    sourceVideoId: 10,
    subjectType: 'source_video',
    subjectLabel: 'Main footage',
    ownershipType: 'original',
    status: 'verified',
    commercialUse: true,
    derivativeWork: true,
    youtubePublication: true,
    musicRightsConfirmed: true,
    userConfirmed: true,
    confirmedAt: new Date().toISOString(),
    permissionDetails: null,
    notes: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    licenses: [],
    documents: [],
    ...overrides,
  };
}

test('publishing check blocks when rights are missing', () => {
  const result = evaluatePublishingRights([], { context: 'publish' });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes('No rights declaration found')));
});

test('publishing check blocks when rights declaration is rejected', () => {
  const result = evaluatePublishingRights([baseRights({ status: 'rejected' })], {
    sourceVideoId: 10,
    context: 'publish',
  });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes('rejected')));
});

test('publishing check blocks when a license is expired', () => {
  const result = evaluatePublishingRights(
    [
      baseRights({
        ownershipType: 'licensed',
        licenses: [
          {
            id: 1,
            contentRightsId: 1,
            licenseType: 'sync',
            licensor: 'Acme',
            licenseReference: 'L-1',
            permissionDetails: null,
            startsAt: '2020-01-01',
            expiresAt: '2000-01-01',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    { sourceVideoId: 10, context: 'publish' },
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes('expired')));
});

test('publishing check blocks when music permissions are missing', () => {
  const result = evaluatePublishingRights(
    [
      baseRights(),
      baseRights({
        id: 2,
        sourceVideoId: null,
        subjectType: 'music',
        subjectLabel: 'Track',
        ownershipType: 'licensed',
        musicRightsConfirmed: false,
        licenses: [
          {
            id: 2,
            contentRightsId: 2,
            licenseType: 'music',
            licensor: 'Label',
            licenseReference: null,
            permissionDetails: null,
            startsAt: null,
            expiresAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    { sourceVideoId: 10, context: 'publish' },
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes('music/audio rights not confirmed')));
});

test('publishing check passes for successful rights declarations', () => {
  const result = evaluatePublishingRights(
    [
      baseRights(),
      baseRights({
        id: 2,
        sourceVideoId: null,
        subjectType: 'music',
        subjectLabel: 'Track',
        ownershipType: 'original',
        musicRightsConfirmed: true,
      }),
    ],
    { sourceVideoId: 10, context: 'publish' },
  );
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
});
