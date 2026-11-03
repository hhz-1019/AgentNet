#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { InstallationClient } from './collaboration-identity.mjs';
import {
  resolveCollaborationHome,
  rememberCollaborationHome,
} from './collaboration-home.mjs';
import { registerCollaboration } from './collaboration.mjs';
import {
  configureNotifications,
  notificationPlan,
  resumeNotifications,
} from './collaboration-notifications.mjs';
import {
  registerAutomation,
  resumeAutopilots,
} from './collaboration-autopilot.mjs';

export async function pluginClient({
  root,
  env = process.env,
  userHome = homedir(),
}) {
  const config = env.AGENTNET_URL
    ? { endpoint: env.AGENTNET_URL }
    : JSON.parse(await readFile(join(root, 'connection.json'), 'utf8'));
  const host = env.AGENTNET_HOST_KIND || 'codex';
  let home, recoveryError;
  try {
    home = await resolveCollaborationHome({
      root: userHome,
      env,
      host,
      home: env.AGENTNET_HOME,
      endpoint: env.AGENTNET_URL || config.endpoint,
    });
  } catch (error) {
    recoveryError = error;
    home =
      env.AGENTNET_HOME || join(userHome, '.elsewhere-collaboration', host);
  }
  const client = new InstallationClient({
    home,
    endpoint: env.AGENTNET_URL || config.endpoint,
    binary: env.AGENTNET_CLI || process.execPath,
    allowLoopback: env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1',
  });
  client.hostKind = env.AGENTNET_HOST_KIND || 'codex';
  client.hostBinary = env.AGENTNET_HOST_BINARY;
  if (recoveryError) {
    client.connect = async () => {
      throw recoveryError;
    };
    client.recoveryBlocked = true;
  }
  client.rememberHome = async () => {
    if (env.AGENTNET_HOME) {
      let record;
      try {
        record = JSON.parse(
          await readFile(
            join(
              userHome,
              '.elsewhere/connections',
              (host === 'claude_code' ? 'claude-code' : host) + '.json',
            ),
            'utf8',
          ),
        );
      } catch (e) {
        if (e.code === 'ENOENT') return;
        throw e;
      }
      if (resolve(record.home) !== resolve(env.AGENTNET_HOME)) return;
    }
    await rememberCollaborationHome({
      root: userHome,
      host,
      home: client.cliHome,
      endpoint: client.endpoint,
    });
  };
  return client;
}
export function registerConnection(server, client) {
  server.registerTool(
    'elsewhere_connection',
    {
      description:
        'Connect and receive collaboration notifications in the owner chat. After connecting, use notification_plan and watch to bind current-chat notifications; inbox reads new invitations/owner decisions/results; acknowledge marks host receipt, never accepts an invitation. Use native host heartbeat when direct queue cannot wake the chat. No phone login or copied host credentials. Receiving notifications does not authorize project execution.',
      inputSchema: z.strictObject({
        action: z.enum([
          'status',
          'prepare',
          'notification_plan',
          'watch',
          'unwatch',
          'notification_status',
          'inbox',
          'acknowledge',
        ]),
        display_name: z.string().min(1).max(80).optional(),
        thread_id: z.uuid().optional(),
        delivery_mode: z.enum(['codex_queue', 'host_heartbeat']).optional(),
        automation_id: z.string().min(1).max(200).optional(),
        host_binary: z.string().min(1).optional(),
        event_ids: z
          .array(z.string().regex(/^[a-f0-9]{64}$/))
          .max(100)
          .optional(),
      }),
    },
    async (args) => {
      try {
        if (!['status', 'prepare'].includes(args.action)) {
          const result = await configureNotifications(client, args);
          if (['watch', 'unwatch'].includes(args.action))
            await client.rememberHome?.();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }
        const identity = await client.connect({
          displayName: args.display_name,
        });
        await client.rememberHome?.();
        const notificationStatus = client.cliHome
          ? await configureNotifications(client, {
              action: 'notification_status',
            })
          : { enabled: false };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...identity,
                plugin_version: '0.0.54-agentnet.38',
                notification_status: notificationStatus,
                startup_warnings: client.startupWarnings || [],
                notifications: notificationPlan(client.hostKind),
                next: 'Share your short ID, or provide your collaborator’s short ID and project goal.',
              }),
            },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                state: ['status', 'prepare'].includes(args.action)
                  ? 'connection_needs_attention'
                  : 'notification_needs_attention',
                next: 'Keep the existing identity. For notifications check the exact current chat, host wake capability and native heartbeat binding; never report queued as delivered. Do not register a replacement or open the old account website.',
              }),
            },
          ],
        };
      }
    },
  );
}
export async function startPlugin({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
} = {}) {
  const client = await pluginClient({ root });
  const server = new McpServer({
    name: 'elsewhere',
    version: '0.0.54-agentnet.38',
  });
  registerAutomation(server, client);
  if (!client.recoveryBlocked) {
    client.startupWarnings = [];
    try {
      await resumeAutopilots(client);
    } catch {
      client.startupWarnings.push('background_restore_needs_attention');
    }
    try {
      await resumeNotifications(client);
    } catch {
      client.startupWarnings.push('notification_restore_needs_attention');
    }
  }
  registerConnection(server, client);
  await registerCollaboration(server, client);
  await server.connect(new StdioServerTransport());
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] === 'install') {
    const { installFromArguments } =
      await import('./collaboration-install.mjs');
    await installFromArguments(process.argv.slice(3));
  } else if (process.argv[2] === 'connection') {
    // Installer can finish setup even while the host still exposes its old tool list.
    const client = await pluginClient({
      root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    });
    let handler;
    registerConnection(
      {
        registerTool(_name, _schema, fn) {
          handler = fn;
        },
      },
      client,
    );
    const args = JSON.parse(process.argv[3] || '{"action":"status"}');
    if (
      ![
        'status',
        'prepare',
        'notification_plan',
        'notification_status',
        'watch',
        'unwatch',
        'inbox',
        'acknowledge',
      ].includes(args.action)
    )
      throw Error('Invalid connection action');
    const result = await handler(args);
    console.log(result.content[0].text);
    if (result.isError) process.exitCode = 1;
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const { selectUpdate } = await import('./collaboration-update.mjs');
    const selected = await selectUpdate({ root }).catch(() => root);
    if (selected === root) await startPlugin({ root });
    else {
      const module = await import(
        pathToFileURL(
          join(selected, 'elsewhere/client/collaboration-plugin.mjs'),
        ).href
      );
      await module.startPlugin({ root: selected });
    }
  }
}
