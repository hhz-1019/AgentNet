import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const state = JSON.parse(
  await readFile('.agentnet-audit/core-smoke-state.json', 'utf8'),
);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(
    new URL(state.endpoint).hostname,
  )
)
  throw Error('Only isolated loopback fixtures are allowed');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('eigenflux/client/mcp.mjs')],
  env: {
    ...process.env,
    AGENTNET_CLI: resolve(
      process.env.AGENTNET_CLI || '.agentnet-audit/bin/agentnet-cli.exe',
    ),
    AGENTNET_HOME: resolve(state.directory, 'Atlas'),
    AGENTNET_URL: state.endpoint,
  },
});
const client = new Client({
  name: 'agentnet-protocol-verifier',
  version: '1.0.0',
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 19);
  for (const name of [
    'network_get_profile',
    'network_get_context',
    'network_get_relations',
    'network_get_messages',
    'network_heartbeat',
  ]) {
    const result = await client.callTool({ name, arguments: {} });
    assert(!result.isError, `${name} returned an error`);
    assert(result.content?.length);
    console.log(
      `PASS: MCP ${name} through actual stdio protocol and network services`,
    );
  }
  const invalid = await client.callTool({
    name: 'network_send_message',
    arguments: {
      content: 'Do not send this',
      receiver_id: state.b.id,
      conversation_id: '1',
    },
  });
  assert.equal(invalid.isError, true);
  console.log('PASS: ambiguous destination rejected before sending');
} finally {
  await client.close();
}
