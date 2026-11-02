import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openCodeConfiguration,
  createOpenCodeRpc,
  bindOpenCodeSession,
  assertOpenCodeManagedConfigAbsent,
  openCodeEnvironment,
  executeOpenCodeTurn,
  openCodeBridgeConfiguration,
  waitForOpenCodeMcp,
} from './collaboration-opencode-host.mjs';

const host = {
  model: 'elsewhere-local/qwen3:4b',
  baseURL: 'http://127.0.0.1:11435/v1',
};

void test('optional temperature preserves zero and leaves omitted native defaults intact', () => {
  const body = (value) =>
    openCodeConfiguration(value).providers['elsewhere-local'].models['qwen3:4b']
      .body;
  assert.deepEqual(body(host), { reasoning_effort: 'none' });
  for (const temperature of [0, 0.7, 2])
    assert.deepEqual(body({ ...host, temperature }), {
      reasoning_effort: 'none',
      temperature,
    });
});

void test('existing machine configuration blocks isolation; empty or absent roots are allowed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'opencode-managed-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const managed = join(root, 'opencode');
  await assertOpenCodeManagedConfigAbsent(managed);
  await mkdir(managed);
  await assertOpenCodeManagedConfigAbsent(managed);
  await writeFile(
    join(managed, 'opencode.json'),
    JSON.stringify({
      policies: [{ action: 'provider.use', resource: '*', effect: 'deny' }],
    }),
  );
  await assert.rejects(
    assertOpenCodeManagedConfigAbsent(managed),
    /prevents isolated execution/,
  );
  await assert.rejects(
    assertOpenCodeManagedConfigAbsent(null),
    /cannot be verified/,
  );
});

void test('each run gets fresh configuration roots while exact-session data stays stable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'opencode-isolation-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const first = await openCodeEnvironment(root);
  await writeFile(
    join(first.OPENCODE_CONFIG_DIR, 'opencode.jsonc'),
    '{"model":"forbidden/remote"}',
  );
  await mkdir(join(first.ProgramData, 'opencode'));
  await writeFile(
    join(first.ProgramData, 'opencode', 'opencode.json'),
    '{"permissions":[]}',
  );
  const second = await openCodeEnvironment(root);
  assert.notEqual(first.OPENCODE_CONFIG_DIR, second.OPENCODE_CONFIG_DIR);
  assert.notEqual(first.ProgramData, second.ProgramData);
  assert.notEqual(first.HOME, second.HOME);
  assert.equal(first.XDG_DATA_HOME, second.XDG_DATA_HOME);
  assert.equal(first.XDG_STATE_HOME, second.XDG_STATE_HOME);
});

void test(
  'abort during setup prevents reading the spawn binary or prompting',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'opencode-abort-test-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const abort = new AbortController();
    let binaryReads = 0,
      sessions = 0;
    const policy = {
      host: {
        ...host,
        get runtimeHome() {
          abort.abort();
          return root;
        },
        get binary() {
          binaryReads++;
          return process.execPath;
        },
      },
    };
    await assert.rejects(
      executeOpenCodeTurn({
        policy,
        signal: abort.signal,
        sessionId: 'ses_saved123',
        onSession() {
          sessions++;
        },
      }),
      /OpenCode turn interrupted/,
    );
    assert.equal(binaryReads, 0);
    assert.equal(sessions, 0);
  },
);
function fixture(onUpdate = () => {}) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 0,
    signalCode: null,
  });
  const sent = [];
  child.stdin.on('data', (data) => sent.push(JSON.parse(data.toString())));
  const rpc = createOpenCodeRpc(child, onUpdate);
  const incoming = (message) =>
    child.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  return { child, rpc, sent, incoming };
}

void test('native MCP connection and registry readiness precede model request', async () => {
  const f = fixture();
  let ready = false;
  const pending = waitForOpenCodeMcp(f.child).then(() => {
    ready = true;
  });
  f.child.stderr.write('timestamp=x message="mcp con');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ready, false);
  f.child.stderr.write('nected" server=elsewhere tools=6\n');
  assert.equal(ready, false);
  await pending;
  assert.equal(ready, true);
});

void test('MCP readiness rejects incomplete inventory, cancellation and early exit', async () => {
  const f = fixture();
  const mismatch = waitForOpenCodeMcp(f.child);
  f.child.stderr.write('message="mcp connected" server=elsewhere tools=5\n');
  await assert.rejects(
    mismatch,
    (error) => error.nativeMetadata.category === 'mcp_inventory_mismatch',
  );
  const abort = new AbortController();
  const cancelled = waitForOpenCodeMcp(f.child, abort.signal);
  abort.abort();
  await assert.rejects(
    cancelled,
    (error) => error.nativeMetadata.category === 'interrupted',
  );
  const closed = waitForOpenCodeMcp(f.child);
  f.child.emit('close', 1);
  await assert.rejects(
    closed,
    (error) => error.nativeMetadata.category === 'mcp_start_failed',
  );
});

void test('local endpoint rejects remote hosts, credentials and query overrides', () => {
  for (const baseURL of [
    'https://127.0.0.1:11435/v1',
    'http://example.com:11435/v1',
    'http://user@127.0.0.1:11435/v1',
    'http://127.0.0.1:11435/v1?redirect=x',
  ])
    assert.throws(() => openCodeConfiguration({ ...host, baseURL }));
  assert.throws(() => openCodeConfiguration({ ...host, model: 'openai/paid' }));
});

void test('native policy denies builtins and enables exactly six collaboration groups', () => {
  const config = openCodeConfiguration(host);
  assert.deepEqual(config.permissions[0], {
    action: '*',
    resource: '*',
    effect: 'deny',
  });
  assert.equal(config.permissions.length, 7);
  assert.ok(
    config.permissions
      .slice(1)
      .every((rule) =>
        rule.action.startsWith('elsewhere_network_collaboration_'),
      ),
  );
  assert.deepEqual(Object.keys(config.providers), ['elsewhere-local']);
  assert.deepEqual(config.providers['elsewhere-local'].env, []);
  assert.deepEqual(config.plugins, ['-opencode.tool.skill']);
});

void test('scoped MCP stays on native tool list without enabling CodeMode execute', () => {
  const mcp = openCodeBridgeConfiguration(
    {
      cliBinary: '/bound/cli',
      home: '/bound/home',
      endpoint: 'http://127.0.0.1:1234',
    },
    '/bound/policy.json',
    { id: 'bound-job' },
  );
  assert.deepEqual(Object.keys(mcp.servers), ['elsewhere']);
  assert.equal(mcp.servers.elsewhere.codemode, false);
  assert.equal(
    mcp.servers.elsewhere.environment.ELSEWHERE_COLLABORATION_JOB,
    'bound-job',
  );
  assert.equal(
    mcp.servers.elsewhere.environment.ELSEWHERE_COLLABORATION_POLICY,
    '/bound/policy.json',
  );
  assert.ok(
    !openCodeConfiguration(host).permissions.some(
      (rule) => rule.action === 'execute' && rule.effect === 'allow',
    ),
  );
});

void test('RPC waits for actual response and rejects all permission/client file requests', async () => {
  const f = fixture();
  const pending = f.rpc.request('session/new', {
    cwd: '/bound',
    mcpServers: [],
  });
  f.incoming({ id: 99, method: 'session/request_permission', params: {} });
  assert.equal(f.sent[1].result.outcome.outcome, 'cancelled');
  f.incoming({
    id: 100,
    method: 'fs/read_text_file',
    params: { path: '/private' },
  });
  assert.equal(f.sent[2].error.code, -32601);
  f.incoming({ id: 1, result: { sessionId: 'ses_exact' } });
  assert.equal((await pending).sessionId, 'ses_exact');
});

void test('RPC discards native error contents and fails on early process exit', async () => {
  const f = fixture();
  const request = f.rpc.request('session/prompt', {});
  f.incoming({
    id: 1,
    error: { code: -32000, message: 'SECRET native input', data: 'SECRET' },
  });
  await assert.rejects(request, (error) => {
    assert.equal(error.nativeMetadata.code, -32000);
    assert.ok(!JSON.stringify(error).includes('SECRET'));
    assert.ok(!error.message.includes('SECRET'));
    return true;
  });
  const second = f.rpc.request('session/prompt', {});
  f.child.emit('close', 0);
  await assert.rejects(second, /native turn failed/);
});

void test('wrong-session update fails pending work instead of accepting completion', async () => {
  const f = fixture(({ sessionId }) => {
    if (sessionId !== 'ses_bound') throw new Error('wrong session');
  });
  const pending = f.rpc.request('session/prompt', {});
  f.incoming({
    method: 'session/update',
    params: { sessionId: 'ses_other', update: {} },
  });
  await assert.rejects(
    pending,
    (error) => error.nativeMetadata.category === 'invalid_protocol',
  );
});

void test('new binding waits for durable ACK; failed persistence prevents continuation', async () => {
  const calls = [];
  let acknowledge;
  const ack = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const rpc = {
    async request(method) {
      calls.push(method);
      return { sessionId: 'ses_bound123' };
    },
  };
  let returned = false;
  const bound = bindOpenCodeSession(
    rpc,
    { cwd: '/bound', mcpServers: [] },
    null,
    async (id) => {
      assert.equal(id, 'ses_bound123');
      await ack;
    },
  ).then((id) => {
    returned = true;
    return id;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, false);
  assert.deepEqual(calls, ['session/new']);
  acknowledge();
  assert.equal(await bound, 'ses_bound123');
  await assert.rejects(
    bindOpenCodeSession(rpc, {}, null, async () => {
      throw new Error('persist failed');
    }),
    /persist failed/,
  );
});

void test('resume uses only bound ID and cannot silently fall back to a new session', async () => {
  const calls = [];
  const rpc = {
    async request(method, params) {
      calls.push({ method, params });
      return {};
    },
  };
  const id = await bindOpenCodeSession(
    rpc,
    { cwd: '/bound', mcpServers: [] },
    'ses_saved123',
    () => assert.fail('resume must not replace binding'),
  );
  assert.equal(id, 'ses_saved123');
  assert.deepEqual(
    calls.map((call) => call.method),
    ['session/resume'],
  );
  assert.equal(calls[0].params.sessionId, 'ses_saved123');
  await assert.rejects(
    bindOpenCodeSession(
      {
        request: async () => {
          throw new Error('missing session');
        },
      },
      {},
      'ses_missing123',
      () => {},
    ),
    /missing session/,
  );
});
