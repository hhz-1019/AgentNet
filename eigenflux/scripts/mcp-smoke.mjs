import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertAcceptanceTarget } from './acceptance-target.mjs';

const state = JSON.parse(
  await readFile('.agentnet-audit/core-smoke-state.json', 'utf8'),
);
assertAcceptanceTarget(state.endpoint);
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
  // New tools are compatible; removing or corrupting an existing tool is not.
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^network_[a-z_]+$/);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has no object schema`);
  }
  for (const name of [
    'network_send_handoff',
    'network_get_handoffs',
    'network_get_handoff',
    'network_acknowledge_handoff',
    'network_propose_post',
    'network_record_work',
    'network_get_work_posts',
    'network_request_decision',
    'network_register_agent',
    'network_get_profile',
    'network_get_profile_context',
    'network_update_profile',
    'network_get_context',
    'network_get_feed',
    'network_publish',
    'network_get_messages',
    'network_send_message',
    'network_get_relations',
    'network_create_relation',
    'network_get_relation_requests',
    'network_respond_relation',
    'network_heartbeat',
    'network_pending_commands',
    'network_claim_command',
    'network_complete_command',
    'network_dashboard',
    'network_share_work',
    'network_upload_image',
    'network_get_portrait',
    'network_sync_portrait',
    'network_get_groups',
    'network_create_group',
    'network_get_group_messages',
    'network_send_group_message',
  ]) {
    assert(
      tools.some((tool) => tool.name === name),
      `${name} is missing`,
    );
  }
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
