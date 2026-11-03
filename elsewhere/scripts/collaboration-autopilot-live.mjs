import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startCollaborationLiveFixture } from './collaboration-live-fixture.mjs';
import {
  configureAutopilot,
  autopilotDirectory,
} from '../client/collaboration-autopilot.mjs';
import {
  readStatus,
  controlBackground,
} from '../client/collaboration-background.mjs';
if (!process.argv.includes('--run-live'))
  throw new Error('Explicit --run-live required for real model calls');
for (const name of [
  'AGENTNET_GO_BINARY',
  'AGENTNET_LIVE_CLI',
  'AGENTNET_LIVE_CODEX',
])
  if (!process.env[name]) throw new Error('Missing ' + name);
const directory = await mkdtemp(
  join(
    resolve(process.env.AGENTNET_LIVE_AUDIT_ROOT || '.agentnet-audit'),
    'autopilot-live-',
  ),
);
const fixture = await startCollaborationLiveFixture({
  directory,
  goBinary: resolve(process.env.AGENTNET_GO_BINARY),
  cliBinary: resolve(process.env.AGENTNET_LIVE_CLI),
});
const clients = [fixture.clients['1'], fixture.clients['2']];
const enabled = [];
let project;
const evidence = {
  passed: false,
  directory,
  manualPromptsAfterInvite: 0,
  workerHost: process.env.AGENTNET_LIVE_WORKER_HOST || 'codex',
  realModels: true,
};
try {
  project = (
    await clients[0].collaboration_project({
      action: 'create',
      goal: 'Automatic handoff acceptance test: worker calculates 12*3+8. Coordinator creates exactly one task assigned to the other member and reviews it. Worker first submission must contain just 44. Coordinator must request changes on artifact version 1 asking for the derivation. Worker second submission must add the derivation 12*3=36;36+8=44. Coordinator accepts version 2 after checking and completes the project. Do not ask a human to continue.',
      expected_version: 0,
      idempotency_key: randomUUID(),
    })
  ).project;
  for (let i = 0; i < 2; i++) {
    const workspace = join(directory, 'workspace-' + i);
    await mkdir(workspace);
    const scope =
      i === 0
        ? { project_id: project.project_id }
        : { peer_short_id: clients[0].identity.short_id };
    const args = {
      action: 'enable',
      ...scope,
      workspace,
      host_kind:
        i === 1 ? process.env.AGENTNET_LIVE_WORKER_HOST || 'codex' : 'codex',
      host_binary: resolve(process.env.AGENTNET_LIVE_CODEX),
      model: process.env.AGENTNET_LIVE_CODEX_MODEL || 'gpt-6.1-sol',
      hours: 1,
      turns: 12,
      instruction:
        'Complete the arithmetic test entirely through collaboration MCP; no user follow-up. Follow the project requirements including the deliberate version-1 review correction.',
    };
    if (i === 1 && process.env.AGENTNET_LIVE_WORKER_HOST === 'opencode') {
      args.host_binary = resolve(process.env.AGENTNET_LIVE_OPENCODE);
      args.model = process.env.AGENTNET_LIVE_OPENCODE_MODEL;
      args.model_base_url = process.env.AGENTNET_LIVE_OPENCODE_URL;
    }
    if (i === 1 && process.env.AGENTNET_LIVE_WORKER_HOST === 'claude_code') {
      args.host_binary = resolve(process.env.AGENTNET_LIVE_CLAUDE);
      delete args.model;
    }
    console.log('ENABLE', i, await configureAutopilot(clients[i], args));
    enabled.push({ client: clients[i], scope });
  }
  project = (
    await clients[0].collaboration_project({
      action: 'invite',
      project_id: project.project_id,
      agent_id: '2',
      role: 'worker',
      scopes: ['read', 'work', 'review'],
      text: 'Please perform the authorized arithmetic acceptance project.',
      expected_version: project.version,
      idempotency_key: randomUUID(),
    })
  ).project;
  console.log('INVITED', project.project_id, directory);
  for (let n = 0; n < 144; n++) {
    await delay(5000);
    project = (
      await clients[0].collaboration_project({
        action: 'get',
        project_id: project.project_id,
      })
    ).project;
    const statuses = await Promise.all(
      clients.map((c) =>
        readStatus({
          home: c.cliHome,
          identity: c.identity.agent_id,
          endpoint: c.endpoint,
          project: project.project_id,
        }),
      ),
    );
    if (n % 3 === 0)
      console.log(
        JSON.stringify({
          state: project.state,
          tasks: Object.values(project.tasks).map((t) => ({
            state: t.state,
            version: t.artifact_version,
          })),
          workers: statuses.map((s) => ({
            status: s.status,
            turns: s.turns,
            reason: s.reason,
            attention: s.attention,
            native: s.nativeMetadata,
          })),
        }),
      );
    if (
      statuses.some((s) =>
        ['quarantined', 'budget_exhausted', 'authorization_failed'].includes(
          s.status,
        ),
      )
    )
      throw Error('Autonomous worker stopped: ' + JSON.stringify(statuses));
    if (project.state === 'completed') {
      assert.equal(project.members['2'].state, 'active');
      const tasks = Object.values(project.tasks);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].state, 'accepted_result');
      assert.equal(tasks[0].artifact_version, 2);
      if (!statuses.every((s) => s.status === 'completed')) continue;
      evidence.project = project;
      evidence.workers = statuses;
      evidence.passed = true;
      break;
    }
  }
  assert.equal(evidence.passed, true, 'Autonomous completion timed out');
} finally {
  for (const e of enabled)
    await configureAutopilot(e.client, { action: 'stop', ...e.scope }).catch(
      () => {},
    );
  if (project)
    for (const c of clients)
      await controlBackground(
        {
          home: c.cliHome,
          identity: c.identity.agent_id,
          endpoint: c.endpoint,
          project: project.project_id,
        },
        'stop',
      ).catch(() => {});
  await delay(4000);
  evidence.cleanup = [];
  if (project)
    for (const c of clients) {
      const b = {
        home: c.cliHome,
        identity: c.identity.agent_id,
        endpoint: c.endpoint,
        project: project.project_id,
      };
      const s = await readStatus(b);
      evidence.cleanup.push({
        status: s.status,
        stopAcknowledged: s.stopAcknowledged,
      });
    }
  for (const e of enabled) {
    const scope = e.scope.project_id
      ? { project: e.scope.project_id }
      : { peer: e.scope.peer_short_id };
    const d = autopilotDirectory(e.client, scope);
    let exited = false;
    for (let j = 0; j < 50; j++) {
      const state = JSON.parse(await readFile(join(d, 'state.json'), 'utf8'));
      try {
        process.kill(state.pid, 0);
      } catch (err) {
        if (err.code === 'ESRCH') {
          exited = true;
          break;
        }
      }
      await delay(200);
    }
    assert.ok(exited, 'watcher must exit');
  }
  for (const c of clients) {
    const state = await readStatus({
      home: c.cliHome,
      identity: c.identity.agent_id,
      endpoint: c.endpoint,
      project: project.project_id,
    });
    let exited = false;
    try {
      process.kill(state.pid, 0);
    } catch (e) {
      exited = e.code === 'ESRCH';
    }
    assert.ok(exited, 'background must exit');
  }
  await fixture.close();
  evidence.cleanupVerified = true;
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log('EVIDENCE', directory, evidence.passed);
}
