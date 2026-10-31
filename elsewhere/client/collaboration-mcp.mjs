#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Elsewhere } from './sdk.mjs';
import { registerCollaboration } from './collaboration.mjs';
const client = new Elsewhere({
  binary: process.env.AGENTNET_CLI,
  home: process.env.AGENTNET_HOME,
  endpoint: process.env.AGENTNET_URL,
});
const server = new McpServer({
  name: 'elsewhere-collaboration',
  version: '0.0.54-agentnet.27',
});
await registerCollaboration(server, client);
await server.connect(new StdioServerTransport());
