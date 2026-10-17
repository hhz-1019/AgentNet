import './managed-photo-migration-test.mjs';
import { verifyManagedLabelMigration } from './managed-label-migration-test.mjs';
// Full schema + patched Go HTTP handlers against isolated PostgreSQL (PGlite).
// No production account, SMS, model key or paid provider is used here.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { cp, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import assert from 'node:assert/strict';
import { verifyManagedIdentityMigration } from './managed-identity-migration-test.mjs';
import { verifyManagedWritingMigration } from './managed-writing-migration-test.mjs';
await mkdir('.agentnet-audit', { recursive: true });
const dir = await mkdtemp(resolve('.agentnet-audit/managed-core-'));
await cp('upstream/eigenflux', dir, {
  recursive: true,
  filter: (s) => basename(s) !== '.git',
});
// Apply patches relative to this isolated checkout, not the parent repository.
execFileSync('git', ['init', '--quiet'], { cwd: dir });
for (const patch of [
  'domestic-providers',
  'uid-deepseek',
  'official-assistant',
  'community-activation',
  'social-workspace',
  'account-connection',
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
      [
        'test',
        './api/consolev2',
        '-run',
        process.argv.includes('--presence-provider')
          ? '^TestManagedPresenceRealProviderComparison$'
          : process.argv.includes('--analytics')
            ? '^TestAnalytics'
            : 'TestManaged|TestAccountConnection',
        '-count=1',
        '-timeout',
        process.argv.includes('--presence-provider') ? '50m' : '10m',
        '-v',
      ],
      {
        cwd: dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          GOMAXPROCS: '2',
          GOFLAGS: '-p=2',
          AGENTNET_MANAGED_WORKER: 'false',
          AGENTNET_MEDIA_PREPARATION: 'false',
          AGENTNET_MANAGED_PRESENCE_ACCEPTANCE: process.argv.includes(
            '--presence-provider',
          )
            ? 'true'
            : 'false',
          AGENTNET_RECRUITER_CATALOG_FILE: resolve(
            'eigenflux/data/recruiters.json',
          ),
          AGENTNET_MANAGED_TEST_DSN: `host=127.0.0.1 port=${port} user=postgres dbname=postgres sslmode=disable`,
        },
      },
    );
    child.once('error', fail);
    child.once('exit', (code) => done(code ?? 1));
  });
  if (process.exitCode === 0 && !process.argv.includes('--analytics')) {
    const traceMigration = await readFile(`${dir}/migrations/000141_managed_writing_trace.sql`, 'utf8');
    // Run rollback checks in a transaction; neither existing identities nor
    // generated diagnostics may be destroyed by exercising the down path.
    await db.exec('BEGIN');
    try {
      await db.exec("UPDATE managed_runs SET writing_trace='{}'::jsonb");
      await db.exec(traceMigration.split('-- +goose Down')[1]);
      await db.exec(traceMigration.split('-- +goose Down')[0]);
      await db.exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at,writing_trace)
        SELECT 990141,agent_id,sponsor_uid,CURRENT_DATE,to_char(CURRENT_DATE,'YYYY-MM'),'skipped',0,0,1,'{"version":"presence-v2","attempts":[]}'::jsonb
        FROM managed_members ORDER BY agent_id LIMIT 1`);
      await db.exec('SAVEPOINT trace_rollback_guard');
      await assert.rejects(db.exec(traceMigration.split('-- +goose Down')[1]), /Writing diagnostics exist/);
      await db.exec('ROLLBACK TO SAVEPOINT trace_rollback_guard');
      const { rows } = await db.query('SELECT writing_trace FROM managed_runs WHERE run_id=990141');
      assert.equal(rows[0].writing_trace.version, 'presence-v2');
    } finally {
      await db.exec('ROLLBACK');
    }
    console.log('Writing trace migration and rollback preserve audit history.');
    await verifyManagedWritingMigration(
      db,
      (
        await readFile(
          `${dir}/migrations/000123_managed_natural_writing.sql`,
          'utf8',
        )
      ).split('-- +goose Down')[0],
    );
    await verifyManagedIdentityMigration(
      db,
      (
        await readFile(
          `${dir}/migrations/000118_managed_agent_identity.sql`,
          'utf8',
        )
      ).split('-- +goose Down')[0],
    );
    await verifyManagedLabelMigration(
      db,
      (
        await readFile(
          `${dir}/migrations/000136_remove_post_provenance.sql`,
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
