import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitExceeded, usagePercentage } from './usage.limits.js';

test('null limits are unlimited', () => {
  assert.equal(limitExceeded(1_000_000, 500, null), false);
  assert.equal(usagePercentage(1_000_000, null), null);
});

test('limits are enforced at the boundary', () => {
  assert.equal(limitExceeded(9, 1, 10), false);
  assert.equal(limitExceeded(10, 1, 10), true);
  assert.equal(limitExceeded(0, 2, 10), false);
});

test('usage percentage is rounded and safe for zero limits', () => {
  assert.equal(usagePercentage(5, 10), 50);
  assert.equal(usagePercentage(2, 3), 67);
  assert.equal(usagePercentage(1, 0), null);
});
