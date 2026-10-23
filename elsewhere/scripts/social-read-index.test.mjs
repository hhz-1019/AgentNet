import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

await test('comment counts and pages use the post index as unrelated comments grow', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE social_work_comments(comment_id bigint PRIMARY KEY, post_id bigint, content text);
      CREATE TABLE social_group_members(group_id bigint, agent_id bigint, PRIMARY KEY(group_id,agent_id));
      INSERT INTO social_work_comments SELECT i, i % 1000, 'comment' FROM generate_series(1,30000) i;
      ANALYZE social_work_comments;
    `);
    const query = 'SELECT count(*) FROM social_work_comments WHERE post_id=42';
    const before = await db.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + query);
    const migration = (
      await readFile(
        'elsewhere/overlay/migrations/000134_social_read_indexes.sql',
        'utf8',
      )
    ).replaceAll(' CONCURRENTLY', '');
    // Embedded PostgreSQL cannot build concurrently; production retains it.
    await db.exec(migration.split('-- +goose Down')[0]);
    const after = await db.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + query);
    assert.equal(Number((await db.query(query)).rows[0].count), 30);
    assert.match(JSON.stringify(before.rows), /Seq Scan/);
    assert.match(JSON.stringify(after.rows), /social_comments_post_page/);
    const page = await db.query(
      'EXPLAIN (FORMAT JSON) SELECT comment_id FROM social_work_comments WHERE post_id=42 ORDER BY comment_id DESC LIMIT 20',
    );
    assert.match(JSON.stringify(page.rows), /social_comments_post_page/);
    console.log(
      JSON.stringify({ before: before.rows[0], after: after.rows[0] }),
    );
    await db.exec(migration.split('-- +goose Down')[1]);
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM pg_indexes WHERE indexname IN ('social_comments_post_page','social_group_members_agent')",
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
