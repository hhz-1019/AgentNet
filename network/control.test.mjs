import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AgentNetwork } from './sdk.mjs';
import { approvalGate, controlView, recordChanges } from './control.mjs';

await test('human control plane: approvals, isolated read state, real execution, history and persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentnet-control-')),
    port = 19500 + Math.floor(Math.random() * 400),
    base = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(
      process.execPath,
      ['network/live-server.mjs', '--production'],
      {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: '127.0.0.1',
          PUBLIC_URL: '',
          AGENTNET_DATA_DIR: dir,
        },
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(base + '/healthz')).ok) return;
      } catch {}
      await delay(80);
    }
    throw Error('server startup failed');
  }
  async function stop() {
    if (child?.exitCode === null)
      await new Promise((r) => {
        child.once('exit', r);
        child.kill();
      });
  }
  async function request(path, p, headers = {}, status = 200) {
    const r = await fetch(base + path, {
      method: p === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(p === undefined ? {} : { body: JSON.stringify(p) }),
    });
    const body = await r.json();
    assert.equal(r.status, status, JSON.stringify(body));
    return { body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const rid = () => randomUUID();
  try {
    await start();
    const reg = await request('/api/auth/register', {
        username: 'control-owner',
        password: 'testing-password-123',
      }),
      h = { cookie: reg.cookie, 'X-AgentNet-CSRF': reg.body.csrf };
    const own = async (action, payload = {}) =>
      (await request('/api/v1/owner', { action, payload }, h)).body;
    const aid = (await own('create_agent', { display_name: 'Planner' })).result
      .agent.agent_id;
    const at = (await own('issue-token', { label: 'Planner test' })).result
      .token;
    const bid = (await own('create_agent', { display_name: 'Worker' })).result
      .agent.agent_id;
    const bt = (await own('issue-token', { label: 'Worker test' })).result
      .token;
    const a = new AgentNetwork({ baseUrl: base, token: at }),
      b = new AgentNetwork({ baseUrl: base, token: bt });
    await a.connect();
    await b.connect();
    await own('set_policy', {
      agent_id: aid,
      category: 'send_message',
      mode: 'ask',
    });
    const p = {
      target_agent_id: bid,
      text: 'Requires approval',
      request_id: rid(),
    };
    const pending = await a.send_message(p);
    assert.equal(pending.pending, true);
    assert.equal((await b.get_messages()).total, 0);
    assert.equal((await a.send_message(p)).approval_id, pending.approval_id);
    const stranger = await request('/api/auth/register', {
      username: 'other-owner',
      password: 'testing-password-123',
    });
    await request(
      '/api/v1/owner',
      {
        action: 'decide_approval',
        payload: {
          agent_id: aid,
          approval_id: pending.approval_id,
          decision: 'approve',
        },
      },
      { cookie: stranger.cookie, 'X-AgentNet-CSRF': stranger.body.csrf },
      403,
    );
    await own('decide_approval', {
      agent_id: aid,
      approval_id: pending.approval_id,
      decision: 'approve',
    });
    await assert.rejects(
      () =>
        a.send_message({
          ...p,
          text: 'changed',
          approval_id: pending.approval_id,
        }),
      (e) => e.code === 'APPROVAL_MISMATCH',
    );
    const sent = await a.send_message({
      ...p,
      approval_id: pending.approval_id,
    });
    assert.deepEqual(
      await a.send_message({ ...p, approval_id: pending.approval_id }),
      sent,
    );
    assert.equal((await b.get_messages()).total, 1);
    await own('read', { agent_id: bid, id: sent.conversation_id });
    assert.equal(
      (await b.get_messages({ unread_only: true })).total,
      1,
      'human read must not consume Agent inbox',
    );
    assert.equal(
      (await own('select_agent', { agent_id: bid })).conversations[0].unread,
      0,
    );
    await b.acknowledge_messages({ conversation_id: sent.conversation_id });
    assert.equal((await a.get_messages()).items[0].status, 'read');
    await own('set_policy', {
      agent_id: aid,
      category: 'send_message',
      mode: 'deny',
    });
    await assert.rejects(
      () => a.send_message({ ...p, request_id: rid() }),
      (e) => e.code === 'POLICY_DENIED',
    );
    await request(
      '/api/tools/network_message',
      { agentId: bid, text: 'bypass', requestId: rid() },
      { Authorization: 'Bearer ' + at },
      403,
    );
    await own('set_policy', {
      agent_id: aid,
      category: 'send_message',
      mode: 'allow',
    });
    const queued = (
      await own('queue_control', {
        agent_id: aid,
        operation: 'send_message',
        params: { target_agent_id: bid, text: 'Human instructed' },
        summary: 'Send a controlled message',
      })
    ).result.request;
    assert.equal(
      (await b.get_messages()).total,
      1,
      'queueing is not execution',
    );
    assert.equal((await a.get_control_requests()).items[0].id, queued.id);
    await assert.rejects(
      () =>
        a.respond_control_request({
          control_request_id: queued.id,
          status: 'completed',
        }),
      (e) => e.code === 'EXECUTION_REQUIRED',
    );
    await assert.rejects(
      () =>
        a.send_message({
          ...queued.payload,
          text: 'wrong',
          control_request_id: queued.id,
        }),
      (e) => e.code === 'CONTROL_MISMATCH',
    );
    await a.respond_control_request({
      control_request_id: queued.id,
      status: 'accepted',
    });
    const executed = await a.send_message({
      ...queued.payload,
      control_request_id: queued.id,
    });
    assert.deepEqual(
      await a.send_message({
        ...queued.payload,
        control_request_id: queued.id,
      }),
      executed,
    );
    assert.equal((await a.get_control_requests()).items[0].status, 'completed');
    assert.equal((await b.get_messages()).total, 2);
    const cancelled = (
      await own('queue_control', {
        agent_id: aid,
        operation: 'send_message',
        params: { target_agent_id: bid, text: 'cancel this' },
      })
    ).result.request;
    await own('cancel_control', {
      agent_id: aid,
      control_request_id: cancelled.id,
    });
    await assert.rejects(
      () =>
        a.send_message({
          ...cancelled.payload,
          control_request_id: cancelled.id,
        }),
      (e) => e.code === 'CONTROL_UNAVAILABLE',
    );
    const taskInput = {
      target_agent_id: bid,
      task: 'Analyze document',
      permissions: ['share_file', 'read_context'],
      context: { text: 'hello' },
      request_id: rid(),
    };
    const taskApproval = await a.invoke_agent(taskInput);
    assert.equal(taskApproval.pending, true);
    await own('decide_approval', {
      agent_id: aid,
      approval_id: taskApproval.approval_id,
      decision: 'approve',
    });
    const task = (await a.invoke_agent(taskInput)).invocation;
    const accept = {
      invocation_id: task.id,
      action: 'accept',
      permissions: ['share_file', 'read_context'],
      request_id: rid(),
    };
    const ap = await b.respond_invocation(accept);
    assert.equal(ap.pending, true);
    await own('decide_approval', {
      agent_id: bid,
      approval_id: ap.approval_id,
      decision: 'approve',
      permissions: ['read_context'],
    });
    assert.deepEqual(
      (await b.respond_invocation(accept)).invocation.accepted_permissions,
      ['read_context'],
    );
    await b.respond_invocation({
      invocation_id: task.id,
      action: 'start',
      request_id: rid(),
    });
    await b.respond_invocation({
      invocation_id: task.id,
      action: 'complete',
      result: { text: 'HELLO' },
      request_id: rid(),
    });
    let dashboard = await own('select_agent', { agent_id: aid });
    assert.deepEqual(
      dashboard.invocations[0].history.map((h) => h.status),
      ['requested', 'accepted', 'running', 'completed'],
    );
    for (const kind of [
      'agent_online',
      'message_sent',
      'permission_requested',
      'human_intervention',
      'task_created',
      'task_accepted',
      'task_completed',
    ])
      assert.ok(
        dashboard.timeline.some((e) => e.type === kind),
        kind,
      );
    await own('set_policy', {
      agent_id: aid,
      category: 'external_tool',
      mode: 'deny',
    });
    await assert.rejects(
      () =>
        a.invoke_agent({
          ...taskInput,
          permissions: ['share_file', 'shell'],
          request_id: rid(),
        }),
      (e) => e.code === 'POLICY_DENIED',
      'all risk categories must be checked',
    );
    const rejected = await b.request_approval({
      category: 'share_context',
      summary: 'Share context',
      request_id: rid(),
    });
    await own('decide_approval', {
      agent_id: bid,
      approval_id: rejected.approval_id,
      decision: 'reject',
    });
    const raw = JSON.parse(await readFile(join(dir, 'network.json'), 'utf8'));
    const pendingForExpiry = await b.request_approval({
      category: 'share_file',
      summary: 'Expiry test',
      request_id: rid(),
    });
    const state = JSON.parse(await readFile(join(dir, 'network.json'), 'utf8'));
    const expiry = state.approvals.find(
      (x) => x.id === pendingForExpiry.approval_id,
    );
    expiry.expires_at = 0;
    assert.throws(
      () =>
        approvalGate(
          state,
          { agentId: bid, connectionId: expiry.credential_id },
          'request_approval',
          { ...expiry.payload, approval_id: expiry.id },
        ),
      (e) => e.code === 'APPROVAL_EXPIRED',
    );
    assert.equal(
      controlView(state, { agentId: bid }).approvals.find(
        (x) => x.id === expiry.id,
      ).status,
      'expired',
    );
    expiry.status = 'authorized';
    expiry.execution_result = { allowed: true, permissions: ['share_file'] };
    assert.throws(
      () =>
        approvalGate(
          state,
          { agentId: bid, connectionId: expiry.credential_id },
          'request_approval',
          { ...expiry.payload, approval_id: expiry.id },
        ),
      (e) => e.code === 'APPROVAL_EXPIRED',
    );
    const before = structuredClone(raw);
    raw.connections.forEach((c) => (c.lastSeenAt = 0));
    recordChanges(before, raw);
    assert.ok(raw.activityEvents.some((e) => e.type === 'agent_offline'));
    await stop();
    await start();
    dashboard = (await request('/api/network', undefined, h)).body;
    assert.ok(dashboard.timeline.some((e) => e.type === 'task_completed'));
    assert.equal(
      dashboard.controlRequests.find((r) => r.id === queued.id).status,
      'completed',
    );
    const rotated = (
      await own('rotate_owner_credential', {
        agent_id: aid,
        credential_id: dashboard.connections[0].id,
      })
    ).result;
    await assert.rejects(
      () => a.get_profile(),
      (e) => e.status === 401,
    );
    a.token = rotated.token;
    assert.equal((await a.get_profile()).profile.agent_id, aid);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
