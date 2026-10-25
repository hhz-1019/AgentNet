import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

void test('social permission migration preserves opt-outs and leaves platform roles alone', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE agents(agent_id bigint PRIMARY KEY,is_official boolean NOT NULL DEFAULT false);
 CREATE TABLE managed_members(agent_id bigint PRIMARY KEY);
 CREATE TABLE agent_settings(agent_id bigint PRIMARY KEY,auto_reply_pm boolean,show_add_friend boolean);
 INSERT INTO agents VALUES(1,false),(2,false),(3,false),(4,true),(5,false);
 INSERT INTO managed_members VALUES(5);
 INSERT INTO agent_settings VALUES(1,true,true),(2,false,false),(3,NULL,NULL),(4,false,false),(5,false,false);`);
    const migration = await readFile(
      'core/migrations/000132_companion_social_permissions.sql',
      'utf8',
    );
    await db.exec('BEGIN;' + migration.split('-- +goose Down')[0] + ' COMMIT;');
    const rows = (
      await db.query(
        'SELECT agent_id::int,auto_reply_pm,show_add_friend,auto_start_pm,auto_connect FROM agent_settings ORDER BY agent_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.auto_start_pm, r.auto_connect]),
      [
        [true, true],
        [false, false],
        [false, false],
        [true, true],
        [true, true],
      ],
    );
    assert.equal(rows[3].auto_reply_pm, false);
    assert.equal(rows[4].show_add_friend, false);
    await db.exec(
      'INSERT INTO agent_settings(agent_id,auto_reply_pm,show_add_friend) VALUES(6,true,true)',
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT auto_start_pm,auto_connect FROM agent_settings WHERE agent_id=6',
        )
      ).rows[0],
      { auto_start_pm: true, auto_connect: true },
    );
  } finally {
    await db.close();
  }
});

void test('reconciliation repairs a colliding migration version without resetting existing permissions', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE agents(agent_id bigint PRIMARY KEY,is_official boolean NOT NULL DEFAULT false);
CREATE TABLE managed_members(agent_id bigint PRIMARY KEY);
CREATE TABLE agent_settings(agent_id bigint PRIMARY KEY,auto_reply_pm boolean,show_add_friend boolean);
CREATE TABLE goose_db_version(version_id bigint,is_applied boolean);
INSERT INTO goose_db_version VALUES(132,true);
INSERT INTO agents VALUES(1,false),(2,false),(3,true),(4,false);
INSERT INTO managed_members VALUES(4);
INSERT INTO agent_settings VALUES(1,true,true),(2,false,false),(3,false,false),(4,false,false);`);
    const sql = (
      await readFile(
        'core/migrations/000133_reconcile_companion_permissions.sql',
        'utf8',
      )
    ).split('-- +goose Down')[0];
    await db.exec('BEGIN;' + sql + 'COMMIT;');
    const rows = (
      await db.query(
        'SELECT auto_start_pm,auto_connect FROM agent_settings ORDER BY agent_id',
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.auto_start_pm, r.auto_connect]),
      [
        [true, true],
        [false, false],
        [true, true],
        [true, true],
      ],
    );
    // A later owner choice must survive a repeat reconciliation.
    await db.exec(
      'UPDATE agent_settings SET auto_start_pm=false,auto_connect=false WHERE agent_id=1;',
    );
    await db.exec('BEGIN;' + sql + 'COMMIT;');
    assert.deepEqual(
      (
        await db.query(
          'SELECT auto_start_pm,auto_connect FROM agent_settings WHERE agent_id=1',
        )
      ).rows[0],
      { auto_start_pm: false, auto_connect: false },
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT version_id::int,is_applied FROM goose_db_version',
        )
      ).rows,
      [{ version_id: 132, is_applied: true }],
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT auto_reply_pm,show_add_friend FROM agent_settings WHERE agent_id IN (3,4)',
        )
      ).rows,
      [
        { auto_reply_pm: false, show_add_friend: false },
        { auto_reply_pm: false, show_add_friend: false },
      ],
    );
  } finally {
    await db.close();
  }
});
