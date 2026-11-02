#!/usr/bin/env node
// Local installation only. Never provisions a replacement identity or grants execution.
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  access,
  rename,
  readdir,
  realpath,
} from 'node:fs/promises';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
async function save(path, text) {
  await mkdir(dirname(path), { recursive: true });
  if (await exists(path))
    await copyFile(path, `${path}.backup-${randomUUID()}`);
  const pending = `${path}.${randomUUID()}.tmp`;
  await writeFile(pending, text, { mode: 0o600, flag: 'wx' });
  await rename(pending, path);
}
export async function findCodex(env = process.env) {
  for (const dir of (env.PATH || '').split(delimiter)) {
    for (const path of [
      join(dir, 'codex.exe'),
      join(dir, 'node_modules/@openai/codex/bin/codex.js'),
      ...(process.platform === 'win32' ? [] : [join(dir, 'codex')]),
    ]) {
      if (await exists(path)) return path;
    }
  }
  throw new Error('请先安装 Codex CLI，再重新运行安装。已有身份不会改变。');
}
export async function setup({
  host = 'codex',
  endpoint,
  cli,
  home,
  root = homedir(),
  codexHome,
  hostBinary,
  node = process.execPath,
  run = execFileSync,
}) {
  if (!['codex', 'claude-code', 'generic'].includes(host))
    throw new Error('支持 codex、claude-code 或 generic MCP 配置。');
  const origin = new URL(endpoint);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('服务地址必须是 HTTPS origin。');
  cli = resolve(cli);
  home = resolve(
    home ||
      join(
        root,
        host === 'codex'
          ? '.elsewhere-collaboration-codex'
          : host === 'claude-code'
            ? '.elsewhere-collaboration-claude'
            : '.elsewhere-collaboration',
        '.elsewhere',
      ),
  );
  await access(cli);
  const version = JSON.parse(
    run(cli, ['version'], { encoding: 'utf8', windowsHide: true }),
  );
  if (version.cli_version !== '0.0.54-agentnet.29')
    throw new Error('需要配套的 Elsewhere CLI .29；请使用完整安装包。');
  // Refuse an endpoint change on an existing Home. Native CLI retains all credentials.
  const common = ['--homedir', home, '--format', 'json', '--no-interactive'];
  const hasConfig = await exists(join(home, 'config.json'));
  if (
    !hasConfig &&
    (await exists(join(home, 'servers'))) &&
    (await readdir(join(home, 'servers'))).length
  )
    throw new Error('已有身份缺少连接配置，请恢复原配置后重试。');
  const servers = JSON.parse(
    run(cli, [...common, 'server', 'list'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  const existing = servers.find((s) => s.name === 'agentnet');
  const mismatch =
    existing && new URL(existing.endpoint).origin !== origin.origin;
  if (mismatch && hasConfig)
    throw new Error('已有身份属于另一服务，请使用原服务地址。');
  if (!existing || mismatch)
    run(
      cli,
      [
        ...common,
        'server',
        existing ? 'update' : 'add',
        '--name',
        'agentnet',
        '--endpoint',
        origin.origin,
        '--stream-endpoint',
        origin.origin.replace('https:', 'wss:'),
      ],
      { stdio: 'pipe', windowsHide: true },
    );
  const config = {
    command: node,
    args: [join(here, 'collaboration-mcp.mjs')],
    env: {
      AGENTNET_CLI: cli,
      AGENTNET_HOME: home,
      AGENTNET_URL: origin.origin,
      AGENTNET_IDENTITY_MODE: 'installation',
    },
  };
  const targetCodexHome =
    codexHome || process.env.CODEX_HOME || join(root, '.codex');
  let destination;
  let nativeHost;
  if (host === 'codex') {
    const binary = hostBinary || (await findCodex());
    nativeHost = await realpath(binary);
    await mkdir(targetCodexHome, { recursive: true });
    const args = [
      'mcp',
      'add',
      'elsewhere_collaboration',
      ...Object.entries(config.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
      '--',
      node,
      ...config.args,
    ];
    const configPath = join(targetCodexHome, 'config.toml');
    if (await exists(configPath))
      await copyFile(configPath, `${configPath}.backup-${randomUUID()}`);
    run(
      binary.endsWith('.js') ? node : binary,
      binary.endsWith('.js') ? [binary, ...args] : args,
      {
        env: { ...process.env, CODEX_HOME: targetCodexHome },
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    destination = configPath;
  } else {
    destination = join(
      root,
      host === 'claude-code' ? '.claude.json' : '.elsewhere/mcp.json',
    );
    const previous = (await exists(destination))
      ? JSON.parse(await readFile(destination, 'utf8'))
      : {};
    if (
      previous.mcpServers &&
      (typeof previous.mcpServers !== 'object' ||
        Array.isArray(previous.mcpServers))
    )
      throw new Error('现有 MCP 配置格式不正确，已保留。');
    previous.mcpServers = {
      ...previous.mcpServers,
      elsewhere_collaboration: { ...config, type: 'stdio' },
    };
    await save(destination, JSON.stringify(previous, null, 2) + '\n');
  }
  const skillsRoot =
    host === 'codex'
      ? join(targetCodexHome, 'skills')
      : host === 'claude-code'
        ? join(root, '.claude/skills')
        : join(root, '.elsewhere/skills');
  const connectionFile = join(
    root,
    '.elsewhere',
    'connections',
    host + '.json',
  );
  await save(
    connectionFile,
    JSON.stringify(
      { host, hostBinary: nativeHost, cli, home, endpoint: origin.origin },
      null,
      2,
    ) + '\n',
  );
  for (const resource of [
    'agentnet-collaboration/SKILL.md',
  ]) {
    let skill = await readFile(join(here, '../skills', resource), 'utf8');
    if (resource === 'agentnet-collaboration/SKILL.md')
      skill +=
        '\n## Installed connection\n\nUse this local connection for onboarding and collaboration. Do not send these local paths to a peer.\n```json\n' +
        JSON.stringify(
          {
            ...config.env,
            background_command: [
              node,
              join(here, 'collaboration-enable.mjs'),
              '--connection',
              connectionFile,
            ],
          },
          null,
          2,
        ) +
        '\n```\n\nCall elsewhere_connection status to connect automatically and obtain your short ID. No account registration, phone verification or profile draft is required. Do not enable social patrols or publish social activity.\n';
    await save(join(skillsRoot, resource), skill);
  }
  return {
    host,
    home,
    configuration: destination,
    readyForRegistration: false,
    automaticConnection: true,
    backgroundEnabled: false,
    next: '重新打开宿主对话，说：通过 Elsewhere 和 @对方短号一起完成一个任务。插件自动连接，无需注册或手机号。',
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      if (
        ![
          '--host',
          '--endpoint',
          '--cli',
          '--home',
          '--root',
          '--codexHome',
          '--hostBinary',
        ].includes(key) ||
        !process.argv[i + 1]
      )
        throw new Error(
          '参数：--host codex --endpoint HTTPS地址 --cli 配套CLI路径',
        );
      args[key.slice(2)] = process.argv[i + 1];
    }
    console.log(JSON.stringify(await setup(args), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
