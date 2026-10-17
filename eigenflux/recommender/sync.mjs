import { pathToFileURL } from 'node:url';

// Data transport only: no scoring, quota, category balancing or synthetic events.
export function gorseItem(post) {
  if (
    !/^[1-9][0-9]*$/.test(post.id) ||
    post.state !== 'published' ||
    post.visibility !== 'public'
  )
    return null;
  const d = post.document || {};
  return {
    ItemId: `post:${post.id}`,
    IsHidden: false,
    Categories: [],
    Timestamp: new Date(post.published_at ?? post.created_at).toISOString(),
    Labels: { tags: d.tags || [] },
    Comment: [d.title, d.summary].filter(Boolean).join('\n'),
  };
}
export async function syncCatalog({ source, engine, key, request = fetch }) {
  const read = async (url, init = {}) => {
    const r = await request(url, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`catalog request failed (${r.status})`);
    return r.json();
  };
  const gorse = (path, method = 'GET', data) =>
    read(new URL(path, engine), {
      method,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  // Read the engine's actual catalog, including after a sync-worker restart.
  // Rewriting unchanged items invalidates Gorse caches and competes with reads.
  const existing = new Map();
  let cursor = '';
  const engineCursors = new Set();
  do {
    const u = new URL('/api/items', engine);
    u.searchParams.set('n', '1000');
    if (cursor) u.searchParams.set('cursor', cursor);
    const page = await gorse(u.pathname + u.search);
    if (!Array.isArray(page.Items) || typeof page.Cursor !== 'string')
      throw new Error('invalid Gorse catalog response');
    for (const item of page.Items) existing.set(item.ItemId, item);
    cursor = page.Cursor;
    if (cursor && engineCursors.has(cursor))
      throw new Error('repeated Gorse catalog cursor');
    engineCursors.add(cursor);
  } while (cursor);
  const signature = (item) =>
    JSON.stringify({
      hidden: item.IsHidden,
      categories: item.Categories || [],
      timestamp: new Date(item.Timestamp).toISOString(),
      tags: item.Labels?.tags || [],
      comment: item.Comment || '',
    });
  const cursors = new Set(),
    seen = new Set();
  let count = 0,
    updated = 0;
  do {
    const u = new URL('/api/v2/guest/feed', source);
    u.searchParams.set('scope', 'latest');
    if (cursor) u.searchParams.set('cursor', cursor);
    const envelope = await read(u),
      page = envelope.data ?? envelope;
    if (!Array.isArray(page.items) || typeof page.next_cursor !== 'string')
      throw new Error('invalid public catalog response');
    const items = page.items.map(gorseItem).filter(Boolean);
    for (const i of items) seen.add(i.ItemId);
    const changes = items.filter(
      (i) =>
        !existing.has(i.ItemId) ||
        signature(i) !== signature(existing.get(i.ItemId)),
    );
    if (changes.length) {
      await read(new URL('/api/v2/internal/recommendation/catalog', source), {
        method: 'POST',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: changes.map((i) => i.ItemId.slice(5)) }),
      });
      for (const item of changes) existing.set(item.ItemId, item);
    }
    updated += changes.length;
    count += items.length;
    cursor = page.next_cursor;
    if (cursor && cursors.has(cursor))
      throw new Error('repeated public catalog cursor');
    cursors.add(cursor);
  } while (cursor);
  // Only reconcile removals after a complete successful source scan. Previously
  // public content is deleted from the index, not merely made less relevant.
  let removed = 0;
  for (const i of existing.values())
    if (i.ItemId.startsWith('post:') && !seen.has(i.ItemId)) {
      await gorse('/api/item/' + encodeURIComponent(i.ItemId), 'DELETE');
      removed++;
    }
  return { indexed: count, updated, removed };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = {
    source: process.env.AGENTNET_PUBLIC_URL,
    engine: process.env.AGENTNET_GORSE_URL,
    key: process.env.AGENTNET_GORSE_API_KEY,
  };
  if (!options.source || !options.engine || !options.key)
    throw new Error('Set public source, private Gorse URL and API key');
  do {
    try {
      console.log(JSON.stringify(await syncCatalog(options)));
    } catch (e) {
      console.error(e.message);
      if (!process.argv.includes('--watch')) process.exitCode = 1;
    }
    if (!process.argv.includes('--watch')) break;
    await new Promise((resolve) => setTimeout(resolve, 300000));
  } while (process.argv.includes('--watch'));
}
