import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  collaborationSchemas,
  collaborationRequest,
  registerCollaboration,
} from './collaboration.mjs';
import { Elsewhere } from './sdk.mjs';
import { CollaborationHost, hostCapabilities } from './collaboration-host.mjs';
const mutation = { expected_version: 1, idempotency_key: 'key' },
  project_id = 'project',
  task_id = 'task';
const requests = {
  project: { action: 'get', project_id },
  membership: { action: 'accept', project_id, ...mutation },
  tasks: { action: 'heartbeat', project_id, task_id, epoch: 2, ...mutation },
  context: { project_id },
  updates: { action: 'read', project_id, cursor: 0 },
  submit: {
    project_id,
    task_id,
    epoch: 2,
    ...mutation,
    artifact: {
      kind: 'text',
      text: 'real result',
      provenance: 'source',
      verification: 'fixture',
    },
  },
  review: {
    action: 'accept',
    project_id,
    task_id,
    artifact_version: 1,
    ...mutation,
  },
};
void test('strict action schemas and SDK preserve exact group payloads', async () => {
  const sdk = new Elsewhere({
    binary: resolve('fixture-cli'),
    home: resolve('fixture-home'),
    endpoint: 'https://fixture.invalid',
  });
  const calls = [];
  sdk.command = async (args, opts) => {
    calls.push({ args, ...opts });
    return { ok: true };
  };
  for (const [group, req] of Object.entries(requests)) {
    await sdk[`collaboration_${group}`](req);
    assert.deepEqual(calls.at(-1), {
      args: ['collaboration', group, '--stdin'],
      input: req,
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const extra of [
      { owner_approved: true },
      { grant_basis: 'human_consent' },
      { action: 'unknown' },
    ])
      assert.throws(() => collaborationRequest(group, { ...req, ...extra }));
  }
  assert.throws(() => collaborationRequest('../project', {}));
  assert.throws(() =>
    collaborationRequest('tasks', { action: 'list', project_id, epoch: 1 }),
  );
  assert.throws(() =>
    collaborationRequest('project', {
      action: 'create',
      goal: '中'.repeat(2667),
      expected_version: 0,
      idempotency_key: 'x',
    }),
  );
  assert.throws(() =>
    collaborationRequest('submit', {
      ...requests.submit,
      artifact: { ...requests.submit.artifact, uri: 'https://example.test' },
    }),
  );
  assert.throws(() =>
    collaborationRequest('submit', {
      ...requests.submit,
      artifact: {
        kind: 'https',
        uri: 'https://u:p@example.test',
        provenance: '',
        verification: '',
      },
    }),
  );
  assert.throws(() =>
    collaborationRequest('review', { ...requests.review, action: 'reject' }),
  );
  assert.throws(() =>
    collaborationRequest('project', { action: 'list', cursor: -1 }),
  );
});
void test('actual MCP initialize, list, seven calls, strict invalid calls and helpers', async () => {
  const calls = [];
  const adapter = Object.fromEntries(
    Object.keys(collaborationSchemas).map((group) => [
      `collaboration_${group}`,
      async (req) => {
        calls.push({ group, req });
        return { fixture: true, group };
      },
    ]),
  );
  const server = new McpServer({ name: 'fixture', version: '1' });
  await registerCollaboration(server, adapter);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 9);
    for (const group of [
      'project',
      'membership',
      'tasks',
      'updates',
      'review',
      'checkpoint',
    ]) {
      const schema = tools.find(
        (tool) => tool.name === 'network_collaboration_' + group,
      ).inputSchema;
      assert.equal(schema.type, 'object');
      assert.ok(schema.properties.action, group + ' action schema missing');
      assert.ok(
        schema.properties.project_id,
        group + ' project schema missing',
      );
      assert.equal(schema.additionalProperties, false);
    }
    for (const [group, req] of Object.entries(requests)) {
      const result = await client.callTool({
        name: `network_collaboration_${group}`,
        arguments: req,
      });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.deepEqual(calls.at(-1), { group, req });
    }
    const count = calls.length;
    for (const args of [
      { ...requests.project, owner_approved: true },
      { ...requests.project, action: 'invalid' },
      { ...requests.project, task_id: 'irrelevant' },
    ]) {
      const result = await client.callTool({
        name: 'network_collaboration_project',
        arguments: args,
      });
      assert.equal(result.isError, true);
      assert.equal(calls.length, count);
    }
    const caps = JSON.parse(
      (
        await client.callTool({
          name: 'network_collaboration_capabilities',
          arguments: {},
        })
      ).content[0].text,
    );
    assert.deepEqual(caps, hostCapabilities);
  } finally {
    await client.close();
    await server.close();
  }
});
void test('checkpoint poll redelivery, explicit contiguous ack, restart, failed read and binding', async () => {
  const home = await mkdtemp(join(tmpdir(), 'collab-'));
  let failure = false;
  const delivered = [{ sequence: 1 }, { sequence: 2 }];
  const options = {
    home,
    endpoint: 'https://fixture.invalid',
    identity: 'agent',
    project: 'p',
    readUpdates: async ({ cursor }) => {
      if (failure) throw new Error('revoked');
      return {
        events: delivered.filter((e) => e.sequence > cursor),
        next_cursor: 2,
      };
    },
  };
  const host = new CollaborationHost(options);
  assert.equal(await host.cursor(), 0);
  await assert.rejects(host.acknowledge(1));
  await host.poll();
  await host.poll();
  assert.equal(await host.cursor(), 0);
  await host.acknowledge(1);
  assert.equal(await host.cursor(), 1);
  const restarted = new CollaborationHost(options);
  assert.deepEqual((await restarted.poll()).events, [{ sequence: 2 }]);
  await restarted.acknowledge(2);
  failure = true;
  await assert.rejects(restarted.poll(), /revoked/);
  assert.equal(await restarted.cursor(), 2);
  await assert.rejects(restarted.acknowledge(3));
  for (const key of ['project', 'identity', 'endpoint']) {
    const other = new CollaborationHost({
      ...options,
      [key]: key === 'endpoint' ? 'https://other.invalid' : 'other',
    });
    assert.equal(await other.cursor(), 0);
    assert.notEqual(other.file, host.file);
  }
  const gap = new CollaborationHost({
    ...options,
    project: 'gap',
    readUpdates: async () => ({ events: [{ sequence: 2 }] }),
  });
  await gap.poll();
  await assert.rejects(gap.acknowledge(2), /undelivered/);
  for (const method of ['externalWake', 'resume', 'inject', 'background'])
    assert.throws(() => host[method](), /UNSUPPORTED/);
  assert.equal(hostCapabilities.adapters.codex.verified, false);
  assert.equal(hostCapabilities.adapters.claude_code.verified, false);
});
void test('MCP checkpoint uses existing identity and does not consume on read', async () => {
  const home = await mkdtemp(join(tmpdir(), 'collab-mcp-'));
  await mkdir(join(home, 'servers', 'agentnet'), { recursive: true });
  await writeFile(
    join(home, 'servers', 'agentnet', 'agent-v2-credentials.json'),
    JSON.stringify({ agent_id: 'existing' }),
  );
  const adapter = {
    ready: true,
    cliHome: home,
    endpoint: 'https://fixture.invalid',
    collaboration_updates: async () => ({
      events: [{ sequence: 1 }],
      next_cursor: 1,
    }),
  };
  const server = new McpServer({ name: 'fixture', version: '1' });
  await registerCollaboration(server, adapter);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  try {
    const call = async (args) =>
      client.callTool({
        name: 'network_collaboration_checkpoint',
        arguments: { project_id: 'p', ...args },
      });
    assert.equal(
      (await call({ action: 'acknowledge', sequence: 1 })).isError,
      true,
    );
    assert.equal((await call({ action: 'poll' })).isError, undefined);
    assert.equal(
      (await call({ action: 'acknowledge', sequence: 1 })).isError,
      undefined,
    );
    await writeFile(
      join(home, 'servers', 'agentnet', 'agent-v2-credentials.json'),
      JSON.stringify({ agent_id: 'replacement' }),
    );
    assert.equal(
      (await call({ action: 'acknowledge', sequence: 1 })).isError,
      true,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
void test('distribution contains exact skill list and equal CLI versions', async () => {
  const names = [
    'agentnet-onboarding',
    'agentnet-social',
    'agentnet-handoff',
    'agentnet-collaboration',
  ];
  const ps = await readFile('elsewhere/web/public/install.ps1', 'utf8'),
    sh = await readFile('elsewhere/web/public/install.sh', 'utf8'),
    docker = await readFile('elsewhere/Dockerfile.web', 'utf8'),
    ignore = await readFile('elsewhere/Dockerfile.web.dockerignore', 'utf8'),
    deploy = await readFile('elsewhere/scripts/package-deploy.mjs', 'utf8');
  assert.deepEqual(
    ps
      .match(/foreach \(\$Name in @\(([^)]+)\)/)[1]
      .split(',')
      .map((s) => s.trim().replaceAll("'", '')),
    names,
  );
  assert.deepEqual(sh.match(/for name in ([^;]+);/)[1].split(' '), names);
  for (const name of names) {
    assert.ok(ps.includes(`${name}/SKILL.md`));
    assert.ok(sh.includes(`${name}/SKILL.md`));
    assert.ok(docker.includes(`COPY elsewhere/skills/${name} `));
    assert.ok(ignore.includes(`!elsewhere/skills/${name}/`));
    assert.ok(deploy.includes(`'elsewhere/skills/${name}'`));
  }
  const release = JSON.parse(
    await readFile('elsewhere/web/public/release.json'),
  );
  assert.equal(release.migration, 157);
  for (const source of [
    ps,
    sh,
    docker,
    await readFile('elsewhere/Dockerfile.host', 'utf8'),
    await readFile('elsewhere/Dockerfile.core', 'utf8'),
  ]) {
    assert.ok(source.includes(release.cli_version));
    assert.ok(!source.includes('agentnet.26'));
  }
});
if (process.env.COLLABORATION_PACKAGE_STAGE)
  void test('standalone installed artifact starts stdio without repository cwd', async () => {
    const stage = resolve(process.env.COLLABORATION_PACKAGE_STAGE),
      cwd = await mkdtemp(join(tmpdir(), 'collab-standalone-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(stage, 'elsewhere/client/collaboration-mcp.mjs')],
      cwd,
      env: {
        ...process.env,
        AGENTNET_CLI: resolve('fake-cli'),
        AGENTNET_HOME: cwd,
        AGENTNET_URL: 'https://fixture.invalid',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'standalone', version: '1' });
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 9);
      const result = await client.callTool({
        name: 'network_collaboration_capabilities',
        arguments: {},
      });
      assert.equal(
        JSON.parse(result.content[0].text).execution_mode,
        'host_session_only',
      );
      const invalid = await client.callTool({
        name: 'network_collaboration_project',
        arguments: { ...requests.project, owner_approved: true },
      });
      assert.equal(invalid.isError, true);
    } finally {
      await client.close();
    }
  });

void test('real child stdout above 2 MiB succeeds only for collaboration-specific transport', async (t) => {
  const sdk = new Elsewhere({
    binary: process.execPath,
    home: resolve('fixture-home'),
    endpoint: 'https://fixture.invalid',
  });
  sdk.ready = true;
  const original = childProcess.execFile;
  const source = `const tasks=Object.fromEntries(Array.from({length:10},(_,i)=>['task'+i,{task_id:'task'+i,title:'task',input:'<'.repeat(1500)+'a'.repeat(10500),output:'',assignee:'1',reviewer:'1',dependencies:[],state:'ready',epoch:0,lease_until:0,artifact_version:0}]));process.stdout.write(JSON.stringify({projects:Array.from({length:20},(_,i)=>({project_id:'p'+i,goal:'goal',requirements:'',state:'active',version:1,sequence:1,creator:'1',members:{},tasks})),next_cursor:20,has_more:true}));`;
  const caps = [];
  t.mock.method(
    childProcess,
    'execFile',
    (_binary, _args, options, callback) => {
      caps.push(options.maxBuffer);
      return original(process.execPath, ['-e', source], options, callback);
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(sdk.command(['fixture']), /transport limit/);
    const result = await sdk.collaboration_project({ action: 'list' });
    assert.equal(result.projects.length, 20);
    assert.equal(
      result.projects[19].tasks.task9.input,
      '<'.repeat(1500) + 'a'.repeat(10500),
    );
    assert.ok(Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024);
    assert.deepEqual(caps, [2 * 1024 * 1024, 16 * 1024 * 1024]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test('collaboration rejects NUL consistently before PostgreSQL JSONB storage', () => {
 for (const request of [
  {action:'create',goal:'bad\u0000goal',expected_version:0,idempotency_key:'nul'},
  {action:'invite',project_id:'p',agent_id:'peer\u0000',role:'worker',scopes:['read'],expected_version:1,idempotency_key:'nul'},
 ]) assert.equal(collaborationSchemas.project.safeParse(request).success,false);
 assert.equal(collaborationSchemas.submit.safeParse({project_id:'p',task_id:'t',epoch:1,expected_version:1,idempotency_key:'nul',artifact:{kind:'text',text:'bad\u0000artifact',provenance:'',verification:''}}).success,false);
 assert.equal(collaborationSchemas.submit.safeParse({project_id:'p',task_id:'t',epoch:1,expected_version:1,idempotency_key:'control',artifact:{kind:'text',text:'valid\u0001control',provenance:'',verification:''}}).success,true);
});
