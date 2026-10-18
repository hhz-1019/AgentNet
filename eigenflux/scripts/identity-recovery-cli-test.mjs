// Real CLI, isolated Home and HTTP fixture; no production requests or credentials.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';

const binary = process.env.AGENTNET_TEST_BINARY;
assert(binary, 'Set AGENTNET_TEST_BINARY to the verified CLI executable');
await mkdir('.agentnet-audit', { recursive: true });
const directoryRoot = await mkdtemp(resolve('.agentnet-audit/recovery-cli-'));
const home = join(directoryRoot, '.eigenflux');
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ path: req.url, body });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/v2/agent-identities/registration-challenges') {
    res
      .writeHead(201)
      .end(
        JSON.stringify({
          data: { bootstrap_grant: 'fixture-grant', nonce: 'fixture-nonce' },
        }),
      );
  } else {
    res
      .writeHead(409)
      .end(
        JSON.stringify({
          error: {
            code: 'IDENTITY_RECOVERY_REQUIRED',
            message:
              'This Agent Home is not bound to the expected identity on this server. Keep local data and review account recovery; do not retry or register a replacement without owner confirmation.',
          },
        }),
      );
  }
});
try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const run = (args) =>
    promisify(execFile)(
      binary,
      ['--homedir', home, '--format', 'json', '--no-interactive', ...args],
      {
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          EIGENFLUX_BOOTSTRAP_GRANT: '',
          EIGENFLUX_BOOTSTRAP_NONCE: '',
        },
      },
    );
  await run([
    'server',
    'add',
    '--name',
    'agentnet',
    '--endpoint',
    `http://127.0.0.1:${server.address().port}`,
  ]);
  await run(['--server', 'agentnet', 'agent', 'init']);
  const directory = join(home, 'servers', 'agentnet');
  const credentials = join(directory, 'agent-v2-credentials.json');
  await writeFile(
    credentials,
    JSON.stringify({
      agent_id: '42',
      principal_id: '16',
      access_token: 'fixture-access',
      refresh_token: 'fixture-refresh',
      expires_at: 1,
    }),
  );
  const beforeCredentials = await readFile(credentials);
  const beforeIdentity = await readFile(join(directory, 'identity.json'));
  await assert.rejects(
    run([
      '--server',
      'agentnet',
      'agent',
      'provision',
      '--require-existing-agent',
      '--agent-name',
      'Fixture',
    ]),
    (error) => {
      assert.match(error.stderr, /IDENTITY_RECOVERY_REQUIRED/);
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /owner confirmation/);
      return true;
    },
  );
  assert.deepEqual(
    requests.map((r) => r.path),
    [
      '/api/v2/agent-identities/registration-challenges',
      '/api/v2/agent-identities/provision',
    ],
  );
  assert.equal(requests[1].body.expected_agent_id, '42');
  assert.deepEqual(await readFile(credentials), beforeCredentials);
  assert.deepEqual(
    await readFile(join(directory, 'identity.json')),
    beforeIdentity,
  );
  console.log(
    'PASS: real CLI reports recovery required, makes no retry or replacement, preserves credentials and signing key byte-for-byte. HTTP is a local fixture.',
  );
} finally {
  await new Promise((done) => server.close(done));
  await rm(directoryRoot, { recursive: true, force: true });
}
