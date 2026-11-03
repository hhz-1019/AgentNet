// Compatible code-only updates at MCP startup. No host-config, credentials or runtime replacement.
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const versionNumber = (v) =>
  /^0\.0\.54-agentnet\.\d+$/.test(v || '') ? Number(v.split('.').at(-1)) : -1;
const origin = 'https://collab.gongshi.world';
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function json(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function download(url, limit, fetchImpl) {
  const u = new URL(url);
  if (
    u.origin !== origin ||
    u.username ||
    u.password ||
    !u.pathname.startsWith('/plugin/')
  )
    throw Error('Untrusted update origin');
  const response = await fetchImpl(u.href, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('Update unavailable');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('Update too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function validateUpdate(payload) {
  if (
    payload.format !== 1 ||
    payload.bootstrap !== 38 ||
    versionNumber(payload.version) < 38 ||
    !payload.files ||
    Array.isArray(payload.files)
  )
    throw Error('Incompatible update');
  const entries = Object.entries(payload.files);
  if (
    entries.length < 2 ||
    entries.length > 100 ||
    !payload.files['elsewhere/client/collaboration-plugin.mjs']
  )
    throw Error('Incomplete update');
  for (const [name, body] of entries)
    if (
      !/^elsewhere\/client\/[a-z][a-z0-9-]*\.mjs$/.test(name) ||
      name.endsWith('.test.mjs') ||
      typeof body !== 'string' ||
      Buffer.byteLength(body) > 1024 * 1024
    )
      throw Error('Unsafe update file');
  return payload;
}
export async function selectUpdate({
  root,
  userHome = homedir(),
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (
    env.AGENTNET_AUTO_UPDATE === '0' ||
    env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1'
  )
    return root;
  const config = await json(join(root, 'connection.json'));
  if ((env.AGENTNET_URL || config?.endpoint) !== origin) return root;
  const builtin = versionNumber(
    (await json(join(root, 'package.json')))?.version,
  );
  if (builtin < 38) return root;
  const cache = join(userHome, '.elsewhere/plugin-updates');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const pointer = join(cache, 'active.json');
  let active,
    selected = root;
  try {
    active = await json(pointer);
    if (
      active &&
      /^[a-f0-9]{64}$/.test(active.sha256) &&
      versionNumber(active.version) > builtin
    ) {
      const dir = join(cache, active.sha256);
      const bytes = await readFile(join(dir, 'update.json'));
      if (hash(bytes) !== active.sha256) throw Error('Cached update changed');
      const payload = validateUpdate(JSON.parse(bytes));
      if (payload.version !== active.version)
        throw Error('Cache version mismatch');
      for (const [name, content] of Object.entries(payload.files))
        if ((await readFile(join(dir, name), 'utf8')) !== content)
          throw Error('Cached code changed');
      selected = dir;
    }
  } catch {
    active = null;
  }
  let lock,
    stage,
    lockOwned = false;
  try {
    const check = await json(join(cache, 'checked.json'));
    if (check && now - check.at < 6 * 3600000 && now >= check.at)
      return selected;
    lock = join(cache, 'check.lock');
    const locked = await stat(lock).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (locked && now - locked.mtimeMs > 30 * 60 * 1000)
      await rm(lock, { recursive: true, force: true });
    await mkdir(lock); // Concurrent startups use the last good version.
    lockOwned = true;
    const manifest = JSON.parse(
      await download(origin + '/plugin/update.json', 65536, fetchImpl),
    );
    const highest = Math.max(
      builtin,
      selected === root ? builtin : versionNumber(active?.version),
    );
    if (manifest.bootstrap !== 38 || versionNumber(manifest.version) <= highest)
      return selected;
    if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) throw Error('Invalid digest');
    const bytes = await download(manifest.url, 4 * 1024 * 1024, fetchImpl);
    if (hash(bytes) !== manifest.sha256)
      throw Error('Update integrity mismatch');
    const payload = validateUpdate(JSON.parse(bytes));
    if (payload.version !== manifest.version) throw Error('Version mismatch');
    stage = join(cache, 'pending-' + randomUUID());
    await mkdir(stage);
    // Copy only the plugin's known code/dependencies. Never copy identity or host credentials.
    for (const name of [
      'node_modules',
      'elsewhere',
      'skills',
      'connection.json',
      'package.json',
    ])
      await cp(join(root, name), join(stage, name), { recursive: true });
    for (const [name, content] of Object.entries(payload.files)) {
      await mkdir(dirname(join(stage, name)), { recursive: true });
      await writeFile(join(stage, name), content, { mode: 0o600 });
    }
    const pkg = await json(join(stage, 'package.json'));
    pkg.version = payload.version;
    await writeFile(join(stage, 'package.json'), JSON.stringify(pkg));
    await writeFile(join(stage, 'update.json'), bytes, { mode: 0o600 });
    await execute(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const m=await import('./elsewhere/client/collaboration-plugin.mjs'); if(typeof m.startPlugin!=='function') process.exit(1)",
      ],
      {
        cwd: stage,
        timeout: 10000,
        windowsHide: true,
        env: { ...env, AGENTNET_AUTO_UPDATE: '0' },
      },
    );
    const target = join(cache, manifest.sha256);
    try {
      await rename(stage, target);
      stage = null;
    } catch (e) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e.code)) throw e;
      throw Error('Update directory already exists; keep previous version');
    }
    const temp = pointer + '.' + randomUUID();
    await writeFile(
      temp,
      JSON.stringify({ version: payload.version, sha256: manifest.sha256 }),
      { mode: 0o600 },
    );
    await rename(temp, pointer);
    selected = target;
  } catch {
    /* Offline, incompatible or invalid update: retain known good implementation. */
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    // Delete only a lock this process successfully acquired (see acquisition flag below).
    if (lockOwned) {
      await writeFile(
        join(cache, 'checked.json'),
        JSON.stringify({ at: now }),
        { mode: 0o600 },
      ).catch(() => {});
      await rm(lock, { recursive: true, force: true });
    }
  }
  return selected;
}
