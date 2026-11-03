import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd(),
  out = resolve(process.env.ELSEWHERE_PLUGIN_OUTPUT || resolve(root, 'dist-collaboration-plugin'));
await mkdir(out, { recursive: true });
// A new immutable stage prevents accidentally including previous output or local secrets.
const stage = join(out, `stage-${Date.now()}`);
await mkdir(stage);
export const sources = [
  'elsewhere/client/collaboration-plugin.mjs',
  'elsewhere/client/collaboration-home.mjs',
  'elsewhere/client/collaboration-update.mjs',
  'elsewhere/client/collaboration-autopilot.mjs',
  'elsewhere/client/collaboration-delivery.mjs',
  'elsewhere/client/collaboration-runtime.mjs',
  'elsewhere/client/collaboration-notifications.mjs',
  'elsewhere/client/collaboration-install.mjs',
  'elsewhere/plugin/INSTALL.md',
  'elsewhere/client/collaboration-identity.mjs',
  'elsewhere/client/collaboration-mcp.mjs',
  'elsewhere/client/collaboration-setup.mjs',
  'elsewhere/client/collaboration-enable.mjs',
  'elsewhere/client/collaboration.mjs',
  'elsewhere/client/collaboration-host.mjs',
  'elsewhere/client/collaboration-background.mjs',
  'elsewhere/client/collaboration-background-policy.mjs',
  'elsewhere/client/collaboration-background-bridge.mjs',
  'elsewhere/client/collaboration-background-execution.mjs',
  'elsewhere/client/collaboration-native-host.mjs',
  'elsewhere/client/collaboration-opencode-host.mjs',
  'elsewhere/client/sdk.mjs',
  'elsewhere/client/receipts.mjs',
  'elsewhere/client/identity.mjs',
  'elsewhere/client/connection-deletion.mjs',
  'elsewhere/client/work.mjs',
  'elsewhere/client/prompts.mjs',
  'elsewhere/client/workflows.mjs',
  'elsewhere/skills/agentnet-social/references/behavior.md',
  'elsewhere/skills/agentnet-social/references/host-context.md',
  'elsewhere/skills/agentnet-social/references/social-writing.md',
  'elsewhere/skills/agentnet-collaboration/SKILL.md',
  'elsewhere/skills/agentnet-onboarding/SKILL.md',
  'elsewhere/skills/agentnet-onboarding/references/rich-profile.md',
  'docs/COLLABORATION.md',
  'docs/COLLABORATION_API.md',
  'docs/COLLABORATION_VERIFICATION.md',
  'docs/COLLABORATION_PILOT.md',
  'docs/COLLABORATION_NO_LOGIN.md',
  'LICENSE',
];
for (const source of sources) {
  const target = join(stage, source);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, source), target);
}
const lock = JSON.parse(
  await readFile(join(root, 'package-lock.json'), 'utf8'),
);
const dependencies = Object.fromEntries(
  ['@modelcontextprotocol/sdk', 'zod'].map((name) => [
    name,
    lock.packages[`node_modules/${name}`].version,
  ]),
);
const pkg = {
  name: '@elsewhere/collaboration-plugin',
  version: '0.0.54-agentnet.38',
  private: true,
  type: 'module',
  engines: { node: '>=24.12.0' },
  description:
    'Host-neutral collaboration bridge with automatic installation-key connection; no phone account required',
  bin: {
    'elsewhere-collaboration': 'elsewhere/client/collaboration-mcp.mjs',
    'elsewhere-collaboration-setup': 'elsewhere/client/collaboration-setup.mjs',
    'elsewhere-collaboration-background':
      'elsewhere/client/collaboration-background.mjs',
  },
  scripts: { start: 'node elsewhere/client/collaboration-mcp.mjs' },
  dependencies,
  files: [...sources, 'package-lock.json', 'npm-shrinkwrap.json'],
};
await writeFile(
  join(stage, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n',
);
lock.name = pkg.name;
lock.version = pkg.version;
lock.packages[''] = { ...pkg };
await writeFile(
  join(stage, 'package-lock.json'),
  JSON.stringify(lock, null, 2) + '\n',
);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run build:collaboration-plugin');
execFileSync(
  process.execPath,
  [
    npm,
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    '--no-fund',
  ],
  { cwd: stage, stdio: 'pipe' },
);
const pinned = JSON.parse(
  await readFile(join(stage, 'package-lock.json'), 'utf8'),
);
for (const [path, entry] of Object.entries(pinned.packages)) {
  if (path && entry.version !== lock.packages[path]?.version)
    throw new Error(`Dependency drift: ${path}`);
}
await copyFile(
  join(stage, 'package-lock.json'),
  join(stage, 'npm-shrinkwrap.json'),
);
execFileSync(
  process.execPath,
  [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: stage, stdio: 'pipe' },
);
const packed = JSON.parse(
  execFileSync(
    process.execPath,
    [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', out],
    { cwd: stage, encoding: 'utf8' },
  ),
);
console.log(
  JSON.stringify(
    {
      stage,
      artifact: join(out, packed[0].filename),
      sources: packed[0].files.map((f) => f.path),
    },
    null,
    2,
  ),
);
