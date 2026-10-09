// Full schema + patched Go HTTP handlers against isolated PostgreSQL (PGlite).
// No production account, SMS, model key or paid provider is used here.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { cp, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { verifyManagedIdentityMigration } from './managed-identity-migration-test.mjs';
await mkdir('.agentnet-audit', { recursive: true });
const dir = await mkdtemp(resolve('.agentnet-audit/managed-core-'));
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
const db = await PGlite.create({ extensions: { pg_trgm } });
const names = (await readdir(`${dir}/migrations`))
  .filter((n) => n.endsWith('.sql'))
  .sort();
for (const name of names) {
  const migration = (await readFile(`${dir}/migrations/${name}`, 'utf8'))
    .split('-- +goose Down')[0]
    .replace(/\bCONCURRENTLY\b/g, '');
  try {
    await db.exec(migration);
  } catch (error) {
    throw new Error(`Migration ${name}: ${error.message}`);
  }
}
const port = 15443,
  socket = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await socket.start();
try {
  process.exitCode = await new Promise((done, fail) => {
    const child = spawn(
      process.env.AGENTNET_GO_BINARY || 'go',
      ['test', './api/consolev2', '-run', 'TestManaged', '-count=1', '-v'],
      {
        cwd: dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          GOMAXPROCS: '2',
          GOFLAGS: '-p=2',
          AGENTNET_MANAGED_WORKER: 'false',
          AGENTNET_MANAGED_TEST_DSN: `host=127.0.0.1 port=${port} user=postgres dbname=postgres sslmode=disable`,
        },
      },
    );
    child.once('error', fail);
    child.once('exit', (code) => done(code ?? 1));
  });
  if (process.exitCode === 0) {
    await verifyManagedIdentityMigration(
      db,
      (
        await readFile(
          `${dir}/migrations/000118_managed_agent_identity.sql`,
          'utf8',
        )
      ).split('-- +goose Down')[0],
    );
    const down = (
      await readFile(`${dir}/migrations/000115_managed_community.sql`, 'utf8')
    ).split('-- +goose Down')[1];
    await assert.rejects(db.exec(down), /Managed identities exist/);
    console.log('Seeded account ownership is preserved against rollback.');
  }
} finally {
  await socket.stop();
  await db.close();
}
