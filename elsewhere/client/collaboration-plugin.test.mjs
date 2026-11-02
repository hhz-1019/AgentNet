import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerConnection } from './collaboration-plugin.mjs';

async function harness({
  existing = false,
  failure = false,
  url = 'https://example.test/bind',
} = {}) {
  const home = await mkdtemp(join(tmpdir(), 'elsewhere-plugin-'));
  if (existing) {
    await mkdir(join(home, 'servers/agentnet'), { recursive: true });
    await writeFile(
      join(home, 'servers/agentnet/agent-v2-credentials.json'),
      '{}',
    );
  }
  let handler;
  const calls = [];
  const client = {
    ready: true,
    cliHome: home,
    endpoint: 'https://example.test',
    async collaboration_project() {
      if (failure) throw new Error('Private diagnostic');
      return { projects: [] };
    },
    async command(args) {
      calls.push(args);
      return { console_url: url };
    },
  };
  registerConnection(
    {
      registerTool(n, s, fn) {
        handler = fn;
      },
    },
    client,
  );
  const invoke = async (request) => {
    const r = await handler(request);
    return { error: r.isError, ...JSON.parse(r.content[0].text) };
  };
  return { invoke, calls };
}
await test('fresh install needs binding and does not provision implicitly', async () => {
  const h = await harness();
  assert.equal((await h.invoke({ action: 'status' })).state, 'needs_binding');
  assert.equal(h.calls.length, 0);
});
await test('existing authenticated owner is ready without registration', async () => {
  const h = await harness({ existing: true });
  assert.equal((await h.invoke({ action: 'status' })).state, 'connected');
  assert.equal(h.calls.length, 0);
});
await test('authentication failure preserves identity and never provisions', async () => {
  const h = await harness({ existing: true, failure: true });
  const r = await h.invoke({ action: 'status' });
  assert.equal(r.state, 'connection_needs_attention');
  assert.equal(h.calls.length, 0);
  assert.ok(!JSON.stringify(r).includes('Private diagnostic'));
});
await test('explicit setup validates profile, preserves identity, returns only owner URL', async () => {
  const h = await harness({ existing: true });
  const r = await h.invoke({
    action: 'prepare',
    display_name: 'Pilot',
    draft: { test: true },
  });
  assert.equal(r.state, 'awaiting_owner_binding');
  assert.equal(h.calls[0][0], 'validate-profile');
  assert.ok(h.calls[1].includes('--require-existing-agent'));
});
await test('foreign binding URLs are rejected', async () => {
  const h = await harness({ url: 'https://foreign.test/bind' });
  const r = await h.invoke({
    action: 'prepare',
    display_name: 'Pilot',
    draft: {},
  });
  assert.equal(r.error, true);
  assert.ok(!JSON.stringify(r).includes('foreign.test'));
});

await test('binding URL cannot embed userinfo even on the configured origin', async () => {
  const h = await harness({ url: 'https://user:secret@example.test/bind' });
  const r = await h.invoke({
    action: 'prepare',
    display_name: 'Pilot',
    draft: {},
  });
  assert.equal(r.error, true);
  assert.ok(!JSON.stringify(r).includes('secret'));
});
