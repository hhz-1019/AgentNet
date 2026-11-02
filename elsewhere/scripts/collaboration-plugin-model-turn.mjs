import { codexProtocol } from './codex-plugin-protocol.mjs';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function pluginModelTurn({ installed, prompt, receipt }) {
  const marketplace = installed.pluginId.split('@')[1];
  const client = await codexProtocol({
    binary: process.env.AGENTNET_NATIVE_APP_SERVER,
    cwd: installed.cwd,
    overrides: [
      `marketplaces.${marketplace}.source_type="local"`,
      `marketplaces.${marketplace}.source=${JSON.stringify(installed.cwd)}`,
      `plugins.${installed.pluginId}.enabled=true`,
      ...[
        'elsewhere_connection',
        'network_collaboration_project',
        'network_collaboration_membership',
        'network_collaboration_context',
      ].map(
        (tool) =>
          `plugins.${installed.pluginId}.mcp_servers.${installed.serverName}.tools.${tool}.approval_mode="approve"`,
      ),
      'features.apps=true',
      'features.shell_tool=false',
      'features.apply_patch_freeform=false',
      'features.multi_agent=false',
      'features.hooks=false',
      'web_search="disabled"',
    ],
  });
  let installedHere = false;
  try {
    await client.request('plugin/install', {
      marketplacePath: join(installed.cwd, '.agents/plugins/marketplace.json'),
      pluginName: 'elsewhere',
    });
    installedHere = true;
    const inventory = await client.request('plugin/list', {
      cwds: [installed.cwd],
      marketplaceKinds: ['local'],
    });
    const disabledPluginIds = inventory.marketplaces
      .flatMap((m) => m.plugins)
      .filter((p) => p.id !== installed.pluginId)
      .map((p) => p.id);
    const { config } = await client.request('config/read', {});
    assert.equal(
      config.plugins?.[installed.pluginId]?.mcp_servers?.[installed.serverName]
        ?.tools?.elsewhere_connection?.approval_mode,
      'approve',
      'Synthetic fixture tool permission must be effective before model execution',
    );
    const overrides = {};
    for (const name of Object.keys(config.mcp_servers || {}))
      overrides[`mcp_servers.${name}.enabled`] = false;
    for (const name of Object.keys(config.plugins || {}))
      if (name !== installed.pluginId)
        overrides[`plugins.${name}.enabled`] = false;
    const { thread } = await client.request('thread/start', {
      cwd: installed.cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      model: process.env.AGENTNET_LIVE_CODEX_MODEL || 'gpt-6.1-sol',
      config: overrides,
    });
    receipt.sessionId = thread.id;
    await client.request('turn/start', {
      threadId: thread.id,
      disabledPluginIds,
      input: [
        {
          type: 'mention',
          name: 'Elsewhere',
          path: `plugin://${installed.pluginId}`,
        },
        {
          type: 'text',
          text:
            '先调用 Elsewhere 插件 elsewhere_connection status，确认 connected 后继续，不重新注册。' +
            prompt,
          text_elements: [],
        },
      ],
    });
    const deadline = Date.now() + 300000;
    let cursor = 0;
    while (Date.now() < deadline) {
      for (const event of client.notifications.slice(cursor)) {
        cursor++;
        if (event.method === 'item/completed') {
          const item = event.params.item;
          if (item.type === 'mcpToolCall') {
            const call = {
              tool: item.tool,
              server: item.server,
              action: item.arguments?.action,
              status: item.status,
              error: item.error,
            };
            receipt.tools.push(call);
            console.log(
              JSON.stringify({ nativeInvitation: receipt.identity, ...call }),
            );
          }
          if (item.type === 'agentMessage')
            receipt.finalMessage = item.text?.slice(0, 4000);
        }
        if (event.method === 'turn/completed') {
          receipt.completed = event.params.turn.status === 'completed';
          return receipt.completed ? 0 : 1;
        }
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Native plugin model turn timed out');
  } finally {
    await writeFile(
      join(installed.cwd, 'model-turn-receipt.json'),
      JSON.stringify(receipt, null, 2),
    );
    await client.close();
    if (installedHere) {
      const cleanup = await codexProtocol({
        binary: process.env.AGENTNET_NATIVE_APP_SERVER,
        cwd: installed.cwd,
      });
      try {
        await cleanup.request('plugin/uninstall', {
          pluginId: installed.pluginId,
        });
      } finally {
        await cleanup.close();
      }
    }
  }
}
