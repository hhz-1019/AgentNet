import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { InstallationClient } from './collaboration-identity.mjs';
import {
  resolveCollaborationHome,
  rememberCollaborationHome,
} from './collaboration-home.mjs';
import { selectUpdate, validateUpdate } from './collaboration-update.mjs';
import {
  resumeNotifications,
  configureNotifications,
} from './collaboration-notifications.mjs';
const endpoint = 'https://collab.gongshi.world';
async function fixture(root, home) {
  const client = new InstallationClient({ home, endpoint });
  await client.loadKey();
  const info = {
    agent_id: '123',
    short_id: 'Abc12',
    endpoint,
    key_fingerprint: client.fingerprint,
  };
  await writeFile(
    join(home, 'collaboration-identity.json'),
    JSON.stringify(info),
  );
  return { client, info };
}
await test('native upgrade discovers legacy home without creating a new identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-home-'));
  const home = join(root, '.elsewhere-collaboration-codex/.elsewhere');
  await fixture(root, home);
  assert.equal(
    await resolveCollaborationHome({ root, host: 'codex', endpoint }),
    home,
  );
});
await test('stale record recovers known home, backs up identity and notification, survives directory loss', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-backup-'));
  const home = join(root, '.elsewhere-collaboration/codex');
  const { client } = await fixture(root, home);
  await mkdir(join(home, 'collaboration-notifications'));
  await writeFile(
    join(home, 'collaboration-notifications/config.json'),
    JSON.stringify({
      enabled: true,
      home,
      endpoint,
      identity: '123',
      deliveryMode: 'host_heartbeat',
      automationId: 'real-host-id',
      threadId: '69c27977-17b9-43ae-8ca4-38d506d8cb46',
    }),
  );
  await rememberCollaborationHome({
    root,
    host: 'codex',
    home: join(root, 'missing'),
    endpoint,
  });
  assert.equal(
    await resolveCollaborationHome({ root, host: 'codex', endpoint }),
    home,
  );
  await rememberCollaborationHome({ root, host: 'codex', home, endpoint });
  await rm(home, { recursive: true });
  const recovered = await resolveCollaborationHome({
    root,
    host: 'codex',
    endpoint,
  });
  const restored = new InstallationClient({ home: recovered, endpoint });
  await restored.loadKey();
  assert.equal(restored.fingerprint, client.fingerprint);
  restored.connect = async () => {
    restored.ready = true;
    restored.identity = { agent_id: '123' };
  };
  await resumeNotifications(restored);
  const status = await configureNotifications(restored, {
    action: 'notification_status',
  });
  assert.equal(status.enabled, true);
  assert.equal(status.thread_id, '69c27977-17b9-43ae-8ca4-38d506d8cb46');
  const binding = JSON.parse(
    await readFile(join(recovered, 'collaboration-notifications/config.json')),
  );
  assert.equal(binding.home, recovered);
  assert.equal(binding.automationId, 'real-host-id');
  await rememberCollaborationHome({
    root,
    host: 'codex',
    home: recovered,
    endpoint,
  });
  assert.equal(
    await resolveCollaborationHome({ root, host: 'codex', home, endpoint }),
    recovered,
    'old explicit MCP path keeps resolving after a second restart',
  );
});
await test('missing original key fails closed; explicit isolated home never borrows another identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-missing-'));
  await rememberCollaborationHome({
    root,
    host: 'codex',
    home: join(root, 'lost'),
    endpoint,
  });
  await writeFile(
    join(root, '.elsewhere/connections/codex.json'),
    JSON.stringify({ home: join(root, 'lost'), endpoint }),
  );
  await assert.rejects(
    resolveCollaborationHome({ root, host: 'codex', endpoint }),
    /unavailable/,
  );
  const isolated = join(root, 'isolated');
  assert.equal(
    await resolveCollaborationHome({
      root,
      host: 'codex',
      home: isolated,
      endpoint,
    }),
    isolated,
  );
});
await test('multiple unbound identities and mismatched keys are never guessed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-conflict-'));
  await fixture(root, join(root, '.elsewhere-collaboration-codex/.elsewhere'));
  await fixture(root, join(root, '.elsewhere/recovery/codex'));
  await assert.rejects(
    resolveCollaborationHome({ root, host: 'codex', endpoint }),
    /Multiple/,
  );
});
async function updateFixture() {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-package-')),
    userHome = await mkdtemp(join(tmpdir(), 'upgrade-cache-'));
  for (const name of ['node_modules', 'elsewhere/client', 'skills'])
    await mkdir(join(root, name), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module', version: '0.0.54-agentnet.38' }),
  );
  await writeFile(join(root, 'connection.json'), JSON.stringify({ endpoint }));
  const payload = {
    format: 1,
    bootstrap: 38,
    version: '0.0.54-agentnet.39',
    files: {
      'elsewhere/client/collaboration-plugin.mjs':
        'export async function startPlugin() {}',
      'elsewhere/client/example.mjs': 'export const value = 39;',
    },
  };
  const bytes = Buffer.from(JSON.stringify(payload)),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    bootstrap: 38,
    version: payload.version,
    sha256,
    url: endpoint + '/plugin/code.json',
  };
  const fetchImpl = async (url) =>
    new Response(
      url.endsWith('/update.json') ? JSON.stringify(manifest) : bytes,
    );
  return { root, userHome, env: {}, payload, bytes, manifest, fetchImpl };
}
await test('automatic startup update activates verified code, caches offline and detects tampering', async () => {
  const f = await updateFixture();
  const selected = await selectUpdate(f);
  assert.notEqual(selected, f.root);
  assert.equal(
    await readFile(join(selected, 'elsewhere/client/example.mjs'), 'utf8'),
    f.payload.files['elsewhere/client/example.mjs'],
  );
  const offline = {
    ...f,
    fetchImpl: async () => {
      throw Error('offline');
    },
  };
  assert.equal(await selectUpdate(offline), selected);
  await writeFile(join(selected, 'elsewhere/client/example.mjs'), 'changed');
  assert.equal(await selectUpdate(offline), f.root);
});
await test('bad checksum, foreign origin, disabled updates and network failure retain bundled code', async () => {
  for (const mode of ['digest', 'url', 'offline', 'disabled']) {
    const f = await updateFixture();
    if (mode === 'digest') f.manifest.sha256 = '0'.repeat(64);
    if (mode === 'url')
      f.manifest.url = 'https://example.test/plugin/code.json';
    if (mode === 'offline')
      f.fetchImpl = async () => {
        throw Error('offline');
      };
    if (mode === 'disabled') f.env = { AGENTNET_AUTO_UPDATE: '0' };
    assert.equal(await selectUpdate(f), f.root);
  }
});
await test('update payload cannot change identity, host configuration, dependencies or escape its directory', () => {
  for (const name of [
    '../auth.json',
    'elsewhere/client/../../key.mjs',
    'node_modules/zod/index.mjs',
    'elsewhere/client/.hidden.mjs',
  ]) {
    assert.throws(() =>
      validateUpdate({
        format: 1,
        bootstrap: 38,
        version: '0.0.54-agentnet.39',
        files: { 'elsewhere/client/collaboration-plugin.mjs': '', [name]: '' },
      }),
    );
  }
});
