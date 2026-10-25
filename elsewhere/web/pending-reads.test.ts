import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PendingReads } from './pending-reads.ts';

await test('overlapping reads share transport but never share mutable results or cache completed data', async () => {
  const reads = new PendingReads();
  let requests = 0;
  const request = async () => {
    requests++;
    return { memories: ['first'] };
  };
  const [a, b] = await Promise.all([
    reads.read('owner:path', request),
    reads.read('owner:path', request),
  ]);
  assert.equal(requests, 1);
  a.memories.push('next page');
  assert.deepEqual(b.memories, ['first']);
  await reads.read('owner:path', request);
  assert.equal(requests, 2);
});

await test('refresh and identity changes cannot reuse an old in-flight response', async () => {
  const reads = new PendingReads();
  let oldResolve!: (value: string) => void;
  let newResolve!: (value: string) => void;
  const old = reads.read(
    'a:path',
    () =>
      new Promise<string>((r) => {
        oldResolve = r;
      }),
  );
  reads.clear();
  const fresh = reads.read(
    'a:path',
    () =>
      new Promise<string>((r) => {
        newResolve = r;
      }),
  );
  oldResolve('old');
  assert.equal(await old, 'old');
  const shared = reads.read('a:path', async () => {
    throw Error('old completion deleted new request');
  });
  assert.equal(
    await reads.read('b:path', async () => 'other owner'),
    'other owner',
  );
  newResolve('new');
  assert.deepEqual(await Promise.all([fresh, shared]), ['new', 'new']);
});

await test('failed reads are removed so retries can succeed', async () => {
  const reads = new PendingReads();
  await assert.rejects(
    reads.read('path', async () => {
      throw Error('offline');
    }),
    /offline/,
  );
  assert.equal(await reads.read('path', async () => 'recovered'), 'recovered');
});
