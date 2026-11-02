// Validates native discovery/install/startup and first-use UX without model calls or registration.
import assert from 'node:assert/strict';
import {
  mkdtemp,
  cp,
  mkdir,
  readFile,
  writeFile,
  access,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { codexProtocol } from './codex-plugin-protocol.mjs';
const source = resolve(process.argv[2]);
const binary = resolve(process.argv[3]);
const directory = await mkdtemp(resolve(process.env.AGENTNET_LIVE_AUDIT_ROOT || '.agentnet-audit','codex-plugin-'));
const marketplace = join(directory, 'marketplace');
const home = join(directory, 'codex-home');
const identity = join(directory, 'fresh-identity');
await mkdir(home);
await cp(source, marketplace, { recursive: true });
for (const filename of ['.mcp.json', 'mcp.json']) {
  const file = join(marketplace, 'plugins/elsewhere', filename);
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.mcpServers.elsewhere.env = { AGENTNET_HOME: identity, AGENTNET_URL: process.env.AGENTNET_PLUGIN_TEST_ENDPOINT || 'http://127.0.0.1:1', AGENTNET_PLUGIN_TEST_LOOPBACK:'1' };
  await writeFile(file, JSON.stringify(config));
}
const client = await codexProtocol({
  binary,
  cwd: marketplace,
  env: {
    ...process.env,
    CODEX_HOME: home,
    PATH: process.env.SystemRoot + '\\System32',
  },
});
const params = {
  marketplacePath: join(marketplace, '.agents/plugins/marketplace.json'),
  pluginName: 'elsewhere',
};
try {
  const before = await client.request('plugin/list', {
    cwds: [marketplace],
    marketplaceKinds: ['local'],
  });
  assert.equal(before.marketplaceLoadErrors.length, 0);
  assert.equal(before.marketplaces[0].plugins[0].installed, false);
  await client.request('plugin/install', params);
  const { plugin } = await client.request('plugin/read', params);
  assert.ok(plugin.summary.installed && plugin.summary.enabled);
  assert.equal(plugin.onboardingSkill.name, 'elsewhere:setup');
  const inventory = await client.request('mcpServerStatus/list', {});
  const mcp = inventory.data.find(
    (s) => s.pluginId === 'elsewhere@elsewhere-local',
  );
  assert.ok(mcp && !mcp.toolsError, mcp?.toolsError);
  assert.equal(Object.keys(mcp.tools).length, 11);
  const { thread } = await client.request('thread/start', {
    ephemeral: true,
    cwd: marketplace,
    approvalPolicy: 'never',
    sandbox: 'read-only',
  });
  const result = await client.request('mcpServer/tool/call', {
    threadId: thread.id,
    server: mcp.name,
    tool: 'elsewhere_connection',
    arguments: { action: 'status' },
  });
  const state = JSON.parse(result.content[0].text);
  assert.equal(state.state, process.env.AGENTNET_PLUGIN_TEST_ENDPOINT ? 'connected' : 'connection_needs_attention');
  assert.equal(
    await access(
      join(identity, 'servers/agentnet/agent-v2-credentials.json'),
    ).then(
      () => true,
      () => false,
    ),
    false,
  );
  const evidence = {
    passed: true,
    nativeInstall: true,
    onboardingSkill: plugin.onboardingSkill.name,
    tools: Object.keys(mcp.tools),
    nodeOnPath: false,
    freshIdentity: state.state,
    phoneAccountCreated: false,
    automaticInstallationIdentity: state.state==='connected',
    directory,
  };
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} finally {
  await client.close();
}
