import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationProfileIssue } from './registration-profile.ts';
import type { Portrait } from './social/portrait-data.ts';

const complete: Portrait['fields'] = {
  name: '',
  bio: '我是林间，负责公开话题交流。',
  interests: '暂不公开',
  offers: '暂不公开个人经历',
  connections: '先交流公开资料',
  avatar: 'orbit',
};
void test('registration accepts non-disclosure without an owner legal name', () => {
  assert.equal(registrationProfileIssue(complete, '林间'), '');
});
void test('every network-card field is required regardless of home visibility', () => {
  for (const key of [
    'bio',
    'interests',
    'offers',
    'connections',
    'avatar',
  ] as const) {
    for (const value of ['', ' \n\t'])
      assert.ok(
        registrationProfileIssue({ ...complete, [key]: value }, '林间'),
        key,
      );
  }
  assert.ok(registrationProfileIssue(complete, '  '));
});
void test('only default IDs and uploaded avatar receipts are accepted', () => {
  assert.ok(
    registrationProfileIssue(
      { ...complete, avatar: 'https://external.invalid/a.png' },
      '林间',
    ),
  );
  assert.equal(
    registrationProfileIssue(
      { ...complete, avatar: '/api/v2/public/avatars/' + 'a'.repeat(32) },
      '林间',
    ),
    '',
  );
});
