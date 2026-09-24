import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AgentNetwork } from './sdk.mjs';
import { emptyHub, accountAction } from './hub.mjs';
import { loadMigrated, migrateState } from './migrations.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const exec = promisify(execFile);
await test('v2 migration preserves ownership, IDs, credentials and source backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentnet-migration-'));
  try {
    const s = emptyHub();
    await accountAction(s, 'register', {
      username: 'migration',
      password: 'testing-password',
      name: 'Existing Agent',
    });
    s.version = 2;
    s.users[0].agentId = s.users[0].defaultAgentId;
    delete s.users[0].defaultAgentId;
    delete s.relations;
    delete s.invocations;
    delete s.activityLogs;
    const file = join(dir, 'network.json'),
      raw = JSON.stringify(s);
    await writeFile(file, raw);
    const next = await loadMigrated(file);
    assert.equal(next.version, 3);
    assert.equal(next.users[0].defaultAgentId, s.users[0].agentId);
    assert.equal(next.agents[0].id, s.agents[0].id);
    assert.equal(await readFile(file + '.v2.backup', 'utf8'), raw);
    assert.deepEqual(await loadMigrated(file), next);
    assert.deepEqual(migrateState(next), next);
    assert.throws(() => migrateState({ version: 99 }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
await test('public SDK + MCP + CLI: multi-agent owner, identity, messages, relations, delegation, scopes and rotation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentnet-v3-')),
    port = 18000 + Math.floor(Math.random() * 1000),
    base = `http://127.0.0.1:${port}`;
  let child,
    mcp,
    anonymous,
    stderr = '';
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
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stderr.on('data', (d) => (stderr += d));
    for (let n = 0; n < 70; n++) {
      try {
        if ((await fetch(base + '/healthz')).ok) return;
      } catch {}
      await delay(80);
    }
    throw Error(stderr);
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
    const b = await r.json();
    assert.equal(r.status, status, JSON.stringify(b));
    return { body: b, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const rid = () => randomUUID();
  try {
    await start();
    const owner = await request('/api/auth/register', {
      username: 'v3-owner',
      password: 'testing-password-123',
    });
    assert.equal(owner.body.ownedAgents.length, 0);
    assert.equal(owner.body.profile.id, 'guest');
    const oh = { cookie: owner.cookie, 'X-AgentNet-CSRF': owner.body.csrf };
    const manage = async (action, payload = {}) =>
      (await request('/api/v1/owner', { action, payload }, oh)).body;
    const a = new AgentNetwork({ baseUrl: base });
    const ar = await a.register_agent({ display_name: 'Planner' });
    assert.ok(ar.claim_url);
    assert.equal((await a.connect()).pending, true);
    await assert.rejects(
      () => a.get_profile(),
      (e) => e.status === 401,
    );
    const aa = (await manage('create_agent', { display_name: 'Planner' }))
      .result.agent.agent_id;
    await manage('claim', {
      agent_id: aa,
      code: new URLSearchParams(new URL(ar.claim_url).hash.slice(1)).get(
        'claim',
      ),
    });
    assert.equal((await a.connect()).profile.agent_id, aa);
    // A second environment starts with MCP only, before it has any credential.
    anonymous = new Client({ name: 'new-third-party', version: '1' });
    await anonymous.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp')),
    );
    const boot = await anonymous.callTool({
      name: 'network_register_agent',
      arguments: { client_id: rid(), display_name: 'Worker' },
    });
    assert.ok(!boot.isError);
    const br = boot.structuredContent;
    const bb = (await manage('create_agent', { display_name: 'Worker' })).result
      .agent.agent_id;
    assert.notEqual(aa, bb);
    await manage('claim', {
      agent_id: bb,
      code: new URLSearchParams(new URL(br.claim_url).hash.slice(1)).get(
        'claim',
      ),
    });
    const b = new AgentNetwork({ baseUrl: base, token: br.token });
    await b.connect();
    mcp = new Client({ name: 'third-party-worker', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + br.token } },
      }),
    );
    const mc = async (name, p = {}) => {
      const r = await mcp.callTool({ name: 'network_' + name, arguments: p });
      assert.ok(!r.isError, JSON.stringify(r));
      return r.structuredContent;
    };
    await a.update_profile({
      display_name: 'Planner',
      description: 'Plans tasks',
      capabilities: ['planning'],
      needs: ['uppercase'],
      tags: ['text'],
    });
    await mc('update_profile', {
      display_name: 'Worker',
      description: 'Transforms text',
      capabilities: ['uppercase'],
      tags: ['text'],
      current_task: 'text service',
    });
    assert.equal(
      (await a.discover_agents({ capability: 'uppercase' })).items[0].agent_id,
      bb,
    );
    const post = await a.publish({
      title: 'Task resource',
      body: 'Need uppercase text',
      type: 'task',
      tags: ['text'],
      request_id: rid(),
    });
    assert.ok(
      (await mc('get_feed')).items.some((x) => x.post_id === post.post_id),
    );
    const msg = await a.send_message({
      target_agent_id: bb,
      text: 'Hello offline worker',
      request_id: rid(),
    });
    assert.equal(
      (await mc('get_messages', { unread_only: true })).items[0].text,
      'Hello offline worker',
    );
    await mc('acknowledge_messages', { conversation_id: msg.conversation_id });
    assert.equal((await a.get_messages()).items[0].status, 'read');
    await mc('send_message', {
      target_agent_id: aa,
      text: 'Ready',
      request_id: rid(),
    });
    assert.equal((await a.get_messages()).items.length, 2);
    const relation = await a.create_relation({
      target_agent_id: bb,
      type: 'provider',
      request_id: rid(),
    });
    assert.equal((await mc('get_relations')).items[0].id, relation.relation.id);
    assert.equal(
      (await a.discover_agents({ relation_type: 'provider' })).items[0]
        .agent_id,
      bb,
    );
    const invokeInput = {
      target_agent_id: bb,
      task: 'Uppercase text',
      context: { text: 'hello network' },
      permissions: ['read_context'],
      request_id: rid(),
    };
    const inv = (await a.invoke_agent(invokeInput)).invocation;
    assert.equal((await a.invoke_agent(invokeInput)).invocation.id, inv.id);
    await assert.rejects(
      () =>
        a.respond_invocation({
          invocation_id: inv.id,
          action: 'accept',
          request_id: rid(),
        }),
      (e) => e.code === 'FORBIDDEN',
    );
    await assert.rejects(
      () =>
        b.respond_invocation({
          invocation_id: inv.id,
          action: 'accept',
          permissions: ['filesystem'],
          request_id: rid(),
        }),
      (e) => e.code === 'PERMISSION_ESCALATION',
    );
    await mc('respond_invocation', {
      invocation_id: inv.id,
      action: 'accept',
      permissions: ['read_context'],
      request_id: rid(),
    });
    await mc('respond_invocation', {
      invocation_id: inv.id,
      action: 'start',
      request_id: rid(),
    });
    // Real worker logic executes in this independent client, never in the server.
    const task = (await mc('get_invocations', { invocation_id: inv.id }))
      .items[0];
    const output = task.context.text.toUpperCase();
    await mc('respond_invocation', {
      invocation_id: inv.id,
      action: 'complete',
      result: { text: output },
      request_id: rid(),
    });
    assert.equal(
      (await a.get_invocations({ invocation_id: inv.id })).items[0].result.text,
      'HELLO NETWORK',
    );
    const cancelled = (
      await a.invoke_agent({ ...invokeInput, request_id: rid() })
    ).invocation;
    await a.respond_invocation({
      invocation_id: cancelled.id,
      action: 'cancel',
      request_id: rid(),
    });
    await assert.rejects(
      () =>
        b.respond_invocation({
          invocation_id: cancelled.id,
          action: 'accept',
          request_id: rid(),
        }),
      (e) => e.code === 'INVALID_TRANSITION',
    );
    const rejected = (
      await a.invoke_agent({ ...invokeInput, request_id: rid() })
    ).invocation;
    await b.respond_invocation({
      invocation_id: rejected.id,
      action: 'reject',
      reason: 'busy',
      request_id: rid(),
    });
    const timed = (
      await a.invoke_agent({
        ...invokeInput,
        timeout_seconds: 1,
        request_id: rid(),
      })
    ).invocation;
    await delay(1200);
    assert.equal(
      (await a.get_invocations({ invocation_id: timed.id })).items[0].status,
      'timed_out',
    );
    await request('/api/v1/network/publish', { title: 'spoof' }, oh, 400);
    await request('/api/v1/network/get_profile', {}, oh, 403);
    await request(
      '/api/v1/owner',
      { action: 'publish', payload: { agent_id: aa } },
      oh,
      403,
    );
    const outsider = await request('/api/auth/register', {
      username: 'outsider',
      password: 'testing-password-123',
    });
    await request(
      '/api/v1/owner',
      { action: 'select_agent', payload: { agent_id: aa } },
      { cookie: outsider.cookie, 'X-AgentNet-CSRF': outsider.body.csrf },
      403,
    );
    const bc = (await b.get_connection()).credential_id;
    const outsiderHeaders = {
      cookie: outsider.cookie,
      'X-AgentNet-CSRF': outsider.body.csrf,
    };
    const outsideAgent = (
      await request(
        '/api/v1/owner',
        { action: 'create_agent', payload: { display_name: 'Outsider' } },
        outsiderHeaders,
      )
    ).body.result.agent.agent_id;
    const outsideCredential = (
      await request(
        '/api/v1/owner',
        {
          action: 'issue-token',
          payload: {
            agent_id: outsideAgent,
            label: 'Isolated test',
            dailyLimit: 60,
          },
        },
        outsiderHeaders,
      )
    ).body.result.token;
    const outsideSdk = new AgentNetwork({
      baseUrl: base,
      token: outsideCredential,
    });
    await assert.rejects(
      () => outsideSdk.get_invocations({ invocation_id: inv.id }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      () => outsideSdk.get_messages({ conversation_id: msg.conversation_id }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      () =>
        outsideSdk.respond_invocation({
          invocation_id: inv.id,
          action: 'cancel',
          request_id: rid(),
        }),
      (e) => e.status === 404,
    );
    await manage('set_permissions', {
      agent_id: bb,
      credential_id: bc,
      scopes: ['messages:read'],
    });
    const narrowInbox = (
      await request(
        '/api/tools/network_inbox',
        {},
        { Authorization: 'Bearer ' + b.token },
      )
    ).body;
    assert.ok(
      narrowInbox.entries.every(
        (e) => e.kind !== 'invocation' && e.kind !== 'broadcast',
      ),
    );
    await manage('set_permissions', {
      agent_id: bb,
      credential_id: bc,
      scopes: ['profile:read'],
    });
    await assert.rejects(
      () => b.get_invocations(),
      (e) => e.code === 'SCOPE_REQUIRED',
    );
    await request(
      '/api/tools/network_inbox',
      {},
      { Authorization: 'Bearer ' + b.token },
      403,
    );
    await request(
      '/api/v1/owner',
      undefined,
      { Authorization: 'Bearer ' + b.token },
      403,
    );
    await manage('set_permissions', {
      agent_id: bb,
      credential_id: bc,
      scopes: ['*'],
    });
    await request(
      '/api/v1/owner',
      { action: 'update_profile', payload: { agent_id: aa, capabilities: 42 } },
      oh,
      400,
    );
    const another = new AgentNetwork({ baseUrl: base });
    const pendingAgain = await another.register_agent({
      display_name: 'Planner on another device',
    });
    await manage('claim', {
      agent_id: aa,
      code: new URLSearchParams(
        new URL(pendingAgain.claim_url).hash.slice(1),
      ).get('claim'),
    });
    assert.equal((await another.connect()).profile.agent_id, aa);
    assert.notEqual(another.token, a.token);
    const failed = (await a.invoke_agent({ ...invokeInput, request_id: rid() }))
      .invocation;
    await b.respond_invocation({
      invocation_id: failed.id,
      action: 'accept',
      request_id: rid(),
    });
    await b.respond_invocation({
      invocation_id: failed.id,
      action: 'start',
      request_id: rid(),
    });
    await b.respond_invocation({
      invocation_id: failed.id,
      action: 'fail',
      reason: 'worker error',
      request_id: rid(),
    });
    assert.equal(
      (await a.get_invocations({ invocation_id: failed.id })).items[0].status,
      'failed',
    );
    const old = a.token;
    await a.rotate_credential();
    await assert.rejects(
      () => new AgentNetwork({ baseUrl: base, token: old }).get_profile(),
      (e) => e.status === 401,
    );
    assert.equal((await a.get_profile()).profile.agent_id, aa);
    const home = join(dir, 'cli');
    await mkdir(home);
    await writeFile(
      join(home, 'connection.json'),
      JSON.stringify({ server: base, token: a.token, agentId: aa }),
    );
    const cli = JSON.parse(
      (
        await exec(
          process.execPath,
          [resolve('network/agentnet.mjs'), 'relation', 'list', '--home', home],
          { windowsHide: true },
        )
      ).stdout,
    );
    assert.equal(cli.items[0].id, relation.relation.id);
    assert.ok(
      (await a.get_activity()).items.some(
        (e) => e.operation === 'invoke_agent',
      ),
    );
    await mcp.close();
    mcp = null;
    await anonymous.close();
    anonymous = null;
    await stop();
    await start();
    assert.equal(
      (await a.get_invocations({ invocation_id: inv.id })).items[0].status,
      'completed',
    );
    assert.equal(
      (await request('/api/v1/owner', undefined, oh)).body.ownedAgents.length,
      2,
    );
    const example = JSON.parse(
      (
        await exec(
          process.execPath,
          [resolve('network/examples/two-agents.mjs')],
          {
            windowsHide: true,
            env: {
              ...process.env,
              AGENTNET_URL: base,
              AGENTNET_AGENT_A_TOKEN: a.token,
              AGENTNET_AGENT_B_TOKEN: b.token,
            },
          },
        )
      ).stdout,
    );
    assert.equal(example.status, 'completed');
    assert.equal(example.result.text, 'HELLO NETWORK');
    const before = (await a.get_connection()).credential_id;
    await manage('revoke', { agent_id: aa, id: before });
    await assert.rejects(
      () => a.get_profile(),
      (e) => e.code === 'CONNECTION_REVOKED',
    );
  } finally {
    await mcp?.close();
    await anonymous?.close();
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
