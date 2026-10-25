import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadCache } from './read-cache.ts';

await test('concurrent readers share a request; explicit refresh gets new data', async () => {
  const cache = new ReadCache();
  let requests = 0;
  const load = async () => ++requests;
  assert.deepEqual(
    await Promise.all([cache.read('a:feed', load), cache.read('a:feed', load)]),
    [1, 1],
  );
  assert.equal(await cache.read('a:feed', load), 1);
  assert.equal(await cache.read('a:feed', load, true), 2);
  assert.equal(await cache.read('b:feed', load), 3);
});
await test('account/logout invalidation prevents late requests from repopulating cache', async () => {
  const cache = new ReadCache();
  let finish!: (value: number) => void;
  const old = cache.read(
    'feed',
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  cache.clear();
  await cache.read('feed', async () => 2);
  finish(1);
  await old;
  assert.equal(cache.peek('feed'), 2);
});
await test('failed reads are retryable, expiration and size are bounded', async () => {
  const cache = new ReadCache();
  await assert.rejects(
    cache.read('failure', async () => {
      throw Error('offline');
    }),
  );
  assert.equal(await cache.read('failure', async () => 7), 7);
  assert.equal(cache.peek('failure', Date.now() + 61_000), undefined);
  for (let i = 0; i < 101; i++) await cache.read(String(i), async () => i);
  assert.equal(cache.peek('0'), undefined);
  assert.equal(cache.peek('100'), 100);
});
