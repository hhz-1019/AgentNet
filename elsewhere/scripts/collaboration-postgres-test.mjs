// Real PostgreSQL contention acceptance. Creates and drops only its own database.
// PGHOST must be loopback; provide PGPORT/PGUSER/PGPASSWORD for a local test server.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const host = process.env.PGHOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host))
  throw new Error('Collaboration acceptance requires a loopback test database');
const port = process.env.PGPORT || '5432';
if (!/^\d{1,5}$/.test(port) || Number(port) > 65535 || Number(port) < 1)
  throw new Error('Invalid PostgreSQL test port');
const database = `elsewhere_collab_${randomBytes(10).toString('hex')}`;
const env = { ...process.env, PGHOST: host, PGPORT: port };
const psql = process.env.AGENTNET_PSQL_BINARY || 'psql';
const go = process.env.AGENTNET_GO_BINARY || 'go';

function run(
  binary,
  args,
  { input, cwd, testEnv = env, capture = false } = {},
) {
  return new Promise((accept, reject) => {
    let output = '';
    const child = spawn(binary, args, {
      cwd,
      env: testEnv,
      shell: false,
      windowsHide: true,
      stdio: [
        input === undefined ? 'ignore' : 'pipe',
        capture ? 'pipe' : 'inherit',
        'inherit',
      ],
    });
    if (capture)
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 16 * 1024 * 1024) {
          child.kill();
          reject(new Error('Test output exceeded limit'));
        }
      });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) accept(output);
      else {
        if (capture) process.stderr.write(output);
        reject(new Error(`${binary} acceptance step failed (${code})`));
      }
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}
const sql = (input, target) =>
  run(psql, ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--dbname', target], {
    input,
  });
let created = false;
await mkdir('.agentnet-audit',{recursive:true});
const wireFixture=await mkdtemp(resolve('.agentnet-audit/collaboration-pg-wire-'));
try {
  await sql(
    `CREATE DATABASE "${database}";`,
    process.env.PGDATABASE || 'postgres',
  );
  created = true;
  const migration = (
    await readFile('core/migrations/000157_collaboration.sql', 'utf8')
  ).split('-- +goose Down')[0];
  await sql(
    `
    CREATE TABLE agents(agent_id BIGINT PRIMARY KEY,identity_state TEXT NOT NULL DEFAULT 'active');
    INSERT INTO agents(agent_id) VALUES(1),(2),(3);
    CREATE TABLE agent_owners(agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),owner_uid TEXT NOT NULL);
    INSERT INTO agent_owners VALUES(1,'independent-owner-A'),(2,'independent-owner-B'),(3,'independent-owner-C');
    ${migration}
  `,
    database,
  );
  // Credentials remain in standard libpq environment variables, never command args.
  await run(go,['test','./internal/client','-run','^TestCollaborationRequestWire$','-count=1','-v'],{cwd:resolve('core/cli'),testEnv:{...env,AGENTNET_COLLABORATION_WIRE_FIXTURE:wireFixture}});
  const output = await run(
    go,
    [
      'test',
      './api/consolev2',
      '-run',
      '^TestCollaboration',
      '-count=1',
      '-timeout=3m',
      '-json',
    ],
    {
      cwd: resolve('core'),
      capture: true,
      testEnv: {
        ...env,
        PGDATABASE: database,
        AGENTNET_COLLABORATION_TEST_DSN: `host=${host} port=${port} dbname=${database} sslmode=disable`,
        AGENTNET_COLLABORATION_TEST_MULTICONNECTION: '1',
        AGENTNET_COLLABORATION_WIRE_FIXTURE: wireFixture,
      },
    },
  );
  const events = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const name of [
    'TestCollaborationSQL',
    'TestCollaborationHTTPContract',
    'TestCollaborationDeclineReceipt',
    'TestCollaborationAccountErasure',
    'TestCollaborationErasedReceiptSQL',
    'TestCollaborationErasureInviteRace',
    'TestCollaborationReciprocalInviteLocks',
    'TestCollaborationRequestWire/html',
    'TestCollaborationRequestWire/amp',
    'TestCollaborationRequestWire/control',
    'TestCollaborationPostLockExpiry/context',
    'TestCollaborationPostLockExpiry/submit',
    'TestCollaborationPostLockExpiry/heartbeat',
  ]) {
    if (!events.some((event) => event.Test === name && event.Action === 'pass'))
      throw new Error(`Required PostgreSQL acceptance did not pass: ${name}`);
    console.log(`PASS: ${name}`);
  }
  console.log(
    'PASS: real PostgreSQL multi-connection collaboration acceptance',
  );
} finally {
  await rm(wireFixture,{recursive:true,force:true});
  if (created)
    await sql(
      `DROP DATABASE "${database}" WITH (FORCE);`,
      process.env.PGDATABASE || 'postgres',
    );
}
