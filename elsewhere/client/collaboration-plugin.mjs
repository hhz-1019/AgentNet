#!/usr/bin/env node
// Installed-plugin entry point. Credentials always remain outside the plugin cache.
import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Elsewhere } from './sdk.mjs';
import { registerCollaboration } from './collaboration.mjs';

export async function pluginClient({
  root,
  env = process.env,
  userHome = homedir(),
}) {
  const platform =
    process.platform === 'win32'
      ? 'windows-amd64'
      : `darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
  if (!['win32', 'darwin'].includes(process.platform))
    throw new Error('Unsupported platform');
  const binary =
    env.AGENTNET_CLI ||
    join(
      root,
      'runtime',
      platform,
      process.platform === 'win32' ? 'elsewhere.exe' : 'elsewhere',
    );
  const home = resolve(
    env.AGENTNET_HOME || join(userHome, '.agentnet-codex', '.elsewhere'),
  );
  const config = JSON.parse(
    await readFile(join(root, 'connection.json'), 'utf8'),
  );
  await access(binary);
  // The SDK checks any existing Home endpoint and fails closed on a mismatch.
  return new Elsewhere({
    binary,
    home,
    endpoint: env.AGENTNET_URL || config.endpoint,
  });
}

export function registerConnection(server, client) {
  server.registerTool(
    'elsewhere_connection',
    {
      description:
        'Check Elsewhere connection or prepare account binding after explicit local owner consent. Reuse existing identity. Never register after an authentication failure. Do not expose credentials or local paths. Registration approval remains in the owner browser.',
      inputSchema: z.strictObject({
        action: z.enum(['status', 'prepare']),
        display_name: z.string().min(1).max(80).optional(),
        draft: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async ({ action, display_name, draft }) => {
      const result = (value, isError = false) => ({
        isError,
        content: [{ type: 'text', text: JSON.stringify(value) }],
      });
      try {
        if (!client.ready) await client.connect();
        const path = join(
          client.cliHome,
          'servers',
          'agentnet',
          'agent-v2-credentials.json',
        );
        const existing = await access(path).then(
          () => true,
          (e) => {
            if (e.code === 'ENOENT') return false;
            throw e;
          },
        );
        if (action === 'status') {
          if (!existing)
            return result({
              state: 'needs_binding',
              next: 'Run the plugin setup skill to prepare your account binding.',
            });
          try {
            await client.collaboration_project({ action: 'list' });
            return result({
              state: 'connected',
              ready_for_collaboration: true,
            });
          } catch {
            return result(
              {
                state: 'connection_needs_attention',
                next: 'Restore or complete the existing account connection. Do not register a replacement identity.',
              },
              true,
            );
          }
        }
        if (!display_name || !draft)
          return result(
            {
              state: 'profile_required',
              next: 'Prepare and review the minimal profile using the bundled onboarding references.',
            },
            true,
          );
        // Reuse the original validator and native signed provisioning flow.
        await client.command(['validate-profile', '--draft-file', '-'], {
          input: draft,
        });
        const response = await client.command(
          [
            'agent',
            'provision',
            '--require-rich-profile',
            '--agent-name',
            display_name,
            '--mode',
            'plugin',
            '--runtime-name',
            'codex',
            '--draft-file',
            '-',
            ...(existing ? ['--require-existing-agent'] : []),
          ],
          { input: draft },
        );
        const url = new URL(response.console_url);
        if (url.origin !== client.endpoint || url.username || url.password)
          throw new Error('Foreign account binding URL');
        return result({
          state: 'awaiting_owner_binding',
          console_url: url.href,
          next: 'Open this link for the owner to complete account binding; then call status. Never request passwords or verification codes in chat.',
        });
      } catch {
        return result(
          {
            state: 'connection_needs_attention',
            next: 'Connection was not completed. Preserve the existing identity and retry after the service or account connection is restored.',
          },
          true,
        );
      }
    },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const client = await pluginClient({ root });
  const server = new McpServer({
    name: 'elsewhere',
    version: '0.0.54-agentnet.31',
  });
  registerConnection(server, client);
  await registerCollaboration(server, client);
  await server.connect(new StdioServerTransport());
}
