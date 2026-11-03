import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { install, currentHost } from './collaboration-install.mjs';
import { detectRuntime, automationHost } from './collaboration-runtime.mjs';
import { projectPolicy } from './collaboration-autopilot.mjs';
import { nextAuthorizedAction } from './collaboration-background-bridge.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'host-install-'));
  const binary = join(root, 'host.exe');
  await writeFile(binary, 'fixture');
  return { root, binary };
}
void test('next action is role scoped, version bound, and cannot submit without this turn lease', () => {
  const project = {
    project_id: 'p',
    version: 8,
    state: 'active',
    members: { worker: { scopes: ['read', 'work'] } },
    tasks: {
      t: { task_id: 't', assignee: 'worker', state: 'assigned', epoch: 0 },
    },
  };
  const policy = {
    identity: 'worker',
    allowedActions: ['tasks.accept', 'tasks.start', 'submit'],
  };
  assert.equal(
    nextAuthorizedAction(project, policy).arguments.action,
    'accept',
  );
  project.tasks.t.state = 'accepted';
  project.version = 9;
  const start = nextAuthorizedAction(project, policy);
  assert.equal(start.arguments.action, 'start');
  assert.equal(start.arguments.expected_version, 9);
  project.tasks.t.state = 'running';
  project.tasks.t.epoch = 1;
  assert.equal(nextAuthorizedAction(project, policy), null);
  assert.equal(
    nextAuthorizedAction(project, policy, {
      leases: [{ task_id: 't', epoch: 1 }],
    }).tool,
    'network_collaboration_submit',
  );
  assert.equal(
    nextAuthorizedAction(project, { ...policy, identity: 'other' }),
    null,
  );
});
void test('ambiguous hosts never default to Codex, and shell shims are not executed', async () => {
  assert.throws(() => currentHost('auto', {}), /identify/);
  assert.throws(
    () => currentHost('auto', { CODEX_THREAD_ID: 'x', CLAUDECODE: '1' }),
    /identify/,
  );
  assert.equal(
    currentHost('claude-code', { CODEX_THREAD_ID: 'x' }),
    'claude_code',
  );
  const f = await fixture();
  await assert.rejects(
    detectRuntime('claude_code', join(f.root, 'claude.cmd')),
    /shell shim/,
  );
  await assert.rejects(
    automationHost(
      { host_kind: 'claude_code', host_binary: f.binary },
      { hostKind: 'codex' },
      f.root,
    ),
    /match/,
  );
  await assert.rejects(
    automationHost({}, { hostKind: 'generic' }, f.root),
    /foreground/,
  );
});
void test('Claude install preserves unrelated MCP and keys without granting background', async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, '.claude.json'),
    JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'keep' } },
    }),
  );
  const result = await install({
    host: 'claude-code',
    root: f.root,
    hostBinary: f.binary,
    env: {},
  });
  const saved = JSON.parse(await readFile(result.configuration, 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.mcpServers.other.command, 'keep');
  assert.equal(
    saved.mcpServers.elsewhere.env.AGENTNET_HOST_KIND,
    'claude_code',
  );
  assert.equal(result.backgroundEnabled, false);
  const runtime = await automationHost(
    { host_binary: f.binary, model: 'sonnet' },
    { hostKind: 'claude_code' },
    f.root,
  );
  assert.equal(runtime.kind, 'claude_code');
  assert.equal(runtime.model, 'sonnet');
  assert.equal(
    projectPolicy(
      { host: runtime, identity: 'a' },
      { project_id: 'p', members: {} },
    ).host.kind,
    'claude_code',
  );
});
void test('OpenCode V2 uses native merge; V1 uses its distinct JSON shape; JSONC preserved', async () => {
  const f = await fixture();
  const calls = [];
  const result = await install({
    host: 'opencode',
    root: f.root,
    hostBinary: f.binary,
    env: {},
    run: (_b, args) => {
      calls.push(args);
      return args[0] === '--version' ? 'opencode v2.2.5' : '';
    },
  });
  assert.equal(result.host, 'opencode');
  assert.ok(calls[1].includes('--global'));
  assert.ok(calls[1].includes('AGENTNET_HOST_KIND=opencode'));
  await install({
    host: 'opencode',
    root: f.root,
    hostBinary: f.binary,
    env: {},
    run: () => '1.2.0',
  });
  const file = join(f.root, '.config/opencode/opencode.json');
  const v1 = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(v1.mcp.elsewhere.command);
  assert.equal(v1.mcp.elsewhere.environment.AGENTNET_HOST_KIND, 'opencode');
  const comments = join(f.root, '.config/opencode/opencode.jsonc');
  await writeFile(comments, '{//preserve\n}');
  await assert.rejects(
    install({
      host: 'opencode',
      root: f.root,
      hostBinary: f.binary,
      env: {},
      run: () => '1.2.0',
    }),
    /JSONC/,
  );
  assert.equal(await readFile(comments, 'utf8'), '{//preserve\n}');
});
void test('foreign endpoint fails before host mutation; generic is an export not an installed claim', async () => {
  const f = await fixture(),
    home = join(f.root, 'identity');
  await mkdir(home);
  await writeFile(
    join(home, 'collaboration-identity.json'),
    JSON.stringify({ endpoint: 'https://other.example' }),
  );
  await assert.rejects(
    install({
      host: 'claude-code',
      root: f.root,
      hostBinary: f.binary,
      home,
      env: {},
    }),
    /another endpoint/,
  );
  const result = await install({ host: 'generic', root: f.root, env: {} });
  assert.equal(result.installed, false);
  assert.equal(result.exported, true);
  const config = JSON.parse(await readFile(result.configuration, 'utf8'));
  assert.equal(config.mcpServers.elsewhere.env.AGENTNET_HOST_KIND, 'generic');
});
void test('runtime resolver supports Mac locations and never picks a different installed host', async () => {
  const f = await fixture();
  const bin = join(f.root, '.local/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'claude'), 'fixture');
  assert.equal(
    await detectRuntime('claude_code', null, {
      home: f.root,
      env: { PATH: '' },
      platform: 'darwin',
    }),
    join(bin, 'claude'),
  );
  const resolved = await detectRuntime('opencode', f.binary);
  assert.equal(resolved, f.binary);
});
