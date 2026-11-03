// Resolve only this owner's same-host connection. Never scan other users or hosts.
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import {
  createPrivateKey,
  createPublicKey,
  createHash,
  randomUUID,
} from 'node:crypto';
const optional = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
export async function resolveCollaborationHome({
  root,
  host = 'codex',
  home,
  endpoint,
  env = {},
}) {
  const legacy = host === 'claude_code' ? 'claude-code' : host;
  const recordFile = join(root, '.elsewhere/connections', legacy + '.json');
  const record = await optional(recordFile);
  const primary = resolve(
    home || record?.home || join(root, '.elsewhere-collaboration', host),
  );
  if (record?.endpoint && record.endpoint !== endpoint && !home)
    throw Error('Existing connection belongs to another service; preserved.');
  const candidates = new Set([primary]);
  const discover =
    !home ||
    [record?.home, ...(record?.previous_homes || [])].some(
      (p) => typeof p === 'string' && resolve(p) === primary,
    );
  if (discover) {
    candidates.add(resolve(root, '.elsewhere/recovery', host));
    candidates.add(resolve(root, '.elsewhere-collaboration', host));
    const suffix = host === 'claude_code' ? 'claude' : host;
    candidates.add(
      resolve(root, '.elsewhere-collaboration-' + suffix, '.elsewhere'),
    );
  }
  // Configured paths are authoritative recovery hints, not arbitrary disk scans.
  if (discover && host === 'codex') {
    try {
      const config = await readFile(
        join(env.CODEX_HOME || join(root, '.codex'), 'config.toml'),
        'utf8',
      );
      for (const section of config.split(/(?=^\[)/m)) {
        if (
          !/^\[mcp_servers\.(?:"?elsewhere(?:_collaboration)?"?)\.env\]/.test(
            section,
          )
        )
          continue;
        const value =
          /^AGENTNET_HOME\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/m.exec(
            section,
          )?.[1];
        if (value)
          candidates.add(
            resolve(
              value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1),
            ),
          );
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  if (discover && ['claude_code', 'opencode'].includes(host)) {
    const file =
      host === 'claude_code'
        ? env.CLAUDE_CONFIG_DIR
          ? join(env.CLAUDE_CONFIG_DIR, '.claude.json')
          : join(root, '.claude.json')
        : join(
            env.OPENCODE_CONFIG_DIR ||
              join(env.XDG_CONFIG_HOME || join(root, '.config'), 'opencode'),
            'opencode.json',
          );
    const configuration = await optional(file);
    for (const name of ['elsewhere', 'elsewhere_collaboration']) {
      const server =
        configuration?.mcpServers?.[name] || configuration?.mcp?.[name];
      const configuredHome =
        server?.env?.AGENTNET_HOME || server?.environment?.AGENTNET_HOME;
      if (typeof configuredHome === 'string')
        candidates.add(resolve(configuredHome));
    }
  }
  const matches = [];
  let prior = Boolean(record && discover && !record.identity_pending),
    expected = discover ? record?.identity : undefined;
  for (const path of candidates) {
    const info = await optional(join(path, 'collaboration-identity.json'));
    const key = await optional(join(path, 'collaboration-key.json'));
    if (info || key) prior = true;
    if (path === primary && info) expected = info;
    if (path === primary && info?.endpoint && info.endpoint !== endpoint)
      throw Error('Existing identity belongs to another endpoint; preserved.');
    if (!key) continue;
    if (key.endpoint !== endpoint) {
      if (path === primary)
        throw Error('Original identity endpoint changed; preserved.');
      continue;
    }
    const privateKey = createPrivateKey(key.private_key);
    if (key.version !== 1 || privateKey.asymmetricKeyType !== 'ed25519')
      throw Error('Invalid existing key; preserved.');
    const fingerprint = createHash('sha256')
      .update(
        Buffer.from(
          createPublicKey(privateKey).export({ format: 'jwk' }).x,
          'base64url',
        ),
      )
      .digest('hex');
    if (
      info &&
      (info.endpoint !== endpoint || info.key_fingerprint !== fingerprint)
    )
      throw Error('Existing identity/key mismatch; preserved.');
    matches.push({ path, fingerprint, info });
  }
  const eligible = expected?.key_fingerprint
    ? matches.filter((m) => m.fingerprint === expected.key_fingerprint)
    : matches;
  const direct = eligible.find((m) => m.path === primary);
  if (
    direct &&
    (home || record || new Set(eligible.map((m) => m.fingerprint)).size === 1)
  )
    return direct.path;
  if (new Set(eligible.map((m) => m.fingerprint)).size > 1)
    throw Error(
      'Multiple original identities found; selection required, nothing changed.',
    );
  if (eligible.length) return eligible[0].path;
  if (prior)
    throw Error(
      'Original identity key is unavailable; no replacement created.',
    );
  // Explicit isolated homes may provision their own identity, never borrow another.
  return primary;
}

export async function rememberCollaborationHome({
  root,
  host,
  home,
  endpoint,
  identity,
}) {
  const file = join(
    root,
    '.elsewhere/connections',
    (host === 'claude_code' ? 'claude-code' : host) + '.json',
  );
  const old = await optional(file);
  const info =
    identity || (await optional(join(home, 'collaboration-identity.json')));
  if (info) {
    const backup = join(root, '.elsewhere/recovery', host);
    await mkdir(backup, { recursive: true, mode: 0o700 });
    for (const name of [
      'collaboration-key.json',
      'collaboration-identity.json',
      'collaboration-notifications/config.json',
    ]) {
      const source = join(home, name),
        target = join(backup, name);
      if (resolve(source) === resolve(target)) continue;
      try {
        const content = await readFile(source);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        const pending = target + '.' + randomUUID();
        await writeFile(pending, content, { mode: 0o600, flag: 'wx' });
        await rename(pending, target);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(
    temp,
    JSON.stringify(
      {
        ...old,
        host,
        home,
        previous_homes: [
          ...new Set([
            ...(old?.previous_homes || []),
            ...(old?.home && old.home !== home ? [old.home] : []),
          ]),
        ].slice(-8),
        endpoint,
        identity_pending: !info && !old?.identity,
        ...(info ? { identity: info } : {}),
      },
      null,
      2,
    ),
    { mode: 0o600, flag: 'wx' },
  );
  await rename(temp, file);
}
