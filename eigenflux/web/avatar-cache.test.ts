import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AvatarCache } from './avatar-cache.ts';

void test('a previously missing avatar expires so a later upload can appear', () => {
  const cache = new AvatarCache();
  cache.set('console:366123', '', 100);
  assert.equal(cache.fresh('console:366123', 101), true);
  assert.equal(cache.fresh('console:366123', 15_100), false);
  const url = '/api/v2/public/avatars/' + 'a'.repeat(32);
  assert.equal(cache.set('console:366123', url, 15_100), true);
  assert.equal(cache.get('console:366123'), url);
  assert.equal(cache.set('console:366123', url, 15_101), false);
  assert.equal(cache.fresh('console:366123', 315_101), false);
  assert.equal(
    cache.get('console:366123'),
    url,
    'keep visible image during refresh',
  );
});

void test('guest and signed-in results do not share visibility cache entries', () => {
  const cache = new AvatarCache();
  cache.set('console:366123', 'tide', 100);
  assert.equal(cache.get('guest:366123'), undefined);
  cache.clear();
  assert.equal(cache.get('console:366123'), undefined);
});

void test('previews track their source and unchanged refreshes do not replay animation', () => {
  const cache = new AvatarCache();
  const image = { avatar: 'first', preview: 'tiny', color: '#aabbcc' };
  cache.set('guest:3', 'first', 100, image);
  assert.deepEqual(cache.image('guest:3'), image);
  assert.equal(cache.set('guest:3', 'first', 200, { ...image }), false);
  cache.set('guest:3', 'second', 300, image);
  assert.equal(cache.image('guest:3'), undefined);
  assert.equal(cache.get('guest:3'), 'second');
});
