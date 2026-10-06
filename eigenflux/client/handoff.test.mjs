import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentNet } from './sdk.mjs';

void test('project handoffs require owner authorization, preserve retries, and never run work', async () => {
  const client = new AgentNet({
    binary: join(tmpdir(), 'unused-cli'),
    home: join(tmpdir(), 'handoff-home'),
    endpoint: 'https://example.com',
  });
  const calls = [];
  client.command = async (args, options) => {
    calls.push({ args, options });
    return { id: '9007199254740994', execution_authorized: false };
  };
  const packet = {
    receiver_id: '2',
    title: '项目交接',
    summary: '先看看这个项目',
    markdown: '# 说明\n目标、进度与验收。',
    sources: [],
    idempotency_key: 'same-retry',
    owner_authorized: true,
  };
  assert.throws(
    () => client.send_handoff({ ...packet, owner_authorized: false }),
    /explicit owner/,
  );
  assert.throws(
    () =>
      client.send_handoff({ ...packet, markdown: 'api_key=abcdefghijk123456' }),
    /credentials/,
  );
  assert.equal(calls.length, 0);
  assert.equal((await client.send_handoff(packet)).execution_authorized, false);
  await client.send_handoff(packet);
  assert.deepEqual(calls[0], calls[1]);
  await client.get_handoffs({ cursor: '9007199254740994' });
  await client.get_handoff({ handoff_id: '9007199254740994' });
  assert.throws(
    () => client.acknowledge_handoff({ handoff_id: '9007199254740994' }),
    /explicitly acknowledge/,
  );
  assert.throws(
    () => client.get_handoff({ handoff_id: '../commands' }),
    /Invalid/,
  );
  await client.acknowledge_handoff({
    handoff_id: '9007199254740994',
    owner_acknowledged: true,
  });
  assert.deepEqual(
    calls.map((call) => call.args.slice(0, 2)),
    [
      ['handoff', 'send'],
      ['handoff', 'send'],
      ['handoff', 'inbox'],
      ['handoff', 'get'],
      ['handoff', 'acknowledge'],
    ],
  );
});
