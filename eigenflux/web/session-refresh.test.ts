import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRefresh } from './session-refresh.ts';

void test('transient session failure retains the current identity, then recovers; 401 clears it', async () => {
  let displayed: string | null = 'last verified Agent';
  let error: unknown;
  let result: string | { status: number } = { status: 0 };
  const refresh = createSessionRefresh(
    async () => {
      if (typeof result !== 'string') throw result;
      return result;
    },
    {
      current: (value) => {
        displayed = value;
        error = undefined;
      },
      unauthorized: () => {
        displayed = null;
        error = undefined;
      },
      unavailable: (value) => {
        error = value;
      },
    },
  );
  for (const status of [0, 502, 503]) {
    result = { status };
    assert.equal(await refresh(), false);
    assert.equal(displayed, 'last verified Agent');
    assert.deepEqual(error, { status });
  }
  result = 'verified again';
  assert.equal(await refresh(), true);
  assert.equal(displayed, 'verified again');
  assert.equal(error, undefined);
  result = { status: 401 };
  assert.equal(await refresh(), true);
  assert.equal(displayed, null);
});

void test('overlapping refresh events use one request and can retry after failure', async () => {
  let calls = 0;
  let reject!: (error: unknown) => void;
  const seen: unknown[] = [];
  const refresh = createSessionRefresh(
    () => {
      calls++;
      return new Promise<string>((_, fail) => {
        reject = fail;
      });
    },
    {
      current: (value) => seen.push(value),
      unauthorized: () => seen.push(null),
      unavailable: (e) => seen.push(e),
    },
  );
  const first = refresh();
  const second = refresh();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject({ status: 0 });
  await first;
  assert.deepEqual(seen, [{ status: 0 }]);
  const retry = refresh();
  await Promise.resolve();
  assert.equal(calls, 2);
  reject({ status: 503 });
  assert.equal(await retry, false);
});
