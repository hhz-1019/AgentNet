// Only the loopback Go test fixture exposes these endpoints. This never opens
// a real Agent Home or uses production credentials.
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentNetRuntime } from '../client/runtime.mjs';
import { codexExecutorFromEnvironment } from '../client/codex-executor.mjs';
const endpoint = 'http://127.0.0.1:4320';
async function request(path, body) {
  const res = await fetch(endpoint + '/api/v2/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await res.json();
  if (!res.ok) throw Error(value.error?.code || 'fixture failed');
  return value.data;
}
const context = await request('moment-preview/context');
if (context.fixture !== 'moment-isolated-v1')
  throw Error('Not the isolated Moment fixture');
const home = await mkdtemp(join(tmpdir(), 'moment-preview-worker-'));
const client = {
  get_context: () => request('moment-preview/context'),
  heartbeat: () => request('moment-preview/heartbeat', {}),
  pending_commands: ({ command_type, executor_id }) =>
    request(
      'agent-commands/pending?command_type=' +
        command_type +
        '&executor_id=' +
        executor_id,
    ),
  claim_command: (args) =>
    request('agent-commands/' + args.command_id + '/claim', {
      runtime_instance_id: 'runtime',
      applied_context_revision: 1,
      executor_id: args.executor_id,
    }),
  renew_command: (args) =>
    request('agent-commands/' + args.command_id + '/renew', {
      runtime_instance_id: 'runtime',
      claim_token: args.claim_token,
      claim_epoch: args.claim_epoch,
      executor_id: args.executor_id,
    }),
  complete_command: (args) =>
    request('agent-commands/' + args.command_id + '/complete', {
      runtime_instance_id: 'runtime',
      claim_token: args.claim_token,
      claim_epoch: args.claim_epoch,
      status: args.status,
      result: args.result,
    }),
};
const executor = process.argv.includes('--codex')
  ? await codexExecutorFromEnvironment({
      ...process.env,
      AGENTNET_HOME: home,
      AGENTNET_URL: endpoint,
      AGENTNET_EXECUTOR_ID: 'test_host',
      AGENTNET_CODEX_WORKSPACE: home,
      AGENTNET_CODEX_SANDBOX: 'workspace-write',
    })
  : {
      id: 'test_host',
      execute: async () => {
        const path = join(home, 'moment-approved.md');
        await writeFile(path, '此刻功能已连接决定队列。', 'utf8');
        const content = await readFile(path, 'utf8');
        return {
          status: 'completed',
          summary: '本地验证执行器已保存并读回联调草稿。',
          session_id: 'local-fixture-executor',
          evidence:
            path + '；读回内容：' + content + '；这是确定性联调执行器。',
        };
      },
    };
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
console.log(
  JSON.stringify({
    home,
    executor: process.argv.includes('--codex')
      ? 'Codex'
      : 'deterministic fixture',
  }),
);
await new AgentNetRuntime({
  home,
  endpoint,
  client,
  executor,
  pollMs: 1000,
  log: console.log,
}).run({ signal: abort.signal, once: process.argv.includes('--once') });
