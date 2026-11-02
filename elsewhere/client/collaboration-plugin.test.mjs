import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerConnection } from './collaboration-plugin.mjs';
import { InstallationClient } from './collaboration-identity.mjs';

await test('connection is automatic and exposes only a shareable identity', async () => {
  let call;
  registerConnection(
    {
      registerTool(_n, _s, fn) {
        call = fn;
      },
    },
    {
      async connect() {
        return {
          state: 'connected',
          agent_id: '7',
          short_id: 'Abc12',
          identity_kind: 'installation_key',
        };
      },
    },
  );
  const result = await call({ action: 'status' });
  const value = JSON.parse(result.content[0].text);
  assert.equal(value.state, 'connected');
  assert.equal(value.short_id, 'Abc12');
  assert.equal(value.console_url, undefined);
});
await test('errors do not offer replacement registration or leak diagnostics', async () => {
  let call;
  registerConnection(
    {
      registerTool(_n, _s, fn) {
        call = fn;
      },
    },
    {
      async connect() {
        throw Error('private secret');
      },
    },
  );
  const result = await call({ action: 'prepare' });
  assert.equal(result.isError, true);
  assert.ok(!JSON.stringify(result).includes('private secret'));
});
await test('concurrent first use saves one durable key; retries and endpoint changes preserve it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'elsewhere-installation-'));
  const options = {
    home,
    endpoint: 'https://example.test',
    fetchImpl: async () => {
      throw Error('offline');
    },
  };
  const a = new InstallationClient(options),
    b = new InstallationClient(options);
  await Promise.all([a.loadKey(), b.loadKey()]);
  assert.equal(a.publicKey, b.publicKey);
  const before = await readFile(join(home, 'collaboration-key.json'), 'utf8');
  await assert.rejects(a.connect());
  await assert.rejects(a.connect());
  await assert.rejects(
    new InstallationClient({
      ...options,
      endpoint: 'https://other.test',
    }).connect(),
  );
  assert.equal(
    await readFile(join(home, 'collaboration-key.json'), 'utf8'),
    before,
  );
});
await test('HTTP and embedded credentials cannot receive plugin keys', () => {
  for (const endpoint of [
    'http://remote.test',
    'https://user:password@example.test',
    'https://example.test/path',
  ])
    assert.throws(() => new InstallationClient({ home: tmpdir(), endpoint }));
});

await test('a replaced valid key fails before network enrollment', async () => {
  const home = await mkdtemp(join(tmpdir(), 'elsewhere-key-'));
  const other = await mkdtemp(join(tmpdir(), 'elsewhere-other-key-'));
  let requests = 0;
  const options = {
    home,
    endpoint: 'https://example.test',
    fetchImpl: async () => {
      requests++;
      throw Error('unexpected network');
    },
  };
  const a = new InstallationClient(options),
    b = new InstallationClient({ ...options, home: other });
  await a.loadKey();
  await b.loadKey();
  await writeFile(
    join(home, 'collaboration-identity.json'),
    JSON.stringify({
      agent_id: '1',
      endpoint: a.endpoint,
      key_fingerprint: a.fingerprint,
    }),
  );
  await copyFile(
    join(other, 'collaboration-key.json'),
    join(home, 'collaboration-key.json'),
  );
  await assert.rejects(a.connect());
  assert.equal(requests, 0);
});

await test('version conflict retains definite-rejection semantics for background receipts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'elsewhere-error-'));
  let status = 409;
  const client = new InstallationClient({
    home,
    endpoint: 'https://example.test',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ error: { code: 'COLLABORATION_VERSION_CONFLICT' } }),
        { status },
      ),
  });
  await client.loadKey();
  await assert.rejects(
    client.request('/api/v2/plugin/collaboration/project', {}),
    (e) => e.status === 409 && e.apiCode === 'COLLABORATION_VERSION_CONFLICT',
  );
  status = 502;
  await assert.rejects(
    client.request('/api/v2/plugin/collaboration/project', {}),
    (e) => e.status === 502 && !e.apiCode,
  );
});
