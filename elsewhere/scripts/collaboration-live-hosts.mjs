// Explicit opt-in: invokes installed, owner-configured native hosts and models.
// No API-key fallback, mocked model output, production identity or deployment.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startCollaborationLiveFixture } from './collaboration-live-fixture.mjs';
import { nativeInvite } from './collaboration-native-invite.mjs';
import {
  authorizePolicy,
  readStatus,
  controlBackground,
  policyDirectory,
} from '../client/collaboration-background.mjs';

if (!process.argv.includes('--run-live')) {
  throw new Error(
    'Real-host model usage requires explicit --run-live and explicit installed host paths. See docs/COLLABORATION_VERIFICATION.md.',
  );
}
const sameHostDiagnostic = process.argv.includes('--same-host-diagnostic');
const workerHost = sameHostDiagnostic
  ? 'codex'
  : process.env.AGENTNET_LIVE_WORKER_HOST || 'claude_code';
assert.ok(
  ['codex', 'claude_code', 'opencode'].includes(workerHost),
  'Unsupported pilot worker host',
);
if (workerHost === 'codex')
  assert.ok(
    sameHostDiagnostic,
    'Same-host runs require the explicit diagnostic label',
  );
for (const key of [
  'AGENTNET_GO_BINARY',
  'AGENTNET_LIVE_CLI',
  'AGENTNET_LIVE_CODEX',
  ...(workerHost === 'claude_code'
    ? ['AGENTNET_LIVE_CLAUDE']
    : workerHost === 'opencode'
      ? ['AGENTNET_LIVE_OPENCODE', 'AGENTNET_LIVE_OPENCODE_HOME']
      : []),
]) {
  if (!process.env[key])
    throw new Error('Missing explicit installed executable: ' + key);
  await stat(resolve(process.env[key]));
}
await mkdir('.agentnet-audit', { recursive: true });
const directory = await mkdtemp(resolve('.agentnet-audit/collaboration-live-'));
const workspace = join(directory, 'workspace');
await mkdir(workspace);
const fixture = await startCollaborationLiveFixture({
  directory,
  goBinary: resolve(process.env.AGENTNET_GO_BINARY),
  cliBinary: resolve(process.env.AGENTNET_LIVE_CLI),
});
const policies = {};
const started = new Set();
const cleanupFailures = [];
let runFailure;
const evidence = {
  passed: false,
  variant: sameHostDiagnostic
    ? 'same-host-diagnostic-not-heterogeneous-acceptance'
    : 'codex-and-' + workerHost,
  startedAt: new Date().toISOString(),
  boundary:
    'Real installed host/model/CLI/MCP and collaboration handlers; local PGlite SQL and synthetic network identities with separate fixture owners. Not two independently authenticated human owners or a production deployment.',
  phases: [],
};
let project;
const context = () =>
  fixture.clients['1'].collaboration_context({
    project_id: project.project_id,
  });
async function mutate(actor, group, request) {
  const result = await fixture.clients[actor]['collaboration_' + group]({
    ...request,
    project_id: project.project_id,
    expected_version: project.version,
    idempotency_key: randomUUID(),
  });
  project = result.project;
}
async function startThroughMcp(identity) {
  const client = new Client({
    name: 'elsewhere-live-host-acceptance',
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('elsewhere/client/collaboration-mcp.mjs')],
    stderr: 'pipe',
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([, value]) => typeof value === 'string',
        ),
      ),
      AGENTNET_CLI: resolve(process.env.AGENTNET_LIVE_CLI),
      AGENTNET_HOME: fixture.homes[identity],
      AGENTNET_URL: fixture.endpoint,
    },
  });
  transport.stderr?.on('data', () => {});
  try {
    await client.connect(transport);
    started.add(identity);
    const result = await client.callTool({
      name: 'network_collaboration_background',
      arguments: { action: 'start', project_id: project.project_id },
    });
    assert.notEqual(result.isError, true, 'MCP rejected background start');
  } finally {
    await client.close();
  }
  // The launching MCP process is now closed. Only the detached companion may work.
}
async function waitPhase(identity, label, predicate) {
  const until = Date.now() + policies[identity].maxSeconds * 1000 + 30000;
  let previous;
  while (Date.now() < until) {
    const aborted = await stat(join(directory, 'abort-request')).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (aborted) throw new Error('Local operator ended the incomplete pilot');
    const state = await readStatus(policies[identity]);
    const snapshot = await context();
    const progress = JSON.stringify({
      phase: label,
      status: state.status,
      turns: state.turns,
      tasks: Object.fromEntries(
        Object.entries(snapshot.project.tasks).map(([id, task]) => [
          id,
          task.state,
        ]),
      ),
    });
    if (progress !== previous) {
      console.log(progress);
      previous = progress;
    }
    if (
      ['quarantined', 'authorization_failed', 'budget_exhausted'].includes(
        state.status,
      )
    ) {
      throw new Error(
        `${label} stopped: ${state.status}, stage=${state.errorStage || 'unknown'}; inspect local sanitized receipts in ${directory}`,
      );
    }
    if (
      predicate(snapshot) &&
      ['idle', 'completed'].includes(state.status) &&
      !state.pending
    ) {
      assert.ok(state.sessionId, 'Native session receipt missing');
      if (state.status === 'idle') process.kill(state.pid, 0); // Liveness check only; never signal a stored PID.
      const record = {
        label,
        identity,
        sessionId: state.sessionId,
        turns: state.turns,
        workerInstance: state.workerInstance,
        costBudgetSupported: state.costBudgetSupported,
        completion: state.lastCompletion,
        mcpParentClosed: true,
        projectVersion: snapshot.project.version,
      };
      evidence.phases.push(record);
      return { state, snapshot };
    }
    await delay(700);
  }
  throw new Error('Real-host acceptance phase timed out: ' + label);
}
async function stopIdle(identity) {
  await controlBackground(policies[identity], 'stop');
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const state = await readStatus(policies[identity]);
    const unlocked = await stat(
      join(policyDirectory(policies[identity]), 'lock.json'),
    ).then(
      () => false,
      (error) => {
        if (error.code !== 'ENOENT') throw error;
        return true;
      },
    );
    if (unlocked && state.stopAcknowledged && state.status === 'stopped')
      return;
    await delay(200);
  }
  throw new Error('Idle worker did not acknowledge stop');
}
try {
  if (process.argv.includes('--native-invitations')) {
    const initiated = await nativeInvite({ fixture, workspace });
    project = initiated.project;
    evidence.nativeInvitations = initiated.receipts;
    evidence.discovery = { short_id: 'PeerB', agent_id: '2', native: true };
    evidence.invitation = {
      native: true,
      acceptance:
        'explicit synthetic owner prompt; actual native MCP membership.accept',
    };
  } else {
    const peer = await fixture.clients['1'].collaboration_project({
      action: 'resolve',
      short_id: '@PeerB',
    });
    assert.equal(peer.agent_id, '2');
    evidence.discovery = { short_id: peer.short_id, agent_id: peer.agent_id };
    ({ project } = await fixture.clients['1'].collaboration_project({
      action: 'create',
      expected_version: 0,
      idempotency_key: randomUUID(),
      goal: sameHostDiagnostic
        ? '同宿主诊断：两个 Codex 插件实例计算与交叉审查合成订单，不作为跨宿主验收。'
        : `双人订单计算器：${workerHost} 核验计算，Codex 实现可离线使用的 HTML 计算器，双方交叉审查后完成项目。`,
      requirements:
        'Only synthetic input. Produce actual JSON artifacts and exact-version reviews through MCP; prose alone is not completion. All amounts are integer cents; discount is 10 percent of subtotal.',
    }));
    await mutate('1', 'project', {
      action: 'invite',
      agent_id: peer.agent_id,
      text: '一起计算订单并交叉审核中文报告；只使用合成数据。',
      role: 'worker',
      scopes: ['read', 'work', 'review'],
      expires_at: Date.now() + 1200000,
    });
    const inbox = await fixture.clients['2'].collaboration_project({
      action: 'list',
    });
    const offer = inbox.projects.find(
      (p) => p.project_id === project.project_id,
    );
    assert.ok(offer.offer.invitation.includes('订单'));
    assert.equal(offer.goal, undefined);
    evidence.invitation = {
      visible: true,
      privateContextHidden: true,
      acceptance: 'synthetic owner authorization in harness',
    };
    await mutate('2', 'membership', { action: 'accept' });
  }
  const input = JSON.stringify({
    lines: [
      { sku: 'notebook', quantity: 3, unit_price_cents: 1200 },
      { sku: 'marker', quantity: 4, unit_price_cents: 250 },
      { sku: 'storage_box', quantity: 2, unit_price_cents: 1800 },
    ],
    discount_percent: 10,
  });
  await mutate('1', 'tasks', {
    action: 'create',
    task_id: 'analysis',
    title: 'Compute the synthetic order totals',
    assignee: '2',
    reviewer: '1',
    input,
    output:
      'Submit a text artifact containing only a JSON object: lines (each sku, quantity, unit_price_cents, line_total_cents), total_units, subtotal_cents, discount_cents, total_cents. Independently calculate, preserve integer cents, and state provenance and verification.',
  });
  await mutate('1', 'tasks', {
    action: 'create',
    task_id: 'report',
    title: 'Create the reviewed Chinese summary',
    assignee: '1',
    reviewer: '2',
    dependencies: ['analysis'],
    input,
    output:
      'After independently reviewing and accepting the analysis artifact, submit a text artifact containing only a JSON object: total_units, subtotal_cents, discount_cents, total_cents, analysis_artifact_version, summary_zh (Chinese yuan summary), html (complete standalone HTML source, no external resources or network requests). Implement an offline Chinese order calculator in html: number inputs with ids notebook, marker, storage_box default quantities 3,4,2; prices fixed 12,2.5,18 yuan; 10 percent discount; output element id total with ONLY the final amount formatted to two decimals (initial 73.80). Recalculate synchronously on every input event. Show labels and subtotal. Reviewer must inspect the HTML logic as well as verify raw arithmetic. Submit actual source in the artifact; no local file path.',
  });
  const actions = [
    'context',
    'project.get',
    'updates.read',
    'tasks.list',
    'tasks.get',
    'tasks.accept',
    'tasks.start',
    'tasks.heartbeat',
    'tasks.block',
    'submit',
    'review.accept',
    'review.changes_requested',
    'review.reject',
  ];
  for (const identity of ['1', '2']) {
    policies[identity] = {
      home: fixture.homes[identity],
      identity,
      endpoint: fixture.endpoint,
      project: project.project_id,
      workspace,
      cliBinary: resolve(process.env.AGENTNET_LIVE_CLI),
      host:
        identity === '1' || sameHostDiagnostic
          ? {
              kind: 'codex',
              binary: resolve(process.env.AGENTNET_LIVE_CODEX),
              ...(process.env.AGENTNET_LIVE_CODEX_MODEL
                ? { model: process.env.AGENTNET_LIVE_CODEX_MODEL }
                : {}),
              ...(process.env.AGENTNET_LIVE_CODEX_COMPAT_TIER
                ? { serviceTier: process.env.AGENTNET_LIVE_CODEX_COMPAT_TIER }
                : {}),
            }
          : workerHost === 'opencode'
            ? {
                kind: 'opencode',
                temperature: 0,
                binary: resolve(process.env.AGENTNET_LIVE_OPENCODE),
                runtimeHome: await mkdtemp(
                  join(
                    resolve(process.env.AGENTNET_LIVE_OPENCODE_HOME),
                    'pilot-',
                  ),
                ),
                baseURL:
                  process.env.AGENTNET_LIVE_OPENCODE_URL ||
                  'http://127.0.0.1:11435/v1',
                model:
                  process.env.AGENTNET_LIVE_OPENCODE_MODEL ||
                  'elsewhere-local/qwen3:4b',
              }
            : {
                kind: 'claude_code',
                binary: resolve(process.env.AGENTNET_LIVE_CLAUDE),
                ...(process.env.CLAUDE_CODE_GIT_BASH_PATH
                  ? { bashPath: resolve(process.env.CLAUDE_CODE_GIT_BASH_PATH) }
                  : {}),
              },
      expiresAt: new Date(Date.now() + 1020000).toISOString(),
      maxTurns: 4,
      maxSeconds: 420,
      maxCostUsd: 2,
      allowedActions:
        identity === '1' ? [...actions, 'project.complete'] : actions,
      deliverProjectEvents: identity === '1',
      pollMilliseconds: 700,
      instruction:
        'Use only the provided synthetic order data. Do not disclose personal memory or call other systems. Independently recompute totals when reviewing and review the exact submitted artifact version. Finish each turn after the currently actionable work. For tasks.start provide host="native-pilot" (the bridge replaces it with its bound tag). Submit and review through MCP; do not merely describe intended operations. When every required task is accepted, the coordinator must call project.complete.',
    };
    await authorizePolicy(policies[identity]);
  }
  evidence.projectId = project.project_id;
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      phase: 'fixture-ready',
      directory,
      projectId: project.project_id,
    }),
  );
  await startThroughMcp('2');
  const firstClaude = await waitPhase(
    '2',
    'worker-analysis',
    (r) => r.project.tasks.analysis.state === 'submitted',
  );
  await stopIdle('2');
  await startThroughMcp('1');
  const firstCodex = await waitPhase(
    '1',
    'codex-review-and-report',
    (r) =>
      r.project.tasks.analysis.state === 'accepted_result' &&
      r.project.tasks.report.state === 'submitted',
  );
  await stopIdle('1');
  await startThroughMcp('2');
  const resumedClaude = await waitPhase(
    '2',
    'worker-resumed-review',
    (r) => r.project.tasks.report.state === 'accepted_result',
  );
  assert.equal(resumedClaude.state.sessionId, firstClaude.state.sessionId);
  assert.ok(resumedClaude.state.turns > firstClaude.state.turns);
  assert.ok(
    resumedClaude.state.workerInstance &&
      resumedClaude.state.workerInstance !== firstClaude.state.workerInstance,
  );
  assert.notEqual(
    resumedClaude.state.lastCompletion.jobId,
    firstClaude.state.lastCompletion.jobId,
  );
  await stopIdle('2');
  await startThroughMcp('1');
  const final = await waitPhase(
    '1',
    'codex-resumed-completion',
    (r) => r.project.state === 'completed',
  );
  assert.equal(final.state.sessionId, firstCodex.state.sessionId);
  assert.ok(final.state.turns > firstCodex.state.turns);
  assert.ok(
    final.state.workerInstance &&
      final.state.workerInstance !== firstCodex.state.workerInstance,
  );
  assert.notEqual(
    final.state.lastCompletion.jobId,
    firstCodex.state.lastCompletion.jobId,
  );
  for (const taskId of ['analysis', 'report']) {
    const artifact = final.snapshot.artifacts.find(
      (a) =>
        a.task_id === taskId &&
        a.version === final.snapshot.project.tasks[taskId].artifact_version,
    );
    assert.ok(artifact && artifact.kind === 'text');
    const value = JSON.parse(artifact.text);
    assert.deepEqual(
      [
        value.total_units,
        value.subtotal_cents,
        value.discount_cents,
        value.total_cents,
      ],
      [9, 8200, 820, 7380],
    );
    if (taskId === 'analysis') {
      assert.deepEqual(
        Object.fromEntries(
          value.lines.map((line) => [
            line.sku,
            [line.quantity, line.unit_price_cents, line.line_total_cents],
          ]),
        ),
        {
          notebook: [3, 1200, 3600],
          marker: [4, 250, 1000],
          storage_box: [2, 1800, 3600],
        },
      );
      assert.equal(value.lines.length, 3);
    } else {
      assert.equal(
        value.analysis_artifact_version,
        final.snapshot.project.tasks.analysis.artifact_version,
      );
      assert.match(value.summary_zh, /[\u3400-\u9fff]/);
      assert.ok(typeof value.html === 'string' && value.html.includes('<html'));
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route('**/*', (route) => route.abort());
        await page.setContent(value.html);
        assert.equal(
          (await page.locator('#total').innerText()).trim(),
          '73.80',
        );
        await page.locator('#notebook').fill('0');
        assert.equal(
          (await page.locator('#total').innerText()).trim(),
          '41.40',
        );
        await page.locator('#marker').fill('0');
        await page.locator('#storage_box').fill('0');
        assert.equal((await page.locator('#total').innerText()).trim(), '0.00');
        evidence.deliverableChecks = [
          'initial 73.80',
          'remove notebooks 41.40',
          'empty basket 0.00',
          'network blocked',
        ];
      } finally {
        await browser.close();
      }
      await writeFile(
        join(directory, 'order-calculator.html'),
        value.html,
        'utf8',
      );
    }
  }
  evidence.artifacts = final.snapshot.artifacts;
  evidence.finalProject = final.snapshot.project;
  evidence.hostReceipts = {};
  for (const identity of ['1', '2']) {
    const folder = policyDirectory(policies[identity]);
    const files = await readdir(folder);
    evidence.hostReceipts[identity] = await Promise.all(
      files
        .filter((name) => /^(receipt|completion)-.*\.json$/.test(name))
        .map(async (name) => ({
          name,
          value: JSON.parse(await readFile(join(folder, name), 'utf8')),
        })),
    );
    const completions = evidence.hostReceipts[identity]
      .filter(({ name }) => name.startsWith('completion-'))
      .map(({ value }) => value);
    assert.ok(
      completions.length >= 2,
      'Two native completions per host required',
    );
    const nativeTools = new Set();
    for (const completion of completions) {
      assert.ok(
        typeof completion.model === 'string' && completion.model.length > 0,
        'Native model receipt required',
      );
      assert.ok(
        Array.isArray(completion.observedTools) &&
          completion.observedTools.length > 0,
        'Native MCP observations required',
      );
      assert.equal(
        completion.sessionId,
        evidence.phases.find((phase) => phase.identity === identity).sessionId,
      );
      assert.ok(
        evidence.hostReceipts[identity].some(
          ({ name, value }) =>
            name.startsWith('receipt-') && value.jobId === completion.jobId,
        ),
      );
      for (const tool of completion.observedTools) nativeTools.add(tool);
    }
    assert.ok(
      [...nativeTools].some((tool) =>
        tool.endsWith('network_collaboration_submit'),
      ),
    );
    assert.ok(
      [...nativeTools].some((tool) =>
        tool.endsWith('network_collaboration_review'),
      ),
    );
    assert.ok(
      evidence.hostReceipts[identity].some(({ value }) =>
        value.calls?.some(
          (call) => call.action === 'submit' && call.status === 'completed',
        ),
      ),
    );
    assert.ok(
      evidence.hostReceipts[identity].some(({ value }) =>
        value.calls?.some(
          (call) =>
            call.action === 'review.accept' && call.status === 'completed',
        ),
      ),
    );
  }
} catch (error) {
  runFailure = error;
  evidence.failure = error.message;
}
async function cleanupPilot() {
  for (const identity of started) {
    const policy = policies[identity];
    try {
      await controlBackground(policy, 'stop');
      let confirmed = false;
      for (let i = 0; i < 75; i++) {
        const locked = await stat(
          join(policyDirectory(policy), 'lock.json'),
        ).then(
          () => true,
          (error) => {
            if (error.code !== 'ENOENT') throw error;
            return false;
          },
        );
        const state = await readStatus(policy);
        if (
          !locked &&
          [
            'stopped',
            'completed',
            'quarantined',
            'authorization_failed',
            'budget_exhausted',
          ].includes(state.status)
        ) {
          if (!runFailure)
            assert.ok(
              !state.pending &&
                (state.status === 'completed' ||
                  (state.status === 'stopped' && state.stopAcknowledged)),
            );
          confirmed = true;
          break;
        }
        await delay(200);
      }
      if (!confirmed)
        throw new Error(
          'Background worker shutdown not confirmed for identity ' + identity,
        );
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await fixture.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  // Fixture marketplaces are unique and never replace the user's installed source.
  evidence.cleanupVerified = cleanupFailures.length === 0;
  evidence.cleanupFailures = cleanupFailures.map((error) => error.message);
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
}
await cleanupPilot();
if (runFailure || cleanupFailures.length)
  throw new AggregateError(
    [...(runFailure ? [runFailure] : []), ...cleanupFailures],
    'Real-host acceptance did not complete; local evidence records the failure',
  );
const database = JSON.parse(
  await readFile(join(directory, 'database.json'), 'utf8'),
);
assert.equal(database.collaboration_reviews.length, 2);
assert.ok(
  database.collaboration_reviews.every(
    (review) => review.decision === 'accept',
  ),
);
assert.equal(
  new Set(
    database.collaboration_reviews.map((review) => String(review.reviewer)),
  ).size,
  2,
);
assert.equal(database.collaboration_projects.length, 1);
assert.deepEqual(
  database.collaboration_projects[0].document,
  evidence.finalProject,
);
assert.equal(database.collaboration_projects[0].document.state, 'completed');
for (const review of database.collaboration_reviews) {
  assert.equal(review.project_id, project.project_id);
  assert.equal(
    String(review.reviewer),
    { analysis: '1', report: '2' }[review.task_id],
  );
  assert.equal(
    review.artifact_version,
    evidence.finalProject.tasks[review.task_id].artifact_version,
  );
  assert.ok(
    database.collaboration_artifacts.some(
      (artifact) =>
        artifact.project_id === review.project_id &&
        artifact.task_id === review.task_id &&
        artifact.version === review.artifact_version,
    ),
  );
}
assert.equal(database.collaboration_runs.length, 2);
assert.ok(
  database.collaboration_runs.every(
    (run) =>
      run.project_id === project.project_id && run.status === 'submitted',
  ),
);
evidence.passed = true;
await writeFile(
  join(directory, 'evidence.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    passed: true,
    variant: evidence.variant,
    directory,
    projectId: project.project_id,
    phases: evidence.phases.length,
    exactSessionResumes: 2,
    artifacts: evidence.artifacts.length,
    reviews: database.collaboration_reviews.length,
  }),
);
