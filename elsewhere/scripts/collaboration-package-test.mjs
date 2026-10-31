import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:collaboration:package');
const artifact = resolve(
  'dist-collaboration-plugin/elsewhere-collaboration-plugin-0.0.54-agentnet.27.tgz',
);
const directory = await mkdtemp(join(tmpdir(), 'elsewhere-installed-plugin-'));
await writeFile(
  join(directory, 'package.json'),
  JSON.stringify({
    name: 'isolated-plugin-test',
    private: true,
    version: '1.0.0',
  }),
);
execFileSync(
  process.execPath,
  [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', artifact],
  { cwd: directory, stdio: 'pipe' },
);
const installed = join(
  directory,
  'node_modules',
  '@elsewhere',
  'collaboration-plugin',
);
const pkg = JSON.parse(await readFile(join(installed, 'package.json')));
assert.equal(pkg.private, true);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(installed, 'elsewhere/client/collaboration-mcp.mjs')],
  cwd: directory,
  env: {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    AGENTNET_CLI: join(directory, 'unused-cli'),
    AGENTNET_HOME: join(directory, 'existing-home-fixture'),
    AGENTNET_URL: 'https://fixture.invalid',
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'installed-package-smoke', version: '1' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  for (const group of [
    'project',
    'membership',
    'tasks',
    'updates',
    'review',
    'checkpoint',
  ]) {
    const schema = tools.find(
      (tool) => tool.name === 'network_collaboration_' + group,
    ).inputSchema;
    assert.ok(schema.properties.action);
    assert.ok(schema.properties.project_id);
    assert.equal(schema.additionalProperties, false);
  }
  const result = await client.callTool({
    name: 'network_collaboration_capabilities',
    arguments: {},
  });
  assert.equal(
    JSON.parse(result.content[0].text).execution_mode,
    'host_session_only',
  );
  const invalid = await client.callTool({
    name: 'network_collaboration_project',
    arguments: { action: 'get', project_id: 'fixture', owner_approved: true },
  });
  assert.equal(invalid.isError, true);
  console.log(
    JSON.stringify(
      {
        artifact,
        installed,
        cwd: directory,
        initialized: true,
        tools: tools.length,
        capabilityCall: true,
        invalidRequestRejected: true,
        repositoryDependencies: false,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
