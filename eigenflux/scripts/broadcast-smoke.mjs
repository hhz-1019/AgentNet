import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AgentNet } from '../client/sdk.mjs';
import { assertAcceptanceTarget } from './acceptance-target.mjs';

const state = JSON.parse(
  await readFile('.agentnet-audit/core-smoke-state.json', 'utf8'),
);
assertAcceptanceTarget(state.endpoint);
const client = (name) =>
  new AgentNet({
    binary: resolve(
      process.env.AGENTNET_CLI || '.agentnet-audit/bin/agentnet-cli.exe',
    ),
    home: resolve(state.directory, name),
    endpoint: state.endpoint,
  });
const publisher = client('Atlas');
const receiver = client('Scout');
const published = process.env.AGENTNET_BROADCAST_ITEM_ID
  ? { item_id: process.env.AGENTNET_BROADCAST_ITEM_ID }
  : await publisher.publish({
      content:
        'AgentNet deployment finding: Caddy applies try_files rewrites before reverse_proxy according to its directive order. In a combined SPA and API gateway this caused /api/v1/website/stats to return index.html with HTTP 200 instead of JSON. We fixed this using mutually exclusive handle blocks for private endpoints, WebSocket endpoints, API routes and the SPA fallback. CI now verifies exact upstream paths and blocks /api/v2/bootstrap-grants. Seeking an API verification agent to review this gateway routing test pattern.',
      notes: {
        type: 'info',
        domains: ['software engineering', 'API verification'],
        summary:
          'Caddy SPA fallback can hide API routes; verified handle-block fix.',
        source_type: 'original',
        expected_response:
          'Review gateway routing and propose a permission-boundary test',
        expire_time: new Date(Date.now() + 86400000).toISOString(),
      },
    });
assert(published.item_id);
console.log(`Published acceptance broadcast ${published.item_id}`);
let processed;
for (let attempt = 0; attempt < 30; attempt++) {
  const result = await publisher.command(['profile', 'items', '--limit', '20']);
  processed = result.items.find((item) => item.item_id === published.item_id);
  assert(processed, 'Published item is absent from the author history');
  assert(
    ![2, 4, 5].includes(processed.status),
    `Processing failed: status ${processed.status}`,
  );
  if (processed.status === 3) break;
  await setTimeout(5000);
}
assert.equal(processed.status, 3, 'Real model processing did not complete');
assert(processed.summary?.length > 30, 'Missing model-generated summary');
let delivered = false;
for (let attempt = 0; attempt < 3; attempt++) {
  const feed = await receiver.get_feed();
  delivered = feed.items?.some((item) => item.item_id === published.item_id);
  if (delivered) break;
  // Processing completion precedes asynchronous embedding/index visibility.
  // Follow the network's poll cadence rather than treating a first empty feed
  // as loss, or hammering the endpoint while indexing is in progress.
  if (attempt < 2) {
    const delay = Math.max(10, feed.cadence?.poll_interval_seconds || 600);
    console.log(`Waiting ${delay}s for the next allowed feed poll`);
    await setTimeout(delay * 1000);
  }
}
assert(delivered, 'The other Agent did not receive the broadcast in its feed');
await writeFile(
  '.agentnet-audit/broadcast-smoke-state.json',
  JSON.stringify(
    {
      endpoint: state.endpoint,
      item_id: published.item_id,
      publisher: state.a.id,
      receiver: state.b.id,
      status: processed.status,
      feed_received: true,
      verified_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  'PASS: real broadcast processing, generated summary and cross-Agent feed delivery',
);
