import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
await mkdir('.agentnet-audit', { recursive: true });
const dir = await mkdtemp(resolve('.agentnet-audit/social-core-'));
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
await db.exec(
  `CREATE TABLE agents (agent_id BIGINT PRIMARY KEY,agent_name TEXT); INSERT INTO agents VALUES (1,'我的 Agent'),(2,'伙伴 Agent'),(3,'第三位 Agent'); ALTER TABLE agents ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT false; CREATE TABLE user_relations (from_uid BIGINT,to_uid BIGINT,rel_type INTEGER); CREATE TABLE agent_commands(command_id BIGINT PRIMARY KEY,agent_id BIGINT,command_type TEXT,payload JSONB,status TEXT,result JSONB,created_at BIGINT); ALTER TABLE agent_commands ADD claim_epoch BIGINT, ADD claim_token_hash TEXT, ADD claim_until BIGINT; INSERT INTO agent_commands(command_id,agent_id,command_type,payload,status,result,created_at) VALUES (3,1,'human_instruction','{"instruction":"测试指令"}','completed','{"reply":"真实执行回执"}',1);`,
);
const migrations = await Promise.all(
  [
    '000108_social_workspace.sql',
    '000109_social_preferences_media.sql',
    '000110_social_organizations.sql',
    '000111_project_handoffs.sql',
    '000112_digital_twin.sql',
    '000119_elsewhere_social.sql',
  ].map((name) => readFile(`eigenflux/overlay/migrations/${name}`, 'utf8')),
);
await db.exec(
  `CREATE TABLE human_accounts(uid VARCHAR(64) PRIMARY KEY,password_hash TEXT,recovery_hash TEXT,created_at BIGINT); CREATE TABLE agent_owners(agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),owner_uid VARCHAR(64) REFERENCES human_accounts(uid),created_at BIGINT); CREATE TABLE console_v2_sessions(session_id TEXT PRIMARY KEY,owner_uid VARCHAR(64),auth_method TEXT,status TEXT);`,
);
await db.exec((await readFile('upstream/eigenflux/migrations/000003_add_pm_tables.sql','utf8')).split('-- +goose Down')[0]);
await db.exec("ALTER TABLE agents ADD COLUMN bio TEXT NOT NULL DEFAULT ''; ALTER TABLE conversations ADD COLUMN topic_status SMALLINT NOT NULL DEFAULT 1;");
for (const migration of migrations)
  await db.exec(migration.split('-- +goose Down')[0]);
const port = Number(process.env.AGENTNET_SOCIAL_TEST_PORT || 15439),
  socket = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await socket.start();
let code = 1;
try {
  code = await new Promise((resolveRun, reject) => {
    const child = spawn(
      process.env.AGENTNET_GO_BINARY || 'go',
      [
        'test',
        './api/consolev2',
        ...(process.argv.includes('--regression')
          ? [
              './rpc/auth',
              './pkg/email',
              './pipeline/llm',
              './pipeline/embedding',
            ]
          : []),
        '-run',
        process.argv.includes('--regression') ? '.' : 'TestSocial|TestTwin|TestElsewhere',
        '-count=1',
        '-v',
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          AGENTNET_SOCIAL_BROWSER_SCRIPT: process.argv.includes('--browser')
            ? resolve('eigenflux/scripts/social-live-ui.mjs')
            : '',
          AGENTNET_SOCIAL_TEST_DSN: `host=127.0.0.1 port=${port} user=postgres dbname=postgres sslmode=disable`,
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (c) => resolveRun(c ?? 1));
  });
  if (code === 0) {
    // The isolated video fixture proves production rollback refuses data loss.
    const videoCount = await db.query("SELECT count(*)::int AS n FROM social_media WHERE content_type LIKE 'video/%'");
    if (videoCount.rows[0].n) {
      await assert.rejects(db.exec(migrations.at(-1).split('-- +goose Down')[1]), /social_media_content_type_check/);
      await db.exec("DELETE FROM social_media WHERE content_type LIKE 'video/%'");
    }
    for (const migration of [...migrations].reverse())
      await db.exec(migration.split('-- +goose Down')[1]);
    console.log('Social migration rollback passed.');
  }
} finally {
  await socket.stop();
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
process.exitCode = code;
