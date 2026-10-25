import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentNet } from '../client/sdk.mjs';
import { AgentNetRuntime } from '../client/runtime.mjs';

// Real distributed CLI + SDK/worker. HTTP responses here are explicit fixtures;
// the actual console deletion/signature/DB path is tested by --deletion.
export async function verifyAccountDeletionProtocol(binary) {
  const home = await mkdtemp(join(tmpdir(), 'elsewhere-deletion-'));
  const keys = generateKeyPairSync('ed25519');
  const jwk = keys.privateKey.export({ format: 'jwk' });
  let mode = 'not_deleted',
    requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v2/agent-account-deletion/status') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      const publicKey = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: body.public_key },
        format: 'jwk',
      });
      assert(
        verify(
          null,
          Buffer.from(
            `ELSEWHERE-ACCOUNT-DELETION-V1\n${body.agent_id}\n${body.issued_at}\n${body.nonce}`,
          ),
          publicKey,
          Buffer.from(body.signature, 'base64url'),
        ),
      );
      assert.equal(body.public_key, jwk.x);
      assert.equal(body.agent_id, '12345');
      if (mode === 'unavailable') {
        res
          .writeHead(503)
          .end(JSON.stringify({ error: { code: 'UNAVAILABLE' } }));
      } else {
        res.end(
          JSON.stringify({
            code: 0,
            data: {
              status: mode === 'not_deleted' ? 'not_deleted' : 'deleted',
              agent_id: body.agent_id,
              nonce: mode === 'bad_nonce' ? 'wrong' : body.nonce,
              deleted_at: mode === 'not_deleted' ? 0 : Date.now(),
            },
          }),
        );
      }
      return;
    }
    res.writeHead(401).end(
      JSON.stringify({
        error: {
          code: 'AGENT_AUTH_INVALID',
          message: 'fixture authentication rejection',
        },
      }),
    );
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const connection = join(home, '.elsewhere', 'servers', 'agentnet');
  const cli = (...args) =>
    new Promise((ok, fail) =>
      execFile(
        binary,
        [
          '--homedir',
          home,
          '--server',
          'agentnet',
          '--format',
          'json',
          '--no-interactive',
          ...args,
        ],
        { windowsHide: true },
        (error, stdout, stderr) =>
          error ? fail(new Error(stderr)) : ok(JSON.parse(stdout)),
      ),
    );
  const preserved = [
    [join(home, 'memory.md'), '宿主私人记忆'],
    [join(home, 'projects', 'code.txt'), 'other project'],
    [
      join(home, '.elsewhere', 'servers', 'other', 'credentials.json'),
      'other account',
    ],
    [join(connection, 'custom-notes.md'), 'user file'],
  ];
  try {
    await mkdir(connection, { recursive: true });
    await writeFile(
      join(home, '.elsewhere', 'config.json'),
      JSON.stringify({
        default_server: 'agentnet',
        servers: [{ name: 'agentnet', endpoint }],
      }),
    );
    await writeFile(
      join(connection, 'identity.json'),
      JSON.stringify({
        key_type: 'ed25519-v1',
        private_key: Buffer.concat([
          Buffer.from(jwk.d, 'base64url'),
          Buffer.from(jwk.x, 'base64url'),
        ]).toString('base64url'),
      }),
      { mode: 0o600 },
    );
    const credentialFile = join(connection, 'agent-v2-credentials.json');
    const credentials = JSON.stringify({
      agent_id: '12345',
      principal_id: '10',
      access_token: 'efv2a_fixture',
      refresh_token: 'efv2r_fixture',
      expires_at: Date.now() + 3600000,
    });
    await writeFile(credentialFile, credentials, { mode: 0o600 });
    for (const [path, content] of preserved) {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, content);
    }
    const journal = join(home, 'agentnet-runtime', 'journal.json');
    const pending = JSON.stringify({
      endpoint,
      jobs: { old: { phase: 'ready', completion: { private: 'discard' } } },
      identity: { agent_name: 'old' },
    });
    for (const [path, content] of [
      [journal, pending],
      [join(home, 'social-proposals', 'draft.json'), 'private draft'],
      [join(home, 'agentnet-decisions', 'pending.json'), 'private request'],
      [
        join(connection, 'data', 'messages', 'old.json'),
        'private conversation',
      ],
      [join(connection, 'control-context.json'), 'private context'],
    ]) {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, content);
    }
    const client = new AgentNet({ binary, home, endpoint });
    assert.equal((await cli('agent', 'account-status')).status, 'not_deleted');
    for (mode of ['not_deleted', 'unavailable', 'bad_nonce']) {
      await assert.rejects(client.get_context());
      assert.equal(await readFile(credentialFile, 'utf8'), credentials);
      assert.equal(await readFile(journal, 'utf8'), pending);
    }
    mode = 'deleted';
    const events = [];
    const worker = new AgentNetRuntime({
      client,
      home,
      endpoint,
      model: {
        json() {
          throw new Error('deleted account must not invoke a model');
        },
      },
      log: (event) => events.push(event),
    });
    await worker.run({ once: true });
    assert.equal(events.at(-1).event, 'account_deleted');
    assert.equal(events.at(-1).scheduler_action, 'stop_account_patrol');
    const cleared = JSON.parse(await readFile(journal, 'utf8'));
    assert.deepEqual(cleared, { endpoint, jobs: {}, status: 'deleted' });
    for (const name of [
      'agent-v2-credentials.json',
      'identity.json',
      'control-context.json',
      'data',
    ])
      await assert.rejects(access(join(connection, name)), { code: 'ENOENT' });
    for (const name of ['social-proposals', 'agentnet-decisions'])
      await assert.rejects(access(join(home, name)), { code: 'ENOENT' });
    const marker = JSON.parse(
      await readFile(join(connection, 'account-deleted.json'), 'utf8'),
    );
    assert.equal(marker.local_cleanup, 'completed');
    assert.equal(marker.agent_id, undefined);
    const before = requests;
    await worker.run({ once: true });
    await assert.rejects(cli('agent', 'provision'), /ACCOUNT_DELETED/);
    await assert.rejects(cli('agent', 'init'), /ACCOUNT_DELETED/);
    assert.equal(
      (await cli('heartbeat', 'plan')).scheduler_action,
      'stop_account_patrol',
    );
    assert.equal((await cli('agent', 'account-status')).status, 'deleted');
    assert.equal(requests, before, 'deleted connection must not reconnect');
    for (const [path, content] of preserved)
      assert.equal(await readFile(path, 'utf8'), content);
    console.log(
      'PASS deletion protocol: signed confirmation; no erasure on expiry/503/malformed response; worker stops; connection cleanup; host memory, projects and other account preserved; no reconnect.',
    );
  } finally {
    await new Promise((ok) => server.close(ok));
    await rm(home, { recursive: true, force: true });
  }
}
