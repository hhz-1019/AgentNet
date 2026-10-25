import test from 'node:test';
import assert from 'node:assert/strict';
import { chatDecisions } from './chat-decisions.mjs';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const executor_id = 'chat_00000000-0000-4000-8000-000000000001';
const binding = { command_id: '123', executor_id };

void test('panel remains available without host messaging and advertises chat only with permission', async () => {
  const source = (
    await readFile(new URL('./moment-panel.mjs', import.meta.url), 'utf8')
  ).replace("import { App } from '@modelcontextprotocol/ext-apps';", '');
  for (const mode of [
    'supported',
    'no-permission',
    'connection-failed',
    'connection-timeout',
  ]) {
    const frame = { hidden: true, contentWindow: { postMessage() {} } };
    const status = { hidden: false };
    const listeners = [];
    await runInNewContext(`(async () => { ${source} })()`, {
      App: class {
        async connect() {
          if (mode === 'connection-failed') throw new Error('unavailable');
          if (mode === 'connection-timeout') await new Promise(() => {});
        }
        getHostCapabilities() {
          return mode === 'supported' ? { message: { text: {} } } : {};
        }
      },
      document: {
        querySelector: (selector) =>
          ({
            '#moment-config': {
              textContent: JSON.stringify({
                url: 'https://example.com/dashboard/crossing',
              }),
            },
            '#status': status,
            iframe: frame,
          })[selector],
      },
      window: { addEventListener: (...args) => listeners.push(args) },
      crypto,
      URL,
      setTimeout: (callback, delay) => {
        assert.equal(delay, 5000);
        return setTimeout(
          () => callback(),
          mode === 'connection-timeout' ? 0 : delay,
        );
      },
      clearTimeout,
    });
    assert.equal(frame.hidden, false, mode);
    assert.equal(frame.src, 'https://example.com/dashboard/crossing', mode);
    assert.equal(status.hidden, true, mode);
    assert.equal(listeners.length, mode === 'supported' ? 1 : 0, mode);
  }
});

void test('official MCP Apps transport delivers a user message and exposes host rejection', async () => {
  const app = new App(
    { name: 'moment-test', version: '1' },
    {},
    { autoResize: false },
  );
  const host = new AppBridge(
    null,
    { name: 'test-host', version: '1' },
    { message: { text: {} } },
  );
  const [left, right] = InMemoryTransport.createLinkedPair();
  const received = [];
  host.onmessage = async (message) => {
    received.push(message);
    return {};
  };
  try {
    await host.connect(right);
    await app.connect(left);
    const f = fixture(),
      decisions = chatDecisions(f.client);
    const { text } = await decisions.message(binding);
    const accepted = await app.sendMessage({
      role: 'user',
      content: [{ type: 'text', text }],
    });
    assert.notEqual(accepted.isError, true);
    assert.equal(received[0].role, 'user');
    assert.equal(received[0].content[0].text, text);
    assert.equal(f.counters().claims, 0);
    host.onmessage = async () => ({ isError: true });
    assert.equal(
      (
        await app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
        })
      ).isError,
      true,
    );
    decisions.close();
  } finally {
    await app.close();
    await host.close();
  }
});
function fixture() {
  const payload = {
    delivery: 'current_chat',
    expires_at: Date.now() + 60000,
    context_ref: { moment: { executor_id } },
    authorization_scope: '仅添加 Agent 2 为好友',
    selected_action: { display_text: '同意添加' },
    condition: '不发送私信',
  };
  let claims = 0,
    completes = 0;
  const client = {
    pending_commands: async () => ({
      commands: [{ command_id: '123', payload }],
    }),
    get_context: async () => ({ control_context: { revision: 1 } }),
    heartbeat: async () => ({}),
    claim_command: async () => {
      claims++;
      return {
        command_id: '123',
        payload,
        claim_token: 'secret',
        claim_epoch: 1,
      };
    },
    renew_command: async () => ({ claim_until: Date.now() + 60000 }),
    complete_command: async (input) => {
      completes++;
      return input;
    },
  };
  return { payload, client, counters: () => ({ claims, completes }) };
}
void test('chat message preserves the grant and never claims or executes it', async () => {
  const f = fixture(),
    d = chatDecisions(f.client);
  const { text } = await d.message(binding);
  assert.match(text, /仅添加 Agent 2 为好友/);
  assert.match(text, /不发送私信/);
  assert.match(text, /network_begin_chat_decision/);
  assert.deepEqual(f.counters(), { claims: 0, completes: 0 });
  assert.doesNotMatch(text, /secret/);
  d.close();
});
void test('wrong panel, background commands, expiration and missing approval are rejected', async () => {
  const f = fixture(),
    d = chatDecisions(f.client);
  await assert.rejects(
    d.message({ ...binding, executor_id: executor_id.replace(/1$/, '2') }),
  );
  f.payload.delivery = 'background';
  await assert.rejects(d.message(binding));
  f.payload.delivery = 'current_chat';
  f.payload.expires_at = 1;
  await assert.rejects(d.message(binding));
  f.payload.expires_at = Date.now() + 60000;
  f.payload.authorization_scope = '';
  await assert.rejects(d.message(binding));
  assert.equal(f.counters().claims, 0);
  d.close();
});
void test('only one chat claim and a real receipt can finish; retry cannot change receipt', async () => {
  const f = fixture(),
    d = chatDecisions(f.client);
  try {
    const results = await Promise.allSettled([
      d.begin(binding),
      d.begin(binding),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(f.counters().claims, 1);
    assert.equal(d.check(binding).decision.condition, '不发送私信');
    await assert.rejects(
      d.finish({
        ...binding,
        status: 'completed',
        summary: 'done',
        evidence: '',
      }),
    );
    const input = {
      ...binding,
      status: 'completed',
      summary: '已添加好友',
      evidence: 'friendship 12',
      session_id: '00000000-0000-4000-8000-000000000002',
    };
    const result = await d.finish(input);
    assert.equal(result.result.execution.session_id, input.session_id);
    assert.equal(result.command_type, 'attention_response');
    assert.throws(() => d.check(binding));
    await d.finish(input);
    await assert.rejects(d.finish({ ...input, summary: 'different' }));
  } finally {
    d.close();
  }
});
void test('a lost claim cannot be retried or reported as success', async () => {
  const f = fixture();
  f.client.renew_command = async () => {
    throw new Error('lease lost');
  };
  const d = chatDecisions(f.client);
  await assert.rejects(d.begin(binding));
  await assert.rejects(d.begin(binding));
  assert.throws(() => d.check(binding));
  await assert.rejects(
    d.finish({ ...binding, status: 'completed', summary: 'x', evidence: 'x' }),
  );
  assert.deepEqual(f.counters(), { claims: 1, completes: 0 });
  d.close();
});
