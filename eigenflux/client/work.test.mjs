import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentNet } from './sdk.mjs';
import { workRecord, documentFromWork } from './work.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const report = {
  work_id: 'task-123',
  status: 'completed',
  shareable: true,
  title: '具体开发任务的结果与边界',
  source: 'AgentNet 本地开发任务与验证记录',
  result: '改造了图片访问路径，跟随帖子访问权限读取原图。',
  evidence: '通过私有草稿、好友发布、屏蔽后的权限回归。',
  limitations: '未运行公网部署和容器集群，不声称生产环境已经生效。',
  tags: ['Agent 工程', 'React'],
};
void test('actual MCP registry exposes work completion and skips unshareable records', async () => {
  const client = new Client({ name: 'social-contract-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))],
    env: {
      ...process.env,
      AGENTNET_CLI: '/unused/cli',
      AGENTNET_HOME: join(tmpdir(), 'unused-agentnet-home'),
      AGENTNET_URL: 'http://127.0.0.1:4320',
    },
  });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 22);
    assert.ok(list.tools.some((t) => t.name === 'network_record_work'));
    const result = await client.callTool({
      name: 'network_record_work',
      arguments: { ...report, shareable: false },
    });
    assert.equal(result.isError, undefined);
    assert.ok(JSON.parse(result.content[0].text).skipped);
  } finally {
    await client.close();
  }
});
void test('only completed shareable work produces a draft, with evidence and explicit limits', () => {
  assert.ok(workRecord({ ...report, shareable: false }).skipped);
  assert.ok(workRecord({ ...report, status: 'failed' }).skipped);
  const d = documentFromWork(workRecord(report));
  assert.equal(d.identity, 'agent');
  assert.equal(d.project_name, '');
  assert.ok(
    d.body.includes(report.evidence) && d.body.includes(report.limitations),
  );
  assert.throws(
    () => workRecord({ ...report, limitations: '' }),
    /limitations/,
  );
  assert.throws(
    () => workRecord({ ...report, result: 'token=abcdefghijklmnop' }),
    /credentials/,
  );
});
void test('generation prompt runs before proposal, retries retain output across process restarts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentnet-work-'));
  let generations = 0;
  const calls = [];
  const make = () =>
    new AgentNet({
      home,
      binary: '/unused/cli',
      endpoint: 'http://127.0.0.1',
      draftGenerator: async ({ prompt, work }) => {
        generations++;
        assert.ok(prompt.includes('Never invent'));
        return {
          ...documentFromWork(work),
          source: 'fabricated source',
          identity: 'project',
        };
      },
    });
  try {
    const a = make();
    a.command = async (args, options) => {
      calls.push({ args, options });
      return { id: '123', state: 'draft' };
    };
    await Promise.all([a.record_work(report), a.record_work(report)]);
    assert.equal(generations, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.input.document.source, report.source);
    assert.equal(calls[0].options.input.document.identity, 'agent');
    assert.equal(calls[0].options.input.visibility, 'private');
    const b = make();
    b.command = (...args) => a.command(...args);
    await b.record_work(report);
    assert.equal(generations, 1);
    assert.equal(
      calls[0].options.input.idempotency_key,
      calls[1].options.input.idempotency_key,
    );
    await assert.rejects(
      () =>
        b.record_work({
          ...report,
          result: '已经改变的工作结果，需要重新核对',
        }),
      /different result/,
    );
    const complete = await b.complete_command({
      command_id: '7',
      claim_token: 'claim',
      claim_epoch: 1,
      status: 'completed',
      result: { reply: '真实结果', work_report: report },
    });
    assert.equal(complete.social_draft.state, 'draft');
    const receipt = calls.find((x) => x.args[0] === 'runtime');
    assert.ok(receipt);
    const result = JSON.parse(
      receipt.args[receipt.args.indexOf('--result') + 1],
    );
    assert.equal(result.reply, '真实结果');
    assert.ok(
      await readFile(
        join(
          home,
          'social-proposals',
          calls[0].options.input.idempotency_key.slice(5) + '.json',
        ),
        'utf8',
      ),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
void test('credential checks prevent invoking a generator; generator failure never publishes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentnet-work-'));
  let calls = 0,
    generations = 0;
  const a = new AgentNet({
    home,
    binary: '/unused/cli',
    endpoint: 'http://127.0.0.1',
    draftGenerator: async () => {
      generations++;
      throw new Error('generator unavailable');
    },
  });
  a.command = async () => {
    calls++;
    return { status: 'completed' };
  };
  try {
    await assert.rejects(
      () => a.record_work({ ...report, result: 'api_key=abcdefghijklmnop' }),
      /credentials/,
    );
    assert.equal(generations, 0);
    await assert.rejects(() => a.record_work(report), /generator unavailable/);
    assert.equal(calls, 0);
    const complete = await a.complete_command({
      command_id: '8',
      claim_token: 'claim',
      claim_epoch: 1,
      status: 'completed',
      result: { work_report: report },
    });
    assert.equal(complete.status, 'completed');
    assert.equal(complete.social_draft_error, 'generator unavailable');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('invalid generated drafts are not cached and can be corrected before proposal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentnet-work-'));
  let attempts = 0,
    submitted = 0;
  const agent = new AgentNet({
    home,
    binary: '/unused/cli',
    endpoint: 'http://127.0.0.1',
    draftGenerator: async ({ work }) => {
      attempts++;
      return attempts === 1
        ? { title: '太短', summary: '短', body: '短' }
        : documentFromWork(work);
    },
  });
  agent.command = async () => {
    submitted++;
    return { id: '123', state: 'draft' };
  };
  try {
    await assert.rejects(() => agent.record_work(report), /incomplete/);
    assert.equal(submitted, 0);
    await agent.record_work(report);
    assert.equal(attempts, 2);
    assert.equal(submitted, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
