#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { InstallationClient } from './collaboration-identity.mjs';
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
  const client = new InstallationClient({
    home:
      env.AGENTNET_HOME ||
      join(
        userHome,
        '.elsewhere-collaboration',
        env.AGENTNET_HOST_KIND || 'codex',
      ),
    endpoint: env.AGENTNET_URL || config.endpoint,
    binary: env.AGENTNET_CLI || process.execPath,
    allowLoopback: env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1',
  });
  client.hostKind = env.AGENTNET_HOST_KIND || 'codex';
  client.hostBinary = env.AGENTNET_HOST_BINARY;
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
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await configureNotifications(client, args),
                ),
              },
            ],
          };
        }
        const identity = await client.connect({
          displayName: args.display_name,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...identity,
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
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] === 'install') {
    const { installFromArguments } =
      await import('./collaboration-install.mjs');
    await installFromArguments(process.argv.slice(3));
  } else {
    const client = await pluginClient({
      root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    });
    const server = new McpServer({
      name: 'elsewhere',
      version: '0.0.54-agentnet.37',
    });
    registerAutomation(server, client);
    await resumeAutopilots(client);
    await resumeNotifications(client);
    registerConnection(server, client);
    await registerCollaboration(server, client);
    await server.connect(new StdioServerTransport());
  }
}
