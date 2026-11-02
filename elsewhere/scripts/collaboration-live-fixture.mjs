// Local-only API/SQL fixture for explicit real-host acceptance. Native CLI and
// collaboration handlers are real; network identities are synthetic test data.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Elsewhere } from '../client/sdk.mjs';

export async function startCollaborationLiveFixture({
  directory,
  goBinary,
  cliBinary,
}) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = await PGlite.create();
  let socket;
  let child;
  let exited;
  let exitCode;
  let diagnostic = '';
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const failures = [];
    if (child) {
      let requested = false;
      try {
        await writeFile(join(directory, 'stop'), 'local test complete', {
          mode: 0o600,
        });
        requested = true;
      } catch (error) {
        failures.push(error);
      }
      const stopped =
        requested &&
        (await Promise.race([
          exited.then(() => true),
          delay(12000, undefined, { ref: false }).then(() => false),
        ]));
      if (!stopped && child.pid) {
        try {
          if (process.platform === 'win32') {
            await new Promise((done) =>
              execFile(
                'taskkill.exe',
                ['/PID', String(child.pid), '/T', '/F'],
                { windowsHide: true },
                () => done(),
              ),
            );
          } else {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          }
          const confirmed = await Promise.race([
            exited.then(() => true),
            delay(10000, undefined, { ref: false }).then(() => false),
          ]);
          if (!confirmed)
            failures.push(
              new Error('Owned native fixture exit was not confirmed'),
            );
        } catch (error) {
          failures.push(error);
        }
      }
      if (exitCode !== 0)
        failures.push(new Error('Native fixture failed: ' + diagnostic));
    }
    try {
      if (socket) await socket.stop();
    } catch (error) {
      failures.push(error);
    }
    try {
      await db.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        'Local fixture cleanup did not complete cleanly',
      );
  };
  try {
    await db.exec(`CREATE TABLE agents(agent_id BIGINT PRIMARY KEY,identity_state TEXT NOT NULL DEFAULT 'active',short_id TEXT UNIQUE,agent_name TEXT);
      INSERT INTO agents VALUES(1,'active','PeerA','Pilot A'),(2,'active','PeerB','Pilot B'),(3,'active','PeerC','Pilot C');
      CREATE TABLE agent_owners(agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),owner_uid TEXT NOT NULL);
      INSERT INTO agent_owners VALUES(1,'synthetic-pilot-owner-A'),(2,'synthetic-pilot-owner-B'),(3,'synthetic-pilot-owner-C');`);
    const migration = await readFile(
      'core/migrations/000157_collaboration.sql',
      'utf8',
    );
    await db.exec(migration.split('-- +goose Down')[0]);
    const port = Number(
      process.env.AGENTNET_COLLABORATION_LIVE_DB_PORT || 15453,
    );
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Invalid local fixture port');
    socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port });
    await socket.start();
    console.log(JSON.stringify({ phase: 'local-database-ready', directory }));
    child = spawn(
      goBinary,
      [
        'test',
        './api/consolev2',
        '-run',
        '^TestCollaborationHostFixture$',
        '-count=1',
        '-v',
        '-timeout=20m',
      ],
      {
        cwd: resolve('core'),
        env: {
          ...process.env,
          AGENTNET_COLLABORATION_HOST_FIXTURE: directory,
          AGENTNET_COLLABORATION_TEST_DSN: `host=127.0.0.1 port=${port} user=postgres dbname=postgres sslmode=disable`,
        },
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    exited = new Promise((done) => {
      child.once('error', () => {
        exitCode = -1;
        done();
      });
      child.once('close', (code) => {
        exitCode = code ?? -1;
        done();
      });
    });
    child.stdout.on('data', (part) => {
      diagnostic = (diagnostic + part).slice(-12000);
    });
    child.stderr.on('data', (part) => {
      diagnostic = (diagnostic + part).slice(-12000);
    });
    let ready;
    const until = Date.now() + 600000;
    while (Date.now() < until) {
      if (exitCode !== undefined)
        throw new Error(
          'Native fixture exited before readiness: ' + diagnostic,
        );
      try {
        ready = JSON.parse(
          await readFile(join(directory, 'ready.json'), 'utf8'),
        );
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
          throw error;
      }
      await delay(200);
    }
    if (!ready) throw new Error('Native fixture readiness timed out');
    console.log(JSON.stringify({ phase: 'local-api-ready', directory }));
    const clients = {};
    const homes = {};
    for (const identity of ['1', '2']) {
      const home = join(directory, 'agent-' + identity, '.elsewhere');
      await mkdir(join(home, 'servers', 'agentnet'), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(
        join(home, 'config.json'),
        JSON.stringify({
          default_server: 'agentnet',
          kv: { auto_skill_sync: 'false' },
          servers: [
            {
              name: 'agentnet',
              endpoint: ready.endpoint,
              stream_endpoint: ready.endpoint.replace('http:', 'ws:'),
              kv: { auto_skill_sync: 'false' },
            },
          ],
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(home, 'servers', 'agentnet', 'agent-v2-credentials.json'),
        JSON.stringify({
          agent_id: identity,
          principal_id: 'local-pilot-' + identity,
          access_token: ready.fixture_tokens[identity],
          refresh_token: 'local-fixture-no-refresh',
          expires_at: Date.now() + 3600000,
          scopes: ['communication:read', 'communication:write'],
        }),
        { mode: 0o600 },
      );
      clients[identity] = new Elsewhere({
        binary: resolve(cliBinary),
        home,
        endpoint: ready.endpoint,
      });
      await clients[identity].connect();
      homes[identity] = home;
    }
    return { endpoint: ready.endpoint, clients, homes, directory, close };
  } catch (error) {
    await close();
    throw error;
  }
}
