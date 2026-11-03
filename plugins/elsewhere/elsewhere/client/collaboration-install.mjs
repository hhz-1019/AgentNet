import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rename,
  access,
} from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { normalizeHost, detectRuntime } from './collaboration-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const exists = async (p) =>
  access(p).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  if (await exists(path))
    await copyFile(path, `${path}.backup-${randomUUID()}`);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, value, { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
const invocation = (binary, args, node) =>
  /\.(mjs|cjs|js)$/i.test(binary) ? [node, [binary, ...args]] : [binary, args];
export function currentHost(explicit, env = process.env) {
  if (explicit && explicit !== 'auto') return normalizeHost(explicit);
  if (env.AGENTNET_HOST_KIND) return normalizeHost(env.AGENTNET_HOST_KIND);
  const signals = [
    env.CODEX_THREAD_ID ? 'codex' : null,
    env.CLAUDECODE ? 'claude_code' : null,
    env.OPENCODE_SESSION_ID ? 'opencode' : null,
  ].filter(Boolean);
  if (signals.length === 1) return signals[0];
  throw new Error(
    'Cannot identify the current Agent reliably. The installing Agent must pass --host codex, claude-code, opencode or generic.',
  );
}
export async function install({
  host = 'auto',
  root = homedir(),
  home,
  endpoint = 'https://collab.gongshi.world',
  hostBinary,
  node = process.execPath,
  env = process.env,
  run = execFileSync,
} = {}) {
  const kind = currentHost(host, env),
    origin = new URL(endpoint);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== endpoint ||
    origin.username ||
    origin.password
  )
    throw new Error('Installation endpoint must be an HTTPS origin.');
  root = resolve(root);
  home = resolve(home || join(root, '.elsewhere-collaboration', kind));
  const binary =
    kind === 'generic'
      ? null
      : await detectRuntime(kind, hostBinary, { env, home: root });
  const mcp = {
    command: node,
    args: [join(here, 'collaboration-plugin.mjs')],
    env: {
      AGENTNET_HOME: home,
      AGENTNET_URL: endpoint,
      AGENTNET_HOST_KIND: kind,
      ...(binary ? { AGENTNET_HOST_BINARY: binary } : {}),
    },
  };
  // Existing identity files are never rewritten or migrated by installation.
  const identity = join(home, 'collaboration-identity.json');
  if (await exists(identity)) {
    const info = JSON.parse(await readFile(identity, 'utf8'));
    if (info.endpoint && new URL(info.endpoint).origin !== origin.origin)
      throw new Error(
        'Existing identity belongs to another endpoint; installation preserved it.',
      );
  }
  let configuration;
  const execute = (args, extra = {}) => {
    const [command, argv] = invocation(binary, args, node);
    return run(command, argv, {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 60000,
      env,
      ...extra,
    });
  };
  if (kind === 'codex') {
    const codexHome = env.CODEX_HOME || join(root, '.codex');
    configuration = join(codexHome, 'config.toml');
    await mkdir(codexHome, { recursive: true });
    if (await exists(configuration))
      await copyFile(configuration, `${configuration}.backup-${randomUUID()}`);
    execute(
      [
        'mcp',
        'add',
        'elsewhere',
        ...Object.entries(mcp.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
        '--',
        node,
        ...mcp.args,
      ],
      { env: { ...env, CODEX_HOME: codexHome } },
    );
  } else if (kind === 'claude_code') {
    configuration = env.CLAUDE_CONFIG_DIR
      ? join(env.CLAUDE_CONFIG_DIR, '.claude.json')
      : join(root, '.claude.json');
    const previous = (await exists(configuration))
      ? JSON.parse(await readFile(configuration, 'utf8'))
      : {};
    if (
      previous.mcpServers &&
      (Array.isArray(previous.mcpServers) ||
        typeof previous.mcpServers !== 'object')
    )
      throw new Error(
        'Invalid existing MCP configuration; preserved unchanged.',
      );
    previous.mcpServers = {
      ...previous.mcpServers,
      elsewhere: { type: 'stdio', ...mcp },
    };
    await save(configuration, JSON.stringify(previous, null, 2) + '\n');
  } else if (kind === 'opencode') {
    const version = execute(['--version']).trim();
    const major = Number(/(?:^|v|\s)(\d+)\./.exec(version)?.[1]);
    if (![1, 2].includes(major))
      throw new Error(
        'Unrecognized OpenCode version; configuration preserved.',
      );
    const configRoot = env.XDG_CONFIG_HOME || join(root, '.config');
    const nativeConfigRoot =
      env.OPENCODE_CONFIG_DIR || join(configRoot, 'opencode');
    configuration = join(nativeConfigRoot, 'opencode.json');
    if (major === 2) {
      if (await exists(join(nativeConfigRoot, 'opencode.jsonc')))
        configuration = join(nativeConfigRoot, 'opencode.jsonc');
      execute(
        [
          'mcp',
          'add',
          'elsewhere',
          '--global',
          ...Object.entries(mcp.env).flatMap(([k, v]) => [
            '--env',
            `${k}=${v}`,
          ]),
          '--',
          node,
          ...mcp.args,
        ],
        { env: { ...env, XDG_CONFIG_HOME: configRoot } },
      );
    } else {
      // V1 does not have V2's noninteractive add contract. Preserve JSONC rather
      // than creating a conflicting second configuration with different precedence.
      if (await exists(join(configRoot, 'opencode', 'opencode.jsonc')))
        throw new Error(
          'OpenCode V1 JSONC requires host-managed merge; use exported generic MCP configuration. No config was changed.',
        );
      const previous = (await exists(configuration))
        ? JSON.parse(await readFile(configuration, 'utf8'))
        : {};
      if (
        previous.mcp &&
        (Array.isArray(previous.mcp) || typeof previous.mcp !== 'object')
      )
        throw new Error(
          'Invalid existing OpenCode MCP configuration; preserved.',
        );
      previous.mcp = {
        ...previous.mcp,
        elsewhere: {
          type: 'local',
          command: [node, ...mcp.args],
          environment: mcp.env,
          enabled: true,
        },
      };
      await save(configuration, JSON.stringify(previous, null, 2) + '\n');
    }
  } else {
    configuration = join(root, '.elsewhere', 'mcp-export.json');
    await save(
      configuration,
      JSON.stringify(
        { mcpServers: { elsewhere: { type: 'stdio', ...mcp } } },
        null,
        2,
      ) + '\n',
    );
  }
  const skillRoot =
    kind === 'codex'
      ? join(env.CODEX_HOME || join(root, '.codex'), 'skills')
      : kind === 'claude_code'
        ? join(env.CLAUDE_CONFIG_DIR || join(root, '.claude'), 'skills')
        : kind === 'opencode'
          ? join(
              env.OPENCODE_CONFIG_DIR ||
                join(env.XDG_CONFIG_HOME || join(root, '.config'), 'opencode'),
              'skills',
            )
          : join(root, '.elsewhere', 'skills');
  const skill = await readFile(
    join(here, '../skills/agentnet-collaboration/SKILL.md'),
    'utf8',
  );
  await save(
    join(skillRoot, 'agentnet-collaboration/SKILL.md'),
    skill +
      `\n\nInstalled host: ${kind}. Use this host's MCP tools; never substitute Codex for another host. Generic hosts have foreground MCP only.\n`,
  );
  return {
    installed: kind !== 'generic',
    exported: kind === 'generic',
    host: kind,
    configuration,
    home,
    backgroundEnabled: false,
    next:
      kind === 'generic'
        ? 'Import the exported MCP server into your host. No background adapter is claimed.'
        : 'Reload host tools once; call elsewhere_connection status to obtain the short ID. Starting a project authorizes only this host. OpenCode background currently requires Windows, V2 ACP and an explicit local model.',
  };
}
export async function installFromArguments(argv) {
  const options = {};
  const names = {
    '--host': 'host',
    '--root': 'root',
    '--home': 'home',
    '--endpoint': 'endpoint',
    '--host-binary': 'hostBinary',
  };
  for (let i = 0; i < argv.length; i += 2) {
    if (!names[argv[i]] || !argv[i + 1])
      throw new Error(
        'Usage: runtime/launch install --host codex|claude-code|opencode|generic',
      );
    options[names[argv[i]]] = argv[i + 1];
  }
  console.log(JSON.stringify(await install(options), null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await installFromArguments(process.argv.slice(2));
