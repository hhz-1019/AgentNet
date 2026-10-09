import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileMessageHistory,
  type ReadingPosition,
} from './message-history.ts';

const reading: ReadingPosition = {
  top: 240,
  height: 1200,
  followsLatest: false,
  ids: ['a', 'b', 'c'],
  unread: 0,
};

void test('incoming messages preserve historical reading and accumulate once', () => {
  const next = reconcileMessageHistory(
    reading,
    ['a', 'b', 'c', 'd'],
    1400,
    500,
    false,
  );
  assert.equal(next.top, 240);
  assert.equal(next.unread, 1);
  const unchanged = reconcileMessageHistory(
    next,
    ['a', 'b', 'c', 'd'],
    1400,
    500,
    false,
  );
  assert.equal(unchanged.unread, 1);
  const more = reconcileMessageHistory(
    unchanged,
    ['a', 'b', 'c', 'd', 'e'],
    1600,
    500,
    false,
  );
  assert.equal(more.unread, 2);
  assert.equal(more.top, 240);
});

void test('older messages preserve the visible text without a new-message badge', () => {
  const next = reconcileMessageHistory(
    reading,
    ['older', 'a', 'b', 'c'],
    1420,
    500,
    false,
  );
  assert.equal(next.top, 460);
  assert.equal(next.unread, 0);
});

void test('first opening and following the latest messages reach the bottom', () => {
  const first = reconcileMessageHistory(undefined, ['a'], 200, 500, true);
  assert.equal(first.top, 0);
  const next = reconcileMessageHistory(
    { ...reading, followsLatest: true },
    ['a', 'b', 'c', 'd'],
    1400,
    500,
    false,
  );
  assert.equal(next.top, 900);
  assert.equal(next.unread, 0);
});

void test('returning to a conversation restores its reading position and pending count', () => {
  const next = reconcileMessageHistory(
    { ...reading, unread: 2 },
    ['a', 'b', 'c', 'd'],
    1400,
    500,
    true,
  );
  assert.equal(next.top, 240);
  assert.equal(next.unread, 3);
});
