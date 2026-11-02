// Deterministic native-host protocol acceptance. NO model calls or real owner accounts.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCollaborationLiveFixture } from './collaboration-live-fixture.mjs';
import { installFixturePlugin } from './collaboration-installed-plugin.mjs';
import { codexProtocol } from './codex-plugin-protocol.mjs';
const directory = await mkdtemp(resolve('.agentnet-audit/native-plugin-pair-'));
const workspace = join(directory, 'workspace');
await mkdir(workspace);
const fixture = await startCollaborationLiveFixture({
  directory,
  goBinary: resolve(process.env.AGENTNET_GO_BINARY),
  cliBinary: resolve(process.env.AGENTNET_LIVE_CLI),
});
const hosts = {};
const evidence = {
  passed: false,
  kind: 'deterministic-native-plugin-protocol-not-model-acceptance',
  modelCalls: 0,
  installations: [],
  calls: [],
};
let project;
try {
  for (const identity of ['1', '2']) {
    const installed = await installFixturePlugin({
      fixture,
      workspace,
      identity,
    });
    const rpc = await codexProtocol({
      binary: process.env.AGENTNET_NATIVE_APP_SERVER,
      cwd: installed.cwd,
      env: { ...process.env, CODEX_HOME: installed.codexHome },
    });
    hosts[identity] = { rpc };
    const { thread } = await rpc.request('thread/start', {
      cwd: installed.cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    hosts[identity].thread = thread.id;
    evidence.installations.push(installed.receipt);
  }
  async function call(identity, group, args, allowError = false) {
    const tool =
      group === 'connection'
        ? 'elsewhere_connection'
        : 'network_collaboration_' + group;
    const host = hosts[identity];
    const response = await host.rpc.request('mcpServer/tool/call', {
      threadId: host.thread,
      server: 'elsewhere',
      tool,
      arguments: args,
    });
    evidence.calls.push({
      identity,
      tool,
      action: args.action,
      rejected: Boolean(response.isError),
    });
    if (allowError) {
      assert.equal(response.isError, true);
      return;
    }
    assert.notEqual(response.isError, true, JSON.stringify(response.content));
    return JSON.parse(response.content[0].text);
  }
  async function mutate(identity, group, args) {
    if (project) {
      const current = await call(identity, 'context', {
        project_id: project.project_id,
      });
      project = current.project;
    }
    const result = await call(identity, group, {
      ...args,
      ...(project ? { project_id: project.project_id } : {}),
      expected_version: project?.version || 0,
      idempotency_key: randomUUID(),
    });
    project = result.project;
    return result;
  }
  for (const id of ['1', '2'])
    assert.equal(
      (await call(id, 'connection', { action: 'status' })).state,
      'connected',
    );
  const peer = await call('1', 'project', {
    action: 'resolve',
    short_id: '@PeerB',
  });
  assert.equal(peer.agent_id, '2');
  await mutate('1', 'project', {
    action: 'create',
    goal: '原生插件双身份协议验收：合成订单计算与交叉审核',
    requirements:
      'Only synthetic data; deterministic harness, not autonomous model work.',
  });
  await mutate('1', 'project', {
    action: 'invite',
    agent_id: peer.agent_id,
    text: '核算合成订单并交叉审核结果',
    role: 'worker',
    scopes: ['read', 'work', 'review'],
  });
  await call('2', 'context', { project_id: project.project_id }, true);
  const inbox = await call('2', 'project', { action: 'list' });
  assert.equal(inbox.projects.length, 1);
  await call('2', 'membership', {
    action: 'accept',
    project_id: project.project_id,
    expected_version: project.version,
    idempotency_key: randomUUID(),
  });
  await mutate('1', 'tasks', {
    action: 'create',
    task_id: 'calculate',
    title: '核算订单',
    assignee: '2',
    reviewer: '1',
    input: '3×1200 + 4×250 + 2×1800 cents; 10% discount',
    output: 'JSON integer cents',
  });
  await mutate('1', 'tasks', {
    action: 'create',
    task_id: 'summary',
    title: '生成摘要',
    assignee: '1',
    reviewer: '2',
    dependencies: ['calculate'],
    output: '中文摘要并引用已审核的计算成果版本',
  });
  const total = ((3 * 1200 + 4 * 250 + 2 * 1800) * 9) / 10;
  const results = {};
  for (const [id, task, reviewer] of [
    ['2', 'calculate', '1'],
    ['1', 'summary', '2'],
  ]) {
    await mutate(id, 'tasks', { action: 'accept', task_id: task });
    await mutate(id, 'tasks', {
      action: 'start',
      task_id: task,
      host: 'codex-native-plugin-protocol-test',
    });
    const text =
      task === 'calculate'
        ? JSON.stringify({
            subtotal_cents: 8200,
            discount_cents: 820,
            total_cents: total,
          })
        : JSON.stringify({
            summary_zh: '订单原价82元，优惠8.20元，实付73.80元。',
            source_artifact_version: results.calculate.version,
          });
    await mutate(id, 'submit', {
      task_id: task,
      epoch: project.tasks[task].epoch,
      artifact: {
        kind: 'text',
        text,
        provenance:
          'Synthetic deterministic protocol fixture; no model generated content',
        verification: 'Integer-cent arithmetic asserted by test',
      },
    });
    const snapshot = await call(reviewer, 'context', {
      project_id: project.project_id,
    });
    const artifact = snapshot.artifacts.find(
      (a) =>
        a.task_id === task &&
        a.version === project.tasks[task].artifact_version,
    );
    assert.equal(artifact.text, text);
    results[task] = artifact;
    await mutate(reviewer, 'review', {
      action: 'accept',
      task_id: task,
      artifact_version: artifact.version,
      text: '已检查本协议测试成果的精确版本与合成算式。',
    });
  }
  await mutate('1', 'project', { action: 'complete' });
  assert.equal(project.state, 'completed');
  assert.ok(
    Object.values(project.tasks).every((t) => t.state === 'accepted_result'),
  );
  evidence.project = project;
  evidence.artifacts = Object.values(results);
  evidence.passed = true;
} catch (error) {
  evidence.failure = error.message;
  throw error;
} finally {
  const stopped = await Promise.allSettled(
    Object.values(hosts).map((h) => h.rpc.close()),
  );
  await fixture.close();
  evidence.cleanupVerified = stopped.every((r) => r.status === 'fulfilled');
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
}
console.log(
  JSON.stringify({
    passed: true,
    directory,
    project: project.project_id,
    installations: 2,
    artifacts: 2,
    reviews: 2,
    modelCalls: 0,
  }),
);
