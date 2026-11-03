import { realpath, stat, readdir, mkdir } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const hostKinds = ['codex', 'claude_code', 'opencode'];
export function normalizeHost(value) {
  const kind = value === 'claude-code' ? 'claude_code' : value;
  if (![...hostKinds, 'generic'].includes(kind))
    throw new Error(
      'Specify the current host: codex, claude-code, opencode or generic.',
    );
  return kind;
}
export async function detectRuntime(
  kind,
  explicit,
  { env = process.env, platform = process.platform, home = homedir() } = {},
) {
  kind = normalizeHost(kind);
  if (kind === 'generic')
    throw new Error(
      'This host supports foreground MCP only; no native background adapter is configured.',
    );
  const file = async (path) => {
    if (!path || /\.(?:cmd|bat|ps1)$/i.test(path)) return null;
    try {
      return (await stat(path)).isFile() ? await realpath(path) : null;
    } catch {
      return null;
    }
  };
  if (explicit) {
    const result = await file(resolve(explicit));
    if (!result)
      throw new Error(
        'Host binary must be an existing executable or JavaScript entry, not a shell shim.',
      );
    return result;
  }
  const command = kind === 'claude_code' ? 'claude' : kind;
  const candidates = [
    env[`AGENTNET_${kind.toUpperCase()}_BINARY`],
    ...(kind === 'claude_code' ? [env.AGENTNET_CLAUDE_BINARY] : []),
  ];
  if (kind === 'codex' && platform === 'win32' && env.LOCALAPPDATA) {
    const root = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const dirs = await readdir(root).catch(() => []);
    const versions = await Promise.all(
      dirs.map(async (d) => ({
        path: join(root, d, 'codex.exe'),
        time: await stat(join(root, d, 'codex.exe'))
          .then((s) => s.mtimeMs)
          .catch(() => 0),
      })),
    );
    candidates.push(
      ...versions.sort((a, b) => b.time - a.time).map((v) => v.path),
    );
  }
  for (const dir of [
    ...(env.PATH || '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]) {
    if (!dir) continue;
    candidates.push(join(dir, command + (platform === 'win32' ? '.exe' : '')));
    if (kind === 'codex')
      candidates.push(join(dir, 'node_modules/@openai/codex/bin/codex.js'));
    if (kind === 'claude_code')
      candidates.push(
        join(dir, 'node_modules/@anthropic-ai/claude-code/cli.js'),
      );
    if (kind === 'opencode' && platform === 'win32')
      candidates.push(
        join(dir, 'node_modules/@opencode/cli-windows-x64/bin/opencode.exe'),
      );
  }
  if (kind === 'codex')
    candidates.push(
      '/Applications/Codex.app/Contents/Resources/codex',
      join(home, 'Applications/Codex.app/Contents/Resources/codex'),
    );
  for (const candidate of candidates) {
    const result = await file(candidate);
    if (result) return result;
  }
  throw new Error(
    `${command} runtime not found. Provide this host's executable; another host will not be substituted.`,
  );
}
export async function automationHost(args, client, directory) {
  const kind = normalizeHost(
    args.host_kind ||
      client.hostKind ||
      process.env.AGENTNET_HOST_KIND ||
      'generic',
  );
  if (client.hostKind && kind !== client.hostKind)
    throw new Error('Automation host must match this installed host.');
  const binary = await detectRuntime(
    kind,
    args.host_binary || client.hostBinary || process.env.AGENTNET_HOST_BINARY,
  );
  if (kind === 'opencode') {
    const version = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    if (!/(?:^|\s|v)2\./.test(version))
      throw new Error(
        'OpenCode background requires the V2 ACP adapter. V1 retains foreground MCP.',
      );
    // The isolated ACP adapter currently supports an explicitly selected local provider.
    const model = args.model || process.env.AGENTNET_OPENCODE_MODEL;
    const baseURL = args.model_base_url || process.env.AGENTNET_OPENCODE_URL;
    if (!/^elsewhere-local\/[a-zA-Z0-9._:-]+$/.test(model || '') || !baseURL)
      throw new Error(
        'OpenCode background requires an explicit elsewhere-local/model and loopback model_base_url. No model is silently substituted.',
      );
    const url = new URL(baseURL);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.pathname !== '/v1' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('OpenCode model endpoint must be explicit loopback /v1.');
    if (process.platform !== 'win32')
      throw new Error(
        'OpenCode foreground is supported; this isolated background adapter is currently verified on Windows only.',
      );
    const runtimeHome = join(directory, 'opencode-runtime');
    await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
    return {
      kind,
      binary,
      model,
      baseURL,
      runtimeHome: await realpath(runtimeHome),
      temperature: 0,
    };
  }
  if (args.model_base_url)
    throw new Error('model_base_url is only for the local OpenCode adapter.');
  return {
    kind,
    binary,
    ...(args.model ? { model: args.model } : {}),
    ...(kind === 'claude_code' && process.env.CLAUDE_CODE_GIT_BASH_PATH
      ? { bashPath: await realpath(process.env.CLAUDE_CODE_GIT_BASH_PATH) }
      : {}),
  };
}
