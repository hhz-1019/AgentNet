import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './collaboration-setup.mjs';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-setup-'));
  const cli = join(root, 'cli');
  await writeFile(cli, 'fixture');
  return {
    root,
    cli,
    endpoint: 'https://example.invalid',
    host: 'claude-code',
  };
}
await test('installation preserves unrelated host configuration and installs connection-bound skills', async () => {
  const options = await fixture(),
    calls = [];
  await writeFile(
    join(options.root, '.claude.json'),
    JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'existing' } },
    }),
  );
  const run = (_binary, args) => {
    calls.push(args);
    if (args[0] === 'version')
      return JSON.stringify({ cli_version: '0.0.54-agentnet.29' });
    if (args.includes('list')) return '[]';
    return '';
  };
  const result = await setup({ ...options, run });
  const saved = JSON.parse(await readFile(result.configuration, 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.mcpServers.other.command, 'existing');
  assert.equal(result.backgroundEnabled, false);
  assert.equal(
    saved.mcpServers.elsewhere_collaboration.env.AGENTNET_HOME,
    result.home,
  );
  const skill = await readFile(
    join(options.root, '.claude/skills/agentnet-collaboration/SKILL.md'),
    'utf8',
  );
  assert.ok(skill.includes(options.endpoint));
  assert.ok(
    (await readdir(options.root)).some((p) =>
      p.startsWith('.claude.json.backup-'),
    ),
  );
  assert.ok(!calls.some((args) => args.includes('provision')));
});
await test('foreign endpoint refuses installation without replacing host config', async () => {
  const options = await fixture();
  const original = '{"theme":"unchanged"}';
  await writeFile(join(options.root, '.claude.json'), original);
  options.home = join(options.root, 'existing-home');
  await mkdir(options.home);
  await writeFile(join(options.home, 'config.json'), '{}');
  await assert.rejects(
    setup({
      ...options,
      run: (_b, args) =>
        args[0] === 'version'
          ? '{"cli_version":"0.0.54-agentnet.29"}'
          : '[{"name":"agentnet","endpoint":"https://other.invalid"}]',
    }),
    /另一服务/,
  );
  assert.equal(
    await readFile(join(options.root, '.claude.json'), 'utf8'),
    original,
  );
});
await test('Codex uses native MCP configuration command and preserves explicit Codex Home', async () => {
  const options = await fixture(),
    calls = [];
  const codexHome = join(options.root, 'codex custom');
  await mkdir(codexHome);
  await setup({
    ...options,
    host: 'codex',
    codexHome,
    hostBinary: options.cli,
    run: (binary, args, opts) => {
      calls.push({ binary, args, opts });
      return args[0] === 'version'
        ? '{"cli_version":"0.0.54-agentnet.29"}'
        : args.includes('list')
          ? '[]'
          : '';
    },
  });
  const call = calls.find((c) => c.args[0] === 'mcp');
  assert.equal(call.opts.env.CODEX_HOME, codexHome);
  assert.deepEqual(call.args.slice(0, 3), [
    'mcp',
    'add',
    'elsewhere_collaboration',
  ]);
});
await test('invalid endpoint and incompatible CLI fail before writing host configuration', async () => {
  const options = await fixture();
  await assert.rejects(
    setup({ ...options, endpoint: 'http://example.invalid' }),
    /HTTPS/,
  );
  await assert.rejects(
    setup({ ...options, run: () => '{"cli_version":"0.0.54-agentnet.28"}' }),
    /配套/,
  );
  assert.deepEqual(await readdir(options.root), ['cli']);
});
