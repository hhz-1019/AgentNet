import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autopilotTick,
  matchesScope,
  projectPolicy,
  automationSchema,
} from './collaboration-autopilot.mjs';
import { coordinationReady } from './collaboration-background.mjs';
const config = {
  scope: { peer: 'Peer1' },
  peer: 'peer',
  identity: 'self',
  maxProjects: 1,
  turns: 12,
  workspace: '/workspace',
  home: '/home',
  endpoint: 'https://example.test',
  hostBinary: '/host',
  cliBinary: '/node',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  instruction: 'Complete the approved project',
};
function setup() {
  let accepted = false,
    starts = 0,
    policies = 0;
  const project = {
    project_id: 'p',
    state: 'active',
    version: 3,
    members: {
      self: { state: 'active', scopes: ['read', 'work'] },
      peer: { state: 'active', scopes: ['read', 'coordinate'] },
    },
    tasks: {},
  };
  const state = { projects: {} };
  const client = {
    collaboration_project: async (q) =>
      q.action === 'list'
        ? {
            projects: [
              accepted
                ? project
                : {
                    project_id: 'p',
                    version: 2,
                    offer: { state: 'invited', inviter: 'peer' },
                  },
            ],
            has_more: false,
          }
        : { project },
    collaboration_membership: async (q) => {
      assert.equal(q.project_id, 'p');
      assert.ok(state.projects.p.accept);
      accepted = true;
      return { project };
    },
  };
  const runtime = {
    persist: async () => {},
    policy: async () => null,
    authorize: async (p) => {
      assert.equal(p.deliverProjectEvents, true);
      policies++;
    },
    start: async () => {
      starts++;
    },
    status: async () => ({ status: starts ? 'idle' : 'not_started' }),
  };
  return { client, state, runtime, counts: () => ({ starts, policies }) };
}
void test('trusted peer invitation is accepted once and starts continuous work once', async () => {
  const f = setup();
  await autopilotTick(config, f.state, f.client, f.runtime);
  await autopilotTick(config, f.state, f.client, f.runtime);
  assert.deepEqual(f.counts(), { starts: 1, policies: 1 });
  assert.equal(f.state.projects.p.status, 'started');
});
void test('foreign invitations and unrelated projects never enter the owner scope', () => {
  assert.equal(matchesScope({ offer: { inviter: 'stranger' } }, config), false);
  assert.equal(
    matchesScope(
      { members: { peer: { state: 'active' }, self: { state: 'revoked' } } },
      config,
    ),
    false,
  );
  assert.equal(
    matchesScope(
      { project_id: 'other' },
      { ...config, scope: { project: 'p' } },
    ),
    false,
  );
});
void test('an uncertain acceptance reuses exactly the journaled request', async () => {
  const f = setup(),
    seen = [];
  f.client.collaboration_membership = async (q) => {
    seen.push({ ...q });
    throw Error('network timeout');
  };
  await assert.rejects(autopilotTick(config, f.state, f.client, f.runtime));
  await assert.rejects(autopilotTick(config, f.state, f.client, f.runtime));
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(f.counts(), { starts: 0, policies: 0 });
});
void test('definite version conflict refreshes version and idempotency key', async () => {
  const f = setup();
  f.client.collaboration_membership = async () => {
    throw Object.assign(Error('conflict'), {
      apiCode: 'COLLABORATION_VERSION_CONFLICT',
    });
  };
  await assert.rejects(autopilotTick(config, f.state, f.client, f.runtime));
  assert.equal(f.state.projects.p.accept, null);
});
void test('pre-existing project authorization is not replaced or restarted', async () => {
  const f = setup();
  f.runtime.policy = async () => ({ authorizationId: 'older' });
  await autopilotTick(config, f.state, f.client, f.runtime);
  assert.deepEqual(f.counts(), { starts: 0, policies: 0 });
});
void test('only coordinators plan and complete; workers can communicate and review', () => {
  const project = {
    project_id: 'p',
    members: {
      self: { state: 'active', scopes: ['read', 'coordinate'] },
      peer: { state: 'active' },
    },
    tasks: {},
  };
  const p = projectPolicy(config, project);
  assert.ok(p.allowedActions.includes('tasks.create'));
  assert.ok(coordinationReady(project, p));
  project.tasks.a = { state: 'submitted' };
  assert.equal(coordinationReady(project, p), false);
  project.tasks.a.state = 'accepted_result';
  assert.equal(coordinationReady(project, p), true);
  project.members.self.scopes = ['read', 'work'];
  const worker = projectPolicy(config, project);
  assert.equal(worker.allowedActions.includes('tasks.create'), false);
  assert.ok(worker.allowedActions.includes('updates.publish'));
});
void test('automation scope and budgets are bounded', () => {
  for (const args of [
    { action: 'enable' },
    { action: 'enable', project_id: 'p', peer_short_id: 'x' },
    { action: 'enable', project_id: 'p', turns: 0 },
    { action: 'enable', project_id: 'p', hours: 25 },
  ])
    assert.throws(() => automationSchema.parse(args));
});
