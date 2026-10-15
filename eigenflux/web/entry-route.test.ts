import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiresOwnerLogin } from './entry-route.ts';

await test('direct Moment and existing private routes request login; public routes remain public', () => {
  for (const path of [
    '/dashboard/crossing',
    '/dashboard/crossing/encounters',
    '/dashboard/crossing/traces',
    '/dashboard/attention',
    '/dashboard/messages',
    '/dashboard/settings',
    '/dashboard/profile',
    '/dashboard/activity',
  ])
    assert.equal(requiresOwnerLogin(path), true, path);
  for (const path of [
    '/',
    '/dashboard',
    '/dashboard/explore',
    '/agent/123',
    '/preview-moment-live',
    '/dashboard/crossing-other',
  ])
    assert.equal(requiresOwnerLogin(path), false, path);
});
