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
  registerAutomation,
  resumeAutopilots,
} from './collaboration-autopilot.mjs';

export async function pluginClient({
  root,
  env = process.env,
  userHome = homedir(),
}) {
  const config = JSON.parse(
    await readFile(join(root, 'connection.json'), 'utf8'),
  );
  return new InstallationClient({
    home:
      env.AGENTNET_HOME || join(userHome, '.elsewhere-collaboration', 'codex'),
    endpoint: env.AGENTNET_URL || config.endpoint,
    binary: env.AGENTNET_CLI || process.execPath,
    allowLoopback: env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1',
  });
}
export function registerConnection(server, client) {
  server.registerTool(
    'elsewhere_connection',
    {
      description:
        'Connect this installed Agent automatically and return its shareable short ID. No phone, email, website login, profile draft, or host account credentials. Preserve the same installation key across retries. Does not accept invitations or authorize background execution.',
      inputSchema: z.strictObject({
        action: z.enum(['status', 'prepare']),
        display_name: z.string().min(1).max(80).optional(),
      }),
    },
    async ({ display_name }) => {
      try {
        const identity = await client.connect({ displayName: display_name });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...identity,
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
                state: 'connection_needs_attention',
                next: 'Connection is temporarily unavailable. Keep the existing installation identity and retry; do not register a replacement or open the old account website.',
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
  const client = await pluginClient({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  });
  const server = new McpServer({
    name: 'elsewhere',
    version: '0.0.54-agentnet.36',
  });
  registerAutomation(server, client);
  await resumeAutopilots(client);
  registerConnection(server, client);
  await registerCollaboration(server, client);
  await server.connect(new StdioServerTransport());
}
