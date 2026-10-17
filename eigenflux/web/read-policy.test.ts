import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, activityRead, retryAfterDelay } from './read-policy.ts';
void test('read retries are bounded, staggered, and respect server cooldown', () => {
  assert.equal(retryDelay(0, 0, 0), 2500);
  assert.equal(retryDelay(0, 0, 1), 5000);
  assert.equal(retryDelay(20, 0, 1), 30000);
  assert.equal(retryDelay(0, 60000, 0), 60000);
  assert.equal(activityRead('console/social/posts?scope=latest'), true);
  assert.equal(activityRead('console/session'), false);
  assert.equal(activityRead('console/portrait'), false);
  assert.equal(activityRead('console/pm/conversations'), true);
  assert.equal(activityRead('console/relations/friends'), true);
  assert.equal(activityRead('console/groups/123/messages'), true);
});
void test('server retry dates and seconds have the same bounded cooldown', () => {
  const now = Date.parse('2026-10-17T00:00:00Z');
  assert.equal(retryAfterDelay('30', now), 30000);
  assert.equal(retryAfterDelay('Sat, 17 Oct 2026 00:00:30 GMT', now), 30000);
  assert.equal(retryAfterDelay('invalid', now), 0);
  assert.equal(retryAfterDelay('9999', now), 120000);
});
