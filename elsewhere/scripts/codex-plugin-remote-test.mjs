// Public-source installation acceptance; no account binding or model calls.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { codexProtocol } from './codex-plugin-protocol.mjs';
const directory = await mkdtemp(resolve('.agentnet-audit/remote-plugin-'));
const home = join(directory, 'codex-home');
await mkdir(home);
const client = await codexProtocol({
  binary: process.argv[2],
  cwd: directory,
  env: { ...process.env, CODEX_HOME: home },
});
try {
  const added = await client.request('marketplace/add', {
    source: 'https://github.com/hhz-1019/AgentNet.git',
    refName: 'codex/collaboration-plugin-pilot',
    sparsePaths: ['.agents/plugins', 'plugins/elsewhere'],
  });
  const params = {
    marketplacePath: join(
      added.installedRoot,
      '.agents/plugins/marketplace.json',
    ),
    pluginName: 'elsewhere',
  };
  await client.request('plugin/install', params);
  const { plugin } = await client.request('plugin/read', params);
  assert.ok(plugin.summary.installed && plugin.summary.enabled);
  const result = await client.request('mcpServerStatus/list', {
    serverName: 'elsewhere',
  });
  const server = result.data.find((s) => s.pluginId === plugin.summary.id);
  assert.ok(server && !server.toolsError);
  assert.equal(Object.keys(server.tools).length, 11);
  const evidence = {
    passed: true,
    source: 'https://github.com/hhz-1019/AgentNet.git',
    ref: 'codex/collaboration-plugin-pilot',
    version: plugin.summary.localVersion,
    pluginId: plugin.summary.id,
    tools: Object.keys(server.tools),
    installedRoot: added.installedRoot,
    boundAccount: false,
  };
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ directory, ...evidence }));
} finally {
  await client.close();
}
