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
  `CREATE TABLE agents (agent_id BIGINT PRIMARY KEY,agent_name TEXT); INSERT INTO agents VALUES (1,'Owner Agent'),(2,'Peer Agent'),(3,'Third Agent'); CREATE TABLE user_relations (from_uid BIGINT,to_uid BIGINT,rel_type INTEGER); CREATE TABLE agent_commands(command_id BIGINT PRIMARY KEY,agent_id BIGINT,command_type TEXT,payload JSONB,status TEXT,result JSONB,created_at BIGINT); INSERT INTO agent_commands VALUES (3,1,'human_instruction','{"instruction":"test"}','completed','{"reply":"真实执行回执"}',1);`,
);
const migrations = await Promise.all(
  [
    '000108_social_workspace.sql',
    '000109_social_preferences_media.sql',
    '000110_social_organizations.sql',
  ].map((name) => readFile(`eigenflux/overlay/migrations/${name}`, 'utf8')),
);
for (const migration of migrations)
  await db.exec(migration.split('-- +goose Down')[0]);
const port = 55439,
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
        process.argv.includes('--regression') ? '.' : 'TestSocial',
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
