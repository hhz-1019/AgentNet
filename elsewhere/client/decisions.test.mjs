import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentNetRuntime } from './runtime.mjs';
import { AgentNet } from './sdk.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'moment-'));
  const calls = [],
    command = {
      command_id: '9007199254740993',
      command_type: 'attention_response',
      payload: {
        protocol_version: 'agent_attention.v1',
        context_ref: { moment: { executor_id: 'host_A' } },
        attention_snapshot: { body: '原请求' },
        selected_action: { action_key: 'yes' },
        condition: '只写草稿',
        authorization_scope: '仅整理当前材料',
        expires_at: Date.now() + 600000,
      },
    };
  let executions = 0,
    loseReceipt = false;
  const client = {
    get_context: async () => ({ control_context: { revision: 1 } }),
    heartbeat: async () => {
      calls.push('heartbeat');
    },
    pending_commands: async ({ command_type }) => {
      calls.push(command_type);
      return { commands: [command] };
    },
    claim_command: async (args) => {
      calls.push(args);
      return {
        ...command,
        claim_token: 'proof',
        claim_epoch: 1,
        claim_until: Date.now() + 120000,
      };
    },
    renew_command: async () => ({ claim_until: Date.now() + 120000 }),
    complete_command: async (result) => {
      calls.push(result);
      if (loseReceipt) {
        loseReceipt = false;
        throw Error('network');
      }
      return {};
    },
  };
  const executor = {
    id: 'host_A',
    execute: async (input) => {
      executions++;
      assert.equal(input.decision.condition, '只写草稿');
      return {
        status: 'completed',
        summary: '已整理为草稿。',
        evidence: '草稿文件已保存并读回核对。',
        session_id: 'actual-session',
      };
    },
  };
  const runtime = new AgentNetRuntime({
    home,
    endpoint: 'http://127.0.0.1',
    client,
    executor,
  });
  await runtime.open();
  t.after(async () => {
    await runtime.close();
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    runtime,
    client,
    executor,
    command,
    calls,
    count: () => executions,
    lose: () => {
      loseReceipt = true;
    },
  };
}
void test('decision precedes feed work and durable receipt retries do not execute twice', async (t) => {
  const f = await fixture(t);
  f.lose();
  await assert.rejects(f.runtime.tick(), /network/);
  await f.runtime.tick();
  assert.equal(f.count(), 1);
  assert.equal(f.calls.includes('human_instruction'), false);
  const journal = JSON.parse(await readFile(f.runtime.file, 'utf8')),
    job = journal.jobs[f.command.command_id];
  assert.equal(job.phase, 'done');
  assert.equal(job.completion.command_type, 'attention_response');
  assert.equal(job.completion.result.execution.session_id, 'actual-session');
  assert.equal(job.completion.result.execution.input_hash.length, 64);
});
void test('executor binding and expiry cannot be bypassed by queue contents', async (t) => {
  const f = await fixture(t);
  f.command.payload.context_ref.moment.executor_id = 'other';
  await f.runtime.tick();
  assert.equal(f.count(), 0);
  f.command.payload.context_ref.moment.executor_id = 'host_A';
  f.command.payload.expires_at = Date.now() - 1;
  await f.runtime.tick();
  assert.equal(f.count(), 0);
  assert.equal(
    f.runtime.journal.jobs[f.command.command_id].completion.status,
    'failed',
  );
});
void test('receipt failure is not reported as execution success and lease failure prevents launch', async (t) => {
  const f = await fixture(t);
  f.client.renew_command = async () => {
    throw Error('CLAIM_FENCED');
  };
  await f.runtime.tick();
  assert.equal(f.count(), 0);
  assert.equal(
    f.runtime.journal.jobs[f.command.command_id].completion.status,
    'failed',
  );
});
void test('interrupted decision uses typed failure receipt after restart', async (t) => {
  const f = await fixture(t);
  await f.runtime.close();
  await writeFile(
    f.runtime.file,
    JSON.stringify({
      endpoint: f.runtime.endpoint,
      jobs: {
        [f.command.command_id]: {
          phase: 'executing',
          completion: {
            command_type: 'attention_response',
            command_id: f.command.command_id,
            status: 'failed',
          },
        },
      },
    }),
  );
  await f.runtime.open();
  await f.runtime.tick();
  assert.equal(f.count(), 0);
  assert.match(
    f.runtime.journal.jobs[f.command.command_id].completion.result.summary,
    /未自动重复|没有自动重复/,
  );
});
void test('producer retry survives restart with identical timestamp, context and payload', async () => {
  const home = await mkdtemp(join(tmpdir(), 'decision-producer-'));
  try {
    const config = {
      home,
      binary: process.execPath,
      endpoint: 'http://127.0.0.1',
    };
    const agent = new AgentNet(config),
      received = [];
    agent.get_context = async () => ({ context_revision: 7 });
    agent.command = async (_args, { input }) => {
      received.push(input);
      throw Error('network lost');
    };
    const decision = {
      title: '研究草稿',
      body: '原请求',
      recommendation: '建议先整理',
      choices: ['整理草稿'],
      scopes: ['只保存草稿'],
      executor_id: 'host_A',
      idempotency_key: 'producer-test-01',
    };
    await assert.rejects(agent.request_decision(decision), /network lost/);
    const restarted = new AgentNet(config);
    restarted.get_context = async () => {
      throw Error('must reuse frozen context');
    };
    restarted.command = async (_args, { input }) => {
      received.push(input);
      return { replay: true };
    };
    await restarted.request_decision(decision);
    assert.deepEqual(received[0], received[1]);
    await assert.rejects(
      restarted.request_decision({ ...decision, body: 'changed' }),
      /different content/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
