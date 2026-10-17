import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gorseItem, syncCatalog } from './sync.mjs';
const post = {
  id: '369648989592621057',
  state: 'published',
  visibility: 'public',
  published_at: 1792053797019,
  document: {
    title: '具体内容',
    summary: '公开摘要',
    body: '完整正文无需复制',
    tags: ['产品'],
  },
};
void test('catalog projection sends public metadata with exact IDs, not host memory or private posts', () => {
  const p = gorseItem(post);
  assert.equal(p.ItemId, 'post:369648989592621057');
  assert.equal(p.Comment, '具体内容\n公开摘要');
  assert.deepEqual(p.Labels, { tags: ['产品'] });
  assert.equal(gorseItem({ ...post, visibility: 'private' }), null);
  assert.equal(gorseItem({ ...post, state: 'draft' }), null);
});
void test('catalog sync preserves upstream data, reconciles removals only after a complete scan', async () => {
  const calls = [];
  const request = async (u, options) => {
    const url = new URL(u);
    calls.push({ url, options });
    let data = {};
    if (url.hostname === 'source')
      data = { data: { items: [post], next_cursor: '' } };
    if (url.hostname === 'gorse' && options.method === 'GET')
      data = {
        Items: [{ ItemId: 'post:9' }, { ItemId: 'external:1' }],
        Cursor: '',
      };
    return { ok: true, json: async () => data };
  };
  assert.deepEqual(
    await syncCatalog({
      source: 'https://source',
      engine: 'http://gorse',
      key: 'fixture',
      request,
    }),
    { indexed: 1, removed: 1 },
  );
  assert.equal(calls.filter((c) => c.options.method === 'DELETE').length, 1);
  assert.ok(calls.some((c) => c.url.pathname === '/api/item/post%3A9'));
});
void test('a source outage or broken pagination never clears the Gorse index', async () => {
  let deletes = 0,
    reads = 0;
  const request = async (u, options) => {
    if (options.method === 'DELETE') deletes++;
    if (new URL(u).hostname === 'source') {
      reads++;
      if (reads === 2) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({ data: { items: [post], next_cursor: 'more' } }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  await assert.rejects(
    syncCatalog({
      source: 'https://source',
      engine: 'http://gorse',
      key: 'fixture',
      request,
    }),
    /503/,
  );
  assert.equal(deletes, 0);
});
