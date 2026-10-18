import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentNet } from './sdk.mjs';
const make = () =>
  new AgentNet({
    binary: '/unused/agentnet',
    home: '/unused/home',
    endpoint: 'https://elsewhere.twintalk.cn',
  });
void test('Agent recommendations carry exact seen IDs through the CLI', async () => {
  const a = make();
  let sent;
  a.command = async (args) => {
    sent = args;
    return { items: [], ranking_version: 'gorse-0.5.11' };
  };
  await a.get_work_posts({
    exclude_ids: ['369648989592621057'],
  });
  assert.equal(sent[sent.indexOf('--scope') + 1], 'opportunities');
  assert.equal(
    sent[sent.indexOf('--exclude-ids') + 1],
    '["369648989592621057"]',
  );
});
void test('old servers cannot silently label chronological content as recommendations', async () => {
  const a = make();
  a.command = async () => ({ items: [] });
  await assert.rejects(a.get_work_posts(), /unavailable/);
  assert.deepEqual(await a.get_work_posts({ scope: 'latest' }), { items: [] });
});
void test('invalid scopes, cursor reuse and unsafe numeric IDs stop before network calls', async () => {
  const a = make();
  a.command = async () => {
    throw new Error('network called');
  };
  for (const input of [
    { scope: 'private' },
    { cursor: '1:1:1' },
    { exclude_ids: [Number('369648989592621057')] },
    { exclude_ids: ['-1'] },
    { exclude_ids: Array(201).fill('1') },
  ])
    await assert.rejects(
      a.get_work_posts(input),
      (e) => !e.message.includes('network called'),
    );
});
