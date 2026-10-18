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
    body: '正文包含具体限制和实际内容',
    tags: ['产品'],
  },
};
void test('catalog projection sends public metadata with exact IDs, not host memory or private posts', () => {
  const p = gorseItem(post);
  assert.equal(p.ItemId, 'post:369648989592621057');
  assert.equal(p.Comment, '具体内容\n公开摘要\n正文包含具体限制和实际内容');
  assert.deepEqual(p.Labels, { tags: ['产品'], content_revision: 1 });
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
    { indexed: 1, updated: 1, removed: 1 },
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
    return { ok: true, json: async () => ({ Items: [], Cursor: '' }) };
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
void test('worker restarts do not rewrite unchanged items; edits, new posts and removals still sync', async () => {
  let source = [post];
  const db = new Map([[gorseItem(post).ItemId, gorseItem(post)]]);
  const writes = [];
  const request = async (u, options) => {
    const url = new URL(u);
    let data = {};
    if (url.hostname === 'source' && options.method === 'POST') {
      const {post_ids} = JSON.parse(options.body);
      const items = source.filter(p => post_ids.includes(p.id)).map(gorseItem);
      writes.push(...items);
      for (const item of items) db.set(item.ItemId, item);
      data = {indexed: items.length};
    } else if (url.hostname === 'source') data = { items: source, next_cursor: '' };
    else if (options.method === 'GET')
      data = { Items: [...db.values()], Cursor: '' };
    else if (options.method === 'POST') {
      const items = JSON.parse(options.body);
      writes.push(...items);
      for (const item of items) db.set(item.ItemId, item);
    } else if (options.method === 'DELETE')
      db.delete(decodeURIComponent(url.pathname.split('/').at(-1)));
    return { ok: true, json: async () => data };
  };
  const run = () =>
    syncCatalog({
      source: 'https://source',
      engine: 'http://gorse',
      key: 'test',
      request,
    });
  for (let i = 0; i < 3; i++)
    assert.deepEqual(await run(), { indexed: 1, updated: 0, removed: 0 });
  assert.equal(writes.length, 0);
  // The public feed intentionally hides bodies. Comparing it with the full
  // indexed text must not turn every read into an expensive rewrite.
  source = [{ ...post, document: { ...post.document, body: '', summary: '短摘要' } }];
  assert.deepEqual(await run(), { indexed: 1, updated: 0, removed: 0 });
  assert.equal(writes.length, 0);
  source = [
    { ...post, revision: 2, document: { ...post.document, body: '正文条件改变，标题不变' } },
    { ...post, id: '369648989592621058' },
  ];
  assert.deepEqual(await run(), { indexed: 2, updated: 2, removed: 0 });
  assert.equal(writes.length, 2);
  assert.deepEqual(await run(), { indexed: 2, updated: 0, removed: 0 });
  source = [source[1]];
  assert.deepEqual(await run(), { indexed: 1, updated: 0, removed: 1 });
  assert.equal(db.has(gorseItem(post).ItemId), false);
});
void test('an incomplete engine scan fails before mutation', async () => {
  let writes = 0;
  await assert.rejects(
    syncCatalog({
      source: 'https://source',
      engine: 'http://gorse',
      key: 'test',
      request: async (u, options) => {
        if (options.method !== 'GET') writes++;
        return {
          ok: true,
          json: async () => ({ Items: [gorseItem(post)], Cursor: 'repeated' }),
        };
      },
    }),
    /repeated Gorse/,
  );
  assert.equal(writes, 0);
});
