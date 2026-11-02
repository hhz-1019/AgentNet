// Real CLI/core and detached companion. Empty worker project means no model call.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startCollaborationLiveFixture } from './collaboration-live-fixture.mjs';
import { enable } from '../client/collaboration-enable.mjs';
import {
  controlBackground,
  readStatus,
  policyDirectory,
} from '../client/collaboration-background.mjs';
for (const key of [
  'AGENTNET_GO_BINARY',
  'AGENTNET_LIVE_CLI',
  'AGENTNET_LIVE_CODEX',
])
  if (!process.env[key]) throw new Error('Missing ' + key);
const directory = await mkdtemp(resolve('.agentnet-audit/pair-shortcut-'));
const fixture = await startCollaborationLiveFixture({
  directory,
  goBinary: resolve(process.env.AGENTNET_GO_BINARY),
  cliBinary: resolve(process.env.AGENTNET_LIVE_CLI),
});
let binding;
try {
  let { project } = await fixture.clients['1'].collaboration_project({
    action: 'create',
    goal: 'Idle shortcut test',
    expected_version: 0,
    idempotency_key: randomUUID(),
  });
  ({ project } = await fixture.clients['1'].collaboration_project({
    action: 'invite',
    project_id: project.project_id,
    agent_id: '2',
    role: 'worker',
    scopes: ['read', 'work', 'review'],
    expected_version: project.version,
    idempotency_key: randomUUID(),
  }));
  await fixture.clients['2'].collaboration_membership({
    action: 'accept',
    project_id: project.project_id,
    expected_version: project.version,
    idempotency_key: randomUUID(),
  });
  const connection = join(directory, 'connection.json');
  await writeFile(
    connection,
    JSON.stringify({
      host: 'codex',
      hostBinary: resolve(process.env.AGENTNET_LIVE_CODEX),
      cli: resolve(process.env.AGENTNET_LIVE_CLI),
      home: fixture.homes['2'],
      endpoint: fixture.endpoint,
    }),
  );
  binding = {
    home: fixture.homes['2'],
    identity: '2',
    endpoint: fixture.endpoint,
    project: project.project_id,
  };
  const result = await enable({
    connection,
    project: project.project_id,
    workspace: directory,
    hours: 1,
    turns: 2,
  });
  assert.equal(result.startRequested, true);
  let status;
  for (let i = 0; i < 100; i++) {
    status = await readStatus(binding);
    if (status.status === 'idle') break;
    await delay(100);
  }
  assert.equal(status.status, 'idle');
  assert.equal(status.turns, 0);
  const policy = JSON.parse(
    await readFile(join(policyDirectory(binding), 'policy.json'), 'utf8'),
  );
  assert.equal(policy.identity, '2');
  assert.equal(policy.maxTurns, 2);
  assert.equal(policy.deliverProjectEvents, false);
  await controlBackground(binding, 'stop');
  for (let i = 0; i < 100; i++) {
    status = await readStatus(binding);
    if (status.stopAcknowledged) break;
    await delay(100);
  }
  assert.equal(status.stopAcknowledged, true);
  console.log(
    JSON.stringify({
      passed: true,
      directory,
      detachedStart: true,
      stopAcknowledged: true,
      modelCalls: 0,
    }),
  );
} finally {
  if (binding) await controlBackground(binding, 'stop').catch(() => {});
  await fixture.close();
}
