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
  await run(
    process.env.AGENTNET_GO_BINARY || 'go',
    ['test', './cmd', '-run', 'TestHandoff', '-count=1'],
    join(dir, 'cli'),
  );
  const binary = join(
    dir,
    process.platform === 'win32' ? 'agentnet.exe' : 'agentnet',
  );
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
  let command = {
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
    models = 0,
    shared;
  const paths = [];
  let handoff,
    acknowledged = false;
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
        case '/api/v2/handoffs':
          if (req.method === 'POST') {
            assert.equal(body.owner_authorized, true);
            handoff = { ...body, id: '9007199254740998' };
            data = {
              id: handoff.id,
              delivered: true,
              execution_authorized: false,
            };
          } else
            data = {
              items: handoff && !acknowledged ? [handoff] : [],
              next_cursor: '',
            };
          break;
        case '/api/v2/handoffs/9007199254740998':
          data = handoff;
          break;
        case '/api/v2/handoffs/9007199254740998/acknowledge':
          assert.equal(body.owner_acknowledged, true);
          acknowledged = true;
          data = { id: handoff.id, state: 'acknowledged' };
          break;
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
          assert.equal(
            new URL(req.url, 'http://localhost').searchParams.get(
              'command_type',
            ),
            'human_instruction',
          );
          assert.equal(
            new URL(req.url, 'http://localhost').searchParams.get('limit'),
            '50',
          );
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
          if (command.payload.publish) {
            assert.equal(body.result.execution, 'shared');
            assert.equal(body.result.post_id, '9007199254740995');
          } else assert.equal(body.result.work_report.source, record.source);
          completed = true;
          data = { status: 'completed', command_id: command.command_id };
          break;
        case '/api/v2/social/share':
          assert.equal(body.owner_authorized, true);
          assert.equal(body.visibility, 'friends');
          assert.equal(body.command_id, command.command_id);
          assert.equal(body.claim_token, proof);
          assert.equal(body.claim_epoch, 1);
          assert.equal(body.document.source, record.source);
          shared = body;
          data = {
            id: '9007199254740995',
            state: 'published',
            document: body.document,
          };
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
  command = {
    command_id: '9007199254740996',
    command_type: 'human_instruction',
    payload: {
      instruction: '把这份工作直接分享给已有伙伴',
      publish: true,
      visibility: 'friends',
    },
  };
  completed = false;
  await worker.run({ once: true });
  await worker.run({ once: true });
  assert.ok(completed && shared);
  assert.equal(models, 4);
  assert.equal(shared.idempotency_key, 'share-command:' + command.command_id);
  assert.ok(paths.includes('/api/v2/social/share'));
  const priorPaths = paths.length;
  const packet = {
    receiver_id: '2',
    title: '收到后先提醒主人',
    summary: '请人工决定',
    markdown: 'EXTERNAL_TEXT_MUST_NOT_ENTER_HOOK_CONTEXT',
    sources: [],
    idempotency_key: 'fixture-handoff',
    owner_authorized: true,
  };
  const sent = await client.send_handoff(packet);
  assert.equal(sent.execution_authorized, false);
  assert.equal((await client.get_handoffs()).items.length, 1);
  assert.equal(
    (await client.get_handoff({ handoff_id: sent.id })).markdown,
    packet.markdown,
  );
  const notify = (session) =>
    client.command(['handoff', 'notify'], {
      input: { session_id: session, hook_event_name: 'SessionStart' },
    });
  const notice = await notify('one');
  assert.equal(notice.continue, true);
  assert.equal(notice.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(!JSON.stringify(notice).includes(packet.markdown));
  assert.equal((await notify('one')).message, '');
  assert.equal((await notify('two')).continue, true);
  assert.equal((await client.get_handoffs()).items.length, 1);
  const codexHome = join(dir, 'isolated-codex-home');
  await mkdir(codexHome);
  const existingHooks = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'echo preserve-me' }] }],
    },
  };
  await writeFile(join(codexHome, 'hooks.json'), JSON.stringify(existingHooks));
  for (let i = 0; i < 2; i++) {
    const setup = await client.command([
      'handoff',
      'setup-codex',
      '--enable',
      '--codex-home',
      codexHome,
    ]);
    assert.equal(setup.active, false);
    assert.equal(setup.requires_hook_trust, true);
  }
  const hooks = JSON.parse(
    await readFile(join(codexHome, 'hooks.json'), 'utf8'),
  ).hooks;
  assert.deepEqual(hooks.Stop, existingHooks.hooks.Stop);
  assert.equal(hooks.SessionStart.length, 1);
  assert.equal(hooks.UserPromptSubmit.length, 1);
  // Run the exact generated shell command, including paths with spaces/unicode.
  const hookResult = await new Promise((ok, fail) => {
    const windows = process.platform === 'win32';
    const hook = hooks.SessionStart[0].hooks[0];
    const child = spawn(
      windows ? 'powershell.exe' : '/bin/sh',
      windows
        ? ['-NoProfile', '-Command', hook.commandWindows]
        : ['-c', hook.command],
      { windowsHide: true },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (x) => {
      stdout += x;
    });
    child.stderr.on('data', (x) => {
      stderr += x;
    });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? ok(JSON.parse(stdout)) : fail(new Error(stderr)),
    );
    child.stdin.end(
      JSON.stringify({
        session_id: 'shell-run',
        hook_event_name: 'SessionStart',
      }),
    );
  });
  assert.equal(hookResult.continue, true);
  await client.acknowledge_handoff({
    handoff_id: sent.id,
    owner_acknowledged: true,
  });
  assert.equal((await notify('after-ack')).message, '');
  assert.equal(models, 4);
  assert.ok(
    paths.slice(priorPaths).every((p) => p.startsWith('/api/v2/handoffs')),
  );
  console.log(
    'PASS actual patched CLI → SDK host → local model protocol → fenced completion → private draft/share; handoff delivery/read/ack, isolated Codex hook setup and real shell reminder without execution. Credentials/model/server are test fixtures.',
  );
} finally {
  if (server) await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
}
