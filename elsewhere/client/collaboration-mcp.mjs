#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  existingCollaborationClient,
  InstallationClient,
} from './collaboration-identity.mjs';
import { registerConnection } from './collaboration-plugin.mjs';
import {
  registerAutomation,
  resumeAutopilots,
} from './collaboration-autopilot.mjs';
import { registerCollaboration } from './collaboration.mjs';
import {
  createBackgroundBridge,
  loadBridgeAuthorization,
} from './collaboration-background-bridge.mjs';
const client = await existingCollaborationClient({
  binary: process.env.AGENTNET_CLI,
  home: process.env.AGENTNET_HOME,
  endpoint: process.env.AGENTNET_URL,
});
const server = new McpServer({
  name: 'elsewhere-collaboration',
  version: '0.0.54-agentnet.29',
});
const policyFile = process.env.ELSEWHERE_COLLABORATION_POLICY;
const jobId = process.env.ELSEWHERE_COLLABORATION_JOB;
if (Boolean(policyFile) !== Boolean(jobId))
  throw new Error('Incomplete background binding');
if (policyFile) await loadBridgeAuthorization(policyFile, jobId);
if (!policyFile && client instanceof InstallationClient) {
  registerConnection(server, client);
  registerAutomation(server, client);
  await resumeAutopilots(client);
}
await registerCollaboration(server, client, {
  backgroundBridge: policyFile
    ? createBackgroundBridge(client, policyFile, jobId)
    : undefined,
});
await server.connect(new StdioServerTransport());
