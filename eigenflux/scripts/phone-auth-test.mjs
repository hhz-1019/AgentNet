// Isolated DB + fake delivery adapter. This script never sends a paid SMS.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
await mkdir('.agentnet-audit', { recursive: true });
const dir = await mkdtemp(resolve('.agentnet-audit/phone-core-'));
await cp('upstream/eigenflux', dir, {
  recursive: true,
  filter: (s) => !s.endsWith('/.git'),
});
for (const patch of [
  'domestic-providers',
  'uid-deepseek',
  'official-assistant',
  'community-activation',
  'social-workspace',
])
  execFileSync(
    'git',
    [
      'apply',
      '--ignore-space-change',
      resolve(`eigenflux/patches/${patch}.patch`),
    ],
    { cwd: dir },
  );
await cp('eigenflux/overlay', dir, { recursive: true });
const db = await PGlite.create();
await db.exec(`
 CREATE TABLE agents(agent_id BIGINT PRIMARY KEY,agent_name TEXT,identity_state TEXT DEFAULT 'active');
 INSERT INTO agents SELECT n,'测试 Agent' FROM generate_series(1,30) n;
 CREATE TABLE agent_principals(principal_id BIGSERIAL PRIMARY KEY,agent_id BIGINT,key_type TEXT,key_fingerprint TEXT,public_key BYTEA,status TEXT,created_at BIGINT,last_seen_at BIGINT, CONSTRAINT chk_agent_principals_key_type CHECK(key_type IN ('ed25519-v1','email-recovery-v1')));
 CREATE TABLE agent_email_bindings(agent_id BIGINT,status TEXT);
 CREATE TABLE console_v2_sessions(session_id TEXT PRIMARY KEY,session_secret_hash TEXT,agent_id BIGINT,principal_id BIGINT,csrf_secret_hash TEXT,status TEXT,scopes TEXT[],issued_at BIGINT,idle_expires_at BIGINT,absolute_expires_at BIGINT,last_seen_at BIGINT,auth_method TEXT,recent_auth_at BIGINT,revoked_at BIGINT, CONSTRAINT chk_console_v2_sessions_auth_method CHECK(auth_method IN ('handoff','email_otp')));
`);
const previous = await readFile(
  'eigenflux/overlay/migrations/000105_agentnet_uid_owners.sql',
  'utf8',
);
await db.exec(previous.split('-- +goose Down')[0]);
await db.exec(
  `INSERT INTO human_accounts VALUES('u_legacy_first','unused','unused',1),('u_legacy_second','unused','unused',2); INSERT INTO agent_owners VALUES(20,'u_legacy_first',1);`,
);
const migration = await readFile(
  'eigenflux/overlay/migrations/000113_phone_verified_numbers.sql',
  'utf8',
);
await db.exec(migration.split('-- +goose Down')[0]);
await db.exec(
  (
    await readFile(
      'eigenflux/overlay/migrations/000112_digital_twin.sql',
      'utf8',
    )
  ).split('-- +goose Down')[0],
);
const port = Number(process.env.AGENTNET_PHONE_TEST_PORT || 15441),
  socket = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await socket.start();
let code = 1;
try {
  code = await new Promise((done, reject) => {
    const child = spawn(
      process.env.AGENTNET_GO_BINARY || 'go',
      [
        'test',
        './api/consolev2',
        './pkg/sms',
        ...(process.argv.includes('--regression') ? ['./rpc/auth'] : []),
        '-run',
        process.argv.includes('--regression')
          ? '.'
          : 'TestPhone|TestUID|TestAliyun|TestRPC|TestSMS',
        '-count=1',
        '-v',
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          AGENTNET_PHONE_TEST_DSN: `host=127.0.0.1 port=${port} user=postgres dbname=postgres sslmode=disable`,
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (value) => done(value ?? 1));
  });
  if (code === 0) {
    let refused = false;
    try {
      await db.exec(migration.split('-- +goose Down')[1]);
    } catch {
      refused = true;
    }
    if (!refused)
      throw Error('Rollback silently removed verified phone bindings');
    await db.exec(
      `UPDATE human_accounts SET phone_hash=NULL,phone_last4=NULL,phone_verified_at=NULL;`,
    );
    await db.exec(migration.split('-- +goose Down')[1]);
    console.log(
      'PASS: phone migration preserves legacy owners, blocks unsafe rollback and supports empty-binding rollback',
    );
  }
} finally {
  await socket.stop();
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
process.exitCode = code;

