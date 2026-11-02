// Register/install a built source through Codex's native APIs; never edits config by hand.
import { cp, mkdir, readFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { codexProtocol } from './codex-plugin-protocol.mjs';
const source = resolve(process.argv[2]);
const binary = resolve(process.argv[3]);
const metadata = JSON.parse(
  await readFile(join(source, 'plugins/elsewhere/plugin.json'), 'utf8'),
);
const target = join(
  homedir(),
  '.elsewhere/plugin-sources',
  `${metadata.version}-${randomUUID()}`,
);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
const config = join(
  process.env.CODEX_HOME || join(homedir(), '.codex'),
  'config.toml',
);
await copyFile(config, `${config}.before-elsewhere-${randomUUID()}`).catch(
  (error) => {
    if (error.code !== 'ENOENT') throw error;
  },
);
const native = await codexProtocol({ binary, cwd: target });
try {
  const added = await native.request('marketplace/add', { source: target });
  const params = {
    marketplacePath: join(target, '.agents/plugins/marketplace.json'),
    pluginName: 'elsewhere',
  };
  await native.request('plugin/install', params);
  const { plugin } = await native.request('plugin/read', params);
  if (
    !plugin.summary.installed ||
    !plugin.summary.enabled ||
    !plugin.onboardingSkill
  )
    throw new Error('Native installation verification failed');
  console.log(
    JSON.stringify({
      installed: true,
      enabled: true,
      id: plugin.summary.id,
      version: plugin.summary.localVersion,
      source: target,
      marketplace: added.marketplaceName,
      onboardingSkill: plugin.onboardingSkill.name,
      toolsConfigured: plugin.mcpServers,
    }),
  );
} finally {
  await native.close();
}
