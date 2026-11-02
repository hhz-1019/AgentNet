// Real production enrollment/signature handlers over an isolated local SQL database.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { startCollaborationLiveFixture } from './collaboration-live-fixture.mjs';
import { InstallationClient } from '../client/collaboration-identity.mjs';
process.env.AGENTNET_PLUGIN_TEST_LOOPBACK = '1';
const directory = await mkdtemp(resolve('.agentnet-audit/installation-'));
const fixture = await startCollaborationLiveFixture({
  directory,
  goBinary: process.env.AGENTNET_GO_BINARY,
  cliBinary: process.execPath,
});
const evidence = {
  passed: false,
  authentication:
    'production Ed25519 enrollment and request verification; no fixture bearer or human accounts',
  checks: [],
};
try {
  const [a, b] = [fixture.clients['1'], fixture.clients['2']];
  assert.equal(a.identity.agent_id, '1');
  assert.equal(b.identity.agent_id, '2');
  assert.notEqual(a.identity.short_id, b.identity.short_id);
  assert.equal(
    (await fixture.db.query('SELECT * FROM agent_owners')).rows.length,
    0,
  );
  evidence.checks.push('fresh installations connect without human accounts');
  const restarted = new InstallationClient({
    home: fixture.homes['1'],
    endpoint: fixture.endpoint,
    allowLoopback: true,
  });
  await restarted.connect();
  assert.equal(restarted.identity.agent_id, a.identity.agent_id);
  assert.equal(restarted.identity.short_id, a.identity.short_id);
  let recorded;
  a.fetchImpl = async (url, options) => {
    recorded = { url, options };
    return fetch(url, options);
  };
  await a.collaboration_project({ action: 'list' });
  assert.equal(
    (
      await fetch(fixture.endpoint + '/api/v2/agent-context', {
        headers: recorded.options.headers,
      })
    ).status,
    401,
  );
  evidence.checks.push(
    'installation cannot access legacy account or social APIs',
  );
  assert.equal((await fetch(recorded.url, recorded.options)).status, 401);
  assert.equal(
    (
      await fetch(recorded.url, {
        ...recorded.options,
        body: '{"action":"create"}',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(recorded.url, {
        ...recorded.options,
        headers: {
          ...recorded.options.headers,
          'X-Elsewhere-Key': b.publicKey,
        },
      })
    ).status,
    401,
  );
  evidence.checks.push(
    'restart preserves identity',
    'signature replay rejected',
    'body tampering rejected',
    'another public key cannot impersonate',
  );
  const peer = await a.collaboration_project({
    action: 'resolve',
    short_id: '@' + b.identity.short_id,
  });
  assert.equal(peer.agent_id, '2');
  for(let i=0;i<125;i++) await a.collaboration_project({action:'list'});
  evidence.checks.push('normal polling burst remains below connection quota');
  let project = (
    await a.collaboration_project({
      action: 'create',
      goal: '免注册双人协作测试',
      expected_version: 0,
      idempotency_key: randomUUID(),
    })
  ).project;
  const mutate = async (client, group, request) => {
    const r = await client['collaboration_' + group]({
      ...request,
      project_id: project.project_id,
      expected_version: project.version,
      idempotency_key: randomUUID(),
    });
    project = r.project;
    return r;
  };
  await mutate(a, 'project', {
    action: 'invite',
    agent_id: '2',
    role: 'worker',
    scopes: ['read', 'work', 'review'],
    text: '请核验 12×3+8=44',
  });
  await assert.rejects(
    b.collaboration_context({ project_id: project.project_id }),
    (e) => e.status === 403,
  );
  assert.equal(
    (await b.collaboration_project({ action: 'list' })).projects.length,
    1,
  );
  await mutate(b, 'membership', { action: 'accept' });
  await mutate(a, 'tasks', {
    action: 'create',
    task_id: 'calculation',
    title: '核验',
    assignee: '2',
    reviewer: '1',
  });
  await mutate(b, 'tasks', { action: 'accept', task_id: 'calculation' });
  await mutate(b, 'tasks', {
    action: 'start',
    task_id: 'calculation',
    host: 'integration-test',
  });
  await mutate(b, 'submit', {
    task_id: 'calculation',
    epoch: project.tasks.calculation.epoch,
    artifact: {
      kind: 'text',
      text: '12×3+8=44',
      provenance: 'test calculation',
      verification: 'arithmetic',
    },
  });
  await assert.rejects(
    mutate(b, 'review', {
      action: 'accept',
      task_id: 'calculation',
      artifact_version: 1,
    }),
    (e) => e.status === 403,
  );
  await mutate(a, 'review', {
    action: 'accept',
    task_id: 'calculation',
    artifact_version: 1,
  });
  await mutate(a, 'project', { action: 'complete' });
  assert.equal(project.state, 'completed');
  evidence.checks.push(
    'unaccepted invitation cannot read context',
    'invite accept task submit exact review completion',
    'worker cannot self-approve',
  );
  const before = await readFile(
    join(fixture.homes['2'], 'collaboration-key.json'),
    'utf8',
  );
  await fixture.db.query(
    'UPDATE collaboration_installations SET revoked_at=1 WHERE agent_id=2',
  );
  await assert.rejects(b.connect(), (e) => e.status === 401);
  assert.equal(
    await readFile(join(fixture.homes['2'], 'collaboration-key.json'), 'utf8'),
    before,
  );
  assert.equal(
    (await fixture.db.query('SELECT * FROM collaboration_installations')).rows
      .length,
    2,
  );
  evidence.checks.push(
    'revocation rejects reconnect without replacement identity',
  );
  if (
    process.env.AGENTNET_LIVE_PLUGIN_MARKETPLACE &&
    process.env.AGENTNET_NATIVE_APP_SERVER
  ) {
    const code = await new Promise((done, reject) => {
      const child = spawn(
        process.execPath,
        [
          'elsewhere/scripts/codex-plugin-test.mjs',
          process.env.AGENTNET_LIVE_PLUGIN_MARKETPLACE,
          process.env.AGENTNET_NATIVE_APP_SERVER,
        ],
        {
          env: {
            ...process.env,
            AGENTNET_PLUGIN_TEST_ENDPOINT: fixture.endpoint,
          },
          windowsHide: true,
          stdio: 'inherit',
        },
      );
      child.once('error', reject);
      child.once('exit', done);
    });
    assert.equal(code, 0);
    evidence.checks.push(
      'native Codex fresh install connects automatically without external Node or login',
    );
  }
  evidence.passed = true;
} finally {
  await fixture.close();
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ directory, ...evidence }));
}
