import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const exec = promisify(execFile);

await test('real users → two independent CLI clients → HTTP and MCP → durable delivery, isolation, lifecycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentnet-live-'));
  const port = 14000 + Math.floor(Math.random() * 1000),
    base = `http://127.0.0.1:${port}`;
  let child,
    logs = '';
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
          AGENTNET_DATA_DIR: join(directory, 'server'),
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stderr.on('data', (x) => (logs += x));
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(base + '/healthz')).ok) return;
      } catch {}
      if (child.exitCode !== null) throw Error(logs);
      await delay(100);
    }
    throw Error('start timeout ' + logs);
  }
  async function stop() {
    if (child?.exitCode === null)
      await new Promise((r) => {
        child.once('exit', r);
        child.kill();
      });
  }
  async function request(path, payload, headers = {}, status = 200) {
    const res = await fetch(base + path, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const value = await res.json();
    assert.equal(res.status, status, JSON.stringify(value));
    return { value, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  async function user(username) {
    const result = await request('/api/auth/register', {
      username,
      password: 'testing-password-2026',
      name: username,
    });
    return {
      ...result.value,
      headers: { cookie: result.cookie, 'X-AgentNet-CSRF': result.value.csrf },
    };
  }
  const act = (u, action, payload, status = 200) =>
    request('/api/network', { action, payload }, u.headers, status);
  const tool = (c, name, args = {}, status = 200) =>
    request(
      '/api/tools/network_' + name,
      args,
      { Authorization: 'Bearer ' + c.token },
      status,
    );
  async function client(u, label) {
    const pair = (await act(u, 'pair', { label, dailyLimit: 3 })).value.result;
    const home = join(directory, label);
    const run = await exec(
      process.execPath,
      [
        'network/agentnet.mjs',
        'connect',
        '--server',
        base,
        '--code',
        pair.pairCode,
        '--home',
        home,
      ],
      { windowsHide: true },
    );
    assert.ok(JSON.parse(run.stdout).online);
    const c = JSON.parse(await readFile(join(home, 'connection.json'), 'utf8'));
    await request(
      '/api/agent/connect',
      { code: pair.pairCode, clientId: 'replay' },
      {},
      409,
    );
    return { ...c, home };
  }
  let mcp, stdio;
  try {
    await start();
    assert.equal((await request('/api/network')).value.agents.length, 0);
    const autoHome = join(directory, 'autonomous-client');
    const cli = async (command, ...args) =>
      JSON.parse(
        (
          await exec(
            process.execPath,
            ['network/agentnet.mjs', command, ...args, '--home', autoHome],
            { windowsHide: true },
          )
        ).stdout,
      );
    const onboarding = await cli(
      'join',
      '--server',
      base,
      '--name',
      'One sentence agent',
    );
    assert.equal(onboarding.pending, true);
    assert.ok(!('token' in onboarding));
    const pending = JSON.parse(
      await readFile(join(autoHome, 'connection.json'), 'utf8'),
    );
    const claimCode = new URLSearchParams(
      new URL(onboarding.claimUrl).hash.slice(1),
    ).get('claim');
    assert.equal(
      (await request('/api/network')).value.agents.length,
      0,
      'anonymous bootstrap is not a public identity',
    );
    assert.equal(
      (await cli('join', '--server', base)).claimUrl,
      onboarding.claimUrl,
      'repeated join reuses pending Home',
    );
    assert.equal(
      (await request('/api/agent/claim-info', { code: claimCode })).value.label,
      'One sentence agent',
    );
    await tool(pending, 'inbox', {}, 401);
    assert.equal((await cli('status')).pending, true);
    assert.equal(
      (await request('/.well-known/agentnet.json')).value.humanClaimRequired,
      true,
    );
    const entryHtml = await (await fetch(base)).text();
    assert.ok(entryHtml.includes('href="/join.md"'));
    assert.ok(
      (await (await fetch(base + '/join.md')).text()).includes(
        `join --server ${base}`,
      ),
    );
    const a = await user('test-alice'),
      b = await user('test-bob'),
      eve = await user('test-eve');
    await request(
      '/api/network',
      { action: 'claim', payload: { code: claimCode } },
      { cookie: a.headers.cookie },
      403,
    );
    const claimed = (await act(a, 'claim', { code: claimCode, dailyLimit: 2 }))
      .value.result.connection;
    assert.equal(claimed.online, false);
    await act(b, 'claim', { code: claimCode }, 409);
    assert.equal(
      (await act(a, 'claim', { code: claimCode, dailyLimit: 2 })).value.result
        .connection.id,
      claimed.id,
    );
    const ready = await cli('wait', '--seconds', '5');
    assert.equal(ready.profile.id, a.profile.id);
    const finalHome = JSON.parse(
      await readFile(join(autoHome, 'connection.json'), 'utf8'),
    );
    assert.equal(finalHome.pending, false);
    assert.ok(!finalHome.claimUrl);
    assert.equal((await cli('join', '--server', base)).reused, true);
    assert.equal(
      (await request('/api/network', undefined, a.headers)).value.connections
        .length,
      1,
    );
    await request(
      '/api/network',
      { action: 'profile', payload: { name: 'forged', bio: 'x' } },
      { cookie: a.headers.cookie },
      403,
    );
    await request(
      '/api/network',
      undefined,
      { Origin: 'https://evil.invalid' },
      403,
    );
    const ac = await client(a, 'alice-client'),
      bc = await client(b, 'bob-client');
    assert.equal(
      (await request('/api/network', undefined, a.headers)).value.connections[0]
        .online,
      true,
    );
    await request(
      '/api/network',
      { action: 'pair', payload: { label: 'forged' } },
      { Authorization: 'Bearer ' + ac.token },
      403,
    );
    const source = {
      title: '寻找真实协作伙伴',
      body: '中文、多字节、真实投递。',
      topic: 'AI 与研究',
      type: '需求',
      requestId: 'publish-1',
    };
    const results = await Promise.all([
      tool(ac, 'publish', source),
      tool(ac, 'publish', source),
    ]);
    assert.equal(results[0].value.signalId, results[1].value.signalId);
    await tool(ac, 'publish', { ...source, title: 'conflict' }, 409);
    assert.equal(
      (await tool(bc, 'inbox')).value.entries[0].broadcast.body,
      source.body,
    );
    assert.equal(
      (await tool(bc, 'conversations')).value.conversations.length,
      0,
      'no fake responses',
    );
    await tool(ac, 'message', {
      agentId: b.profile.id,
      text: '你好，确认收到吗？',
      requestId: 'message-1',
      signalId: results[0].value.signalId,
    });
    const inbox = (await tool(bc, 'inbox')).value;
    assert.equal(inbox.entries.length, 2);
    assert.equal(inbox.entries[1].peerId, a.profile.id);
    await tool(bc, 'message', {
      agentId: a.profile.id,
      text: '已收到，这是另一个客户端的真实回复。',
      requestId: 'reply-1',
    });
    const conversations = (await tool(ac, 'conversations')).value.conversations;
    assert.equal(conversations[0].messages.length, 2);
    assert.equal(
      (await request('/api/network', undefined, eve.headers)).value
        .conversations.length,
      0,
    );
    assert.equal((await request('/api/network')).value.conversations.length, 0);
    await act(eve, 'read', { id: conversations[0].id }, 404);
    await tool(bc, 'ack', { cursor: inbox.nextCursor });
    assert.equal((await tool(bc, 'inbox')).value.entries.length, 0);
    await tool(ac, 'subscribe', { text: '设计协作', topics: ['设计与创作'] });
    await tool(ac, 'save', { id: results[0].value.signalId });
    mcp = new Client({ name: 'integration-http', version: '1.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + ac.token } },
      }),
    );
    assert.equal((await mcp.listTools()).tools.length, 13);
    const result = await mcp.callTool({
      name: 'network_status',
      arguments: {},
    });
    assert.equal(result.structuredContent.profile.id, a.profile.id);
    stdio = new Client({ name: 'integration-stdio', version: '1.0.0' });
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('network/agentnet.mjs'), 'mcp', '--home', bc.home],
        stderr: 'pipe',
      }),
    );
    assert.equal((await stdio.listTools()).tools.length, 13);
    assert.equal(
      (await stdio.callTool({ name: 'network_status', arguments: {} }))
        .structuredContent.profile.id,
      b.profile.id,
    );
    await act(a, 'pause', { id: ac.connectionId });
    await tool(ac, 'inbox', {}, 403);
    assert.equal(
      (await mcp.callTool({ name: 'network_inbox', arguments: {} })).isError,
      true,
    );
    await act(a, 'resume', { id: ac.connectionId });
    await tool(ac, 'message', {
      agentId: b.profile.id,
      text: '额度第三次',
      requestId: 'message-2',
    });
    await tool(
      ac,
      'message',
      { agentId: b.profile.id, text: '第四次超额', requestId: 'message-3' },
      429,
    );
    await stdio.close();
    stdio = null;
    await mcp.close();
    mcp = null;
    await stop();
    await start();
    assert.equal(
      (await tool(ac, 'conversations')).value.conversations[0].messages.length,
      3,
    );
    assert.equal((await tool(ac, 'status')).value.connection.usage.actions, 3);
    assert.equal(
      (await request('/api/network', undefined, a.headers)).value.saved.length,
      1,
    );
    assert.equal(
      (await tool(bc, 'inbox')).value.acknowledgedCursor,
      inbox.nextCursor,
    );
    await request('/api/auth/logout', {}, eve.headers);
    await request(
      '/api/network',
      { action: 'pair', payload: { label: 'logged out' } },
      eve.headers,
      401,
    );
    const restored = await request('/api/auth/recover', {
      username: 'test-alice',
      password: 'new-testing-password-2026',
      recoveryCode: a.recoveryCode,
    });
    assert.equal(restored.value.profile.id, a.profile.id);
    assert.equal(restored.value.conversations.length, 1);
    await tool(ac, 'status', {}, 401);
    await act(b, 'revoke', { id: bc.connectionId });
    await tool(bc, 'status', {}, 401);
    const pub = (await request('/api/network')).value;
    assert.ok(pub.agents.every((x) => !('ownerId' in x) && !('lease' in x)));
    assert.ok(!JSON.stringify(pub).includes(ac.token));
    assert.equal((await fetch(base + '/join.md')).status, 200);
    assert.equal((await request('/api/openapi.json')).value.openapi, '3.1.0');
  } finally {
    await stdio?.close();
    await mcp?.close();
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
