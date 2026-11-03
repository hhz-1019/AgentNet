// Build one native plugin with offline Windows/macOS runtimes. No installation or publication.
import { readFile, writeFile, mkdir, cp, chmod } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packRuntime } from './runtime-archive.mjs';
const options = {};
for (let i = 2; i < process.argv.length; i += 2)
  options[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
for (const key of ['stage', 'windows', 'mac-arm64', 'mac-amd64', 'go'])
  if (!options[key]) throw new Error(`Missing --${key}`);
const output = resolve(
  options.output || `dist-collaboration-plugin/codex-marketplace-${Date.now()}`,
);
const plugin = join(output, 'plugins/elsewhere');
// Never merge a new release into an old tree: removed skills must not survive.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await mkdir(plugin, { recursive: true });
await cp(resolve(options.stage), plugin, { recursive: true });
await cp(
  'elsewhere/client/collaboration-plugin.mjs',
  join(plugin, 'elsewhere/client/collaboration-plugin.mjs'),
);
const runtimes = {
  'windows-amd64': options.windows,
  'darwin-arm64': options['mac-arm64'],
  'darwin-amd64': options['mac-amd64'],
};
const hashes = {};
const archives = {};
await mkdir(join(plugin, 'runtime'), { recursive: true });
for (const [platform, source] of Object.entries(runtimes)) {
  const manifest = JSON.parse(
    await readFile(join(source, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.platform !== platform ||
    manifest.version !== '0.0.54-agentnet.29'
  )
    throw new Error('Incorrect runtime bundle');
  for (const [file, digest] of Object.entries(manifest.sha256)) {
    const actual = createHash('sha256')
      .update(await readFile(join(source, file)))
      .digest('hex');
    if (actual !== digest) throw new Error('Runtime digest mismatch');
    hashes[`runtime/${platform}/${file.split('/').at(-1)}`] = actual;
  }
  archives[platform] = await packRuntime(
    join(source, 'runtime'),
    platform.startsWith('windows')
      ? ['node.exe', 'elsewhere.exe', 'NODE-LICENSE.txt']
      : ['node', 'elsewhere', 'NODE-LICENSE.txt'],
    join(plugin, 'runtime', `${platform}.tar.gz`),
  );
  await writeFile(
    join(plugin, 'runtime', `${platform}.sha256`),
    archives[platform] + '\n',
  );
}
await cp('elsewhere/plugin/launch', join(plugin, 'runtime/launch'));
await chmod(join(plugin, 'runtime/launch'), 0o755);
execFileSync(
  resolve(options.go),
  [
    'build',
    '-trimpath',
    '-ldflags=-s -w',
    '-o',
    join(plugin, 'runtime/launch.exe'),
    resolve('elsewhere/plugin/launcher_windows.go'),
    resolve('elsewhere/plugin/runtime_windows.go'),
  ],
  {
    env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
    windowsHide: true,
    stdio: 'pipe',
  },
);
const endpoint = new URL(options.endpoint || 'https://collab.gongshi.world');
if (endpoint.protocol !== 'https:' || endpoint.href !== endpoint.origin + '/')
  throw new Error('HTTPS origin required');
const json = async (file, data) => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
};
const overlay = {
  skills: './skills/',
  mcpServers: './.mcp.json',
  interface: {
    displayName: 'Elsewhere',
    shortDescription: '和朋友的 Agent 一起完成项目',
    developerName: 'Elsewhere',
    category: 'Productivity',
    defaultPrompt: [
      '通过 Elsewhere 和 @对方短号一起完成一个项目',
      '查看 Elsewhere 协作邀请和项目进展',
    ],
  },
  extensions: { 'com.openai': { onboardingSkill: './skills/setup/SKILL.md' } },
};
const identity = {
  name: 'elsewhere',
  version: '0.0.54-agentnet.36',
  description:
    'Connect your Agent with another owner’s Agent to collaborate on shared projects.',
  author: { name: 'Elsewhere' },
};
await json(join(plugin, '.codex-plugin/plugin.json'), {
  ...identity,
  ...overlay,
});
await json(join(plugin, 'plugin.json'), {
  ...identity,
  extensions: {
    'com.openai': {
      ...overlay,
      onboardingSkill: './skills/setup/SKILL.md',
      extensions: undefined,
    },
  },
});
// Codex resolves dot-relative commands and cwd from the installed plugin root.
// CLAUDE_PLUGIN_ROOT interpolation is not supported in this native MCP loader.
const servers = {
  elsewhere: { command: './runtime/launch', args: [], cwd: '.' },
};
await json(join(plugin, '.mcp.json'), { mcpServers: servers });
await json(join(plugin, 'mcp.json'), {
  mcpServers: { elsewhere: { type: 'stdio', ...servers.elsewhere } },
});
await json(join(plugin, 'connection.json'), { endpoint: endpoint.origin });
await json(join(plugin, 'runtime-integrity.json'), hashes);
await json(join(plugin, 'runtime-archives.json'), archives);
await cp(
  'elsewhere/skills/agentnet-collaboration',
  join(plugin, 'skills/collaborate'),
  { recursive: true },
);
await mkdir(join(plugin, 'skills/setup'), { recursive: true });
await cp('elsewhere/plugin/SETUP.md', join(plugin, 'skills/setup/SKILL.md'));
await json(join(output, '.agents/plugins/marketplace.json'), {
  name: 'elsewhere-local',
  interface: { displayName: 'Elsewhere' },
  plugins: [
    {
      name: 'elsewhere',
      source: { source: 'local', path: './plugins/elsewhere' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
      category: 'Productivity',
    },
  ],
});
console.log(
  JSON.stringify({
    output,
    plugin,
    marketplace: join(output, '.agents/plugins/marketplace.json'),
    version: identity.version,
  }),
);
