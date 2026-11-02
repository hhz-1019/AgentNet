// Local fixture setup through the native installer. Never provisions a real account.
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { codexProtocol } from './codex-plugin-protocol.mjs';

export async function installFixturePlugin({ fixture, workspace, identity }) {
  const source = resolve(process.env.AGENTNET_LIVE_PLUGIN_MARKETPLACE);
  const cwd = join(workspace, `plugin-owner-${identity}`);
  await cp(source, cwd, { recursive: true, errorOnExist: true });
  const catalogPath = join(cwd, '.agents/plugins/marketplace.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  catalog.name = `elsewhere-fixture-${basename(resolve(workspace, '..'))}-${identity}`;
  const pluginId = `elsewhere@${catalog.name}`;
  const serverName = `elsewhere_fixture_${identity}`;
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  for (const filename of ['.mcp.json', 'mcp.json']) {
    const path = join(cwd, 'plugins/elsewhere', filename);
    const data = JSON.parse(await readFile(path, 'utf8'));
    // Only this synthetic fixture copy receives local credentials paths; never the distributable.
    data.mcpServers.elsewhere.env = {
      AGENTNET_HOME: fixture.homes[identity],
      AGENTNET_URL: fixture.endpoint,
    };
    data.mcpServers[serverName] = data.mcpServers.elsewhere;
    delete data.mcpServers.elsewhere;
    await writeFile(path, JSON.stringify(data, null, 2));
  }
  const codexHome = join(workspace, `plugin-install-home-${identity}`);
  await mkdir(codexHome, { recursive: true });
  const native = await codexProtocol({
    binary: process.env.AGENTNET_NATIVE_APP_SERVER,
    cwd,
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  const params = {
    marketplacePath: join(cwd, '.agents/plugins/marketplace.json'),
    pluginName: 'elsewhere',
  };
  try {
    const listed = await native.request('plugin/list', {
      cwds: [cwd],
      marketplaceKinds: ['local'],
    });
    assert.equal(listed.marketplaceLoadErrors.length, 0);
    await native.request('plugin/install', params);
    const { plugin } = await native.request('plugin/read', params);
    assert.ok(plugin.summary.installed && plugin.summary.enabled);
    assert.ok(plugin.onboardingSkill);
    const servers = await native.request('mcpServerStatus/list', {
      serverName,
    });
    const server = servers.data.find((s) => s.pluginId === pluginId);
    assert.ok(
      server && !server.toolsError,
      server?.toolsError || 'Plugin MCP missing',
    );
    assert.ok(server.tools.elsewhere_connection);
    console.log(
      JSON.stringify({
        nativePluginInstalled: true,
        identity,
        tools: Object.keys(server.tools).length,
      }),
    );
    return {
      cwd,
      codexHome,
      pluginId,
      serverName,
      receipt: {
        installed: true,
        enabled: true,
        version: plugin.summary.localVersion,
        onboardingSkill: plugin.onboardingSkill.name,
        mcpTools: Object.keys(server.tools),
        installedThrough: 'native Codex plugin/install',
      },
    };
  } finally {
    await native.close();
  }
}
