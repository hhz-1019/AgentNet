// Actual patched CLI + SDK + worker + compatible-model HTTP protocol.
// Core authentication/queue and model outputs are explicit local fixtures.
import { mkdtemp, cp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { AgentNet } from '../client/sdk.mjs';
import { AgentNetRuntime } from '../client/runtime.mjs';
import { CompatibleModel } from '../client/model.mjs';
import { documentFromWork } from '../client/work.mjs';
await mkdir('.agentnet-audit', { recursive: true });
const dir = await mkdtemp(resolve('.agentnet-audit/host-protocol-'));
const run = (binary, args, cwd) =>
  new Promise((ok, fail) => {
    const p = spawn(binary, args, { cwd, stdio: 'inherit' });
    p.once('error', fail);
    p.once('exit', (code) =>
      code === 0 ? ok() : fail(new Error('Build/patch failed: ' + code)),
    );
  });
let server;
try {
  await cp('upstream/eigenflux', dir, {
    recursive: true,
    filter: (p) => !p.endsWith('/.git'),
  });
  for (const name of [
    'domestic-providers',
    'uid-deepseek',
    'official-assistant',
    'community-activation',
    'social-workspace',
  ])
    await run(
      'git',
      [
        'apply',
        '--ignore-space-change',
        resolve('eigenflux/patches/' + name + '.patch'),
      ],
      dir,
    );
  await cp('eigenflux/overlay/cli', join(dir, 'cli'), { recursive: true });
  const binary = join(dir, 'agentnet');
  await run(
    process.env.AGENTNET_GO_BINARY || 'go',
    ['build', '-o', binary, '.'],
    join(dir, 'cli'),
  );
  const home = join(dir, 'private-home');
  await mkdir(join(home, '.eigenflux', 'servers', 'agentnet'), {
    recursive: true,
  });
  await writeFile(
    join(
      home,
      '.eigenflux',
      'servers',
      'agentnet',
      'agent-v2-credentials.json',
    ),
    JSON.stringify({
      access_token: 'local-fixture-access',
      refresh_token: 'local-fixture-refresh',
      agent_id: '1',
      principal_id: '1',
      expires_at: Date.now() + 3600000,
    }),
    { mode: 0o600 },
  );
  const record = {
    work_id: 'verified-001',
    status: 'completed',
    shareable: true,
    title: '实际接口权限回归的工作记录',
    source: '宿主明确允许分享的本地验证任务',
    result: '记录私有成果到人工审核草稿的执行流程。',
    evidence: '本地测试步骤与真实协议调用记录。',
    limitations: '认证与模型结果使用本地 fixture，未验证云模型或公网。',
    tags: ['Agent 工程'],
  };
  const records = join(dir, 'records');
  await mkdir(records);
  await writeFile(join(records, 'work.json'), JSON.stringify(record));
  const command = {
    command_id: '9007199254740993',
    command_type: 'human_instruction',
    payload: {
      instruction: '请根据已完成工作生成私有草稿。',
      allow_draft: true,
    },
  };
  let completed = false,
    proof,
    runtimeID,
    proposal,
    models = 0;
  const paths = [];
  server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const path = new URL(req.url, 'http://localhost').pathname;
      paths.push(path);
      let data;
      if (path === '/v1/chat/completions') {
        assert.equal(req.headers.authorization, 'Bearer local-model-fixture');
        models++;
        const input = JSON.parse(body.messages[1].content);
        if (input.instruction)
          assert.equal(input.owner_goal, '整理可复现的真实工作记录');
        const content = input.instruction
          ? {
              reply: '根据提供的真实工作记录提出私有草稿，等待主人确认。',
              work_id: record.work_id,
            }
          : documentFromWork(input);
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(content) },
              },
            ],
          }),
        );
        return;
      }
      assert.equal(req.headers.authorization, 'Bearer local-fixture-access');
      switch (path) {
        case '/api/v2/agent-context':
          data =
            new URL(req.url, 'http://localhost').searchParams.get(
              'if_newer',
            ) === '1'
              ? { context_revision: 1, unchanged: true }
              : {
                  context_revision: 1,
                  unchanged: false,
                  control_context: {
                    network_goal: { text: '整理可复现的真实工作记录' },
                    security_boundary: { recurring_publish: false },
                  },
                };
          break;
        case '/api/v2/runtime/heartbeat':
          assert.equal(body.applied_context_revision, 1);
          runtimeID = body.runtime_instance_id;
          data = { lease_until: Date.now() + 120000 };
          break;
        case '/api/v2/agent-commands/pending':
          data = { commands: completed ? [] : [command] };
          break;
        case '/api/v2/agent-commands/' + command.command_id + '/claim':
          assert.equal(body.runtime_instance_id, runtimeID);
          assert.equal(body.applied_context_revision, 1);
          proof = 'fixture-proof';
          data = {
            ...command,
            claim_epoch: 1,
            claim_token: proof,
            claim_until: Date.now() + 120000,
          };
          break;
        case '/api/v2/social/posts':
          data = { items: [], next_cursor: '' };
          break;
        case '/api/v2/agent-commands/' + command.command_id + '/complete':
          assert.equal(body.claim_token, proof);
          assert.equal(body.claim_epoch, 1);
          assert.equal(body.status, 'completed');
          assert.equal(body.result.work_report.source, record.source);
          completed = true;
          data = { status: 'completed', command_id: command.command_id };
          break;
        case '/api/v2/social/drafts':
          assert.equal(body.visibility, 'private');
          assert.equal(body.document.identity, 'agent');
          assert.equal(body.document.source, record.source);
          assert.ok(body.document.body.includes(record.limitations));
          proposal = body;
          data = {
            id: '9007199254740994',
            state: 'draft',
            document: body.document,
          };
          break;
        default:
          throw new Error('Unexpected route ' + path);
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 0, data }));
    } catch (error) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          error: { code: 'FIXTURE_ASSERTION', message: error.message },
        }),
      );
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const model = new CompatibleModel({
    baseURL: endpoint + '/v1',
    model: 'local-protocol-fixture',
    apiKey: 'local-model-fixture',
  });
  const client = new AgentNet({
    binary,
    home,
    endpoint,
    draftGenerator: model.draftGenerator,
  });
  const worker = new AgentNetRuntime({
    client,
    model,
    home,
    endpoint,
    allowDrafts: true,
    workDirectory: records,
  });
  await worker.run({ once: true });
  await worker.run({ once: true });
  assert.ok(completed && proposal);
  assert.equal(models, 2);
  assert.ok(proposal.idempotency_key.startsWith('work:'));
  const journal = JSON.parse(
    await readFile(join(home, 'agentnet-runtime', 'journal.json'), 'utf8'),
  );
  assert.equal(
    journal.jobs[command.command_id].receipt.social_draft.state,
    'draft',
  );
  assert.ok(paths.includes('/api/v2/runtime/heartbeat'));
  console.log(
    'PASS actual patched CLI → SDK host → local model protocol → fenced completion → private draft; credentials and model are test fixtures.',
  );
} finally {
  if (server) await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
}
