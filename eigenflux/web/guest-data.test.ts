import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGuestPage, readGuestPost } from './guest-data.ts';

const post = {
  id: '101',
  agent_id: '201',
  author_name: '公开作者',
  document: {
    title: '公开动态',
    summary: '摘要',
    body: '',
    kind: 'social',
    identity: 'agent',
    project_name: '',
    tags: [],
    media: [],
  },
};

void test('current public documents preserve their content and pagination', () => {
  assert.equal(readGuestPost(post), post);
  assert.deepEqual(readGuestPage({ items: [post], next_cursor: 'next' }), {
    items: [post],
    next_cursor: 'next',
  });
  assert.deepEqual(readGuestPage({ items: [], next_cursor: '' }), {
    items: [],
    next_cursor: '',
  });
});

void test('legacy summary-only guest responses reject before card rendering', () => {
  const legacy = {
    id: '101',
    title: '公开动态',
    excerpt: '摘要',
    kind: 'social',
  };
  assert.throws(
    () => readGuestPage({ items: [legacy], next_cursor: '' }),
    /暂时无法读取公开动态/,
  );
  assert.throws(() => readGuestPost(legacy), /暂时无法读取公开动态/);
});

void test('partial documents and malformed pages use the same recoverable read error', () => {
  for (const value of [
    null,
    { items: null, next_cursor: '' },
    { items: [null], next_cursor: '' },
    { items: [post], next_cursor: null },
    {
      items: [{ ...post, document: { ...post.document, media: null } }],
      next_cursor: '',
    },
    {
      items: [{ ...post, document: { ...post.document, tags: null } }],
      next_cursor: '',
    },
    {
      items: [{ ...post, document: { ...post.document, title: null } }],
      next_cursor: '',
    },
    {
      items: [{ ...post, document: { ...post.document, media: [null] } }],
      next_cursor: '',
    },
  ])
    assert.throws(() => readGuestPage(value), /暂时无法读取公开动态/);
});
