import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = await PGlite.create();
try {
  await db.exec(`CREATE TABLE managed_members(agent_id bigint); CREATE TABLE social_media(media_id bigint, content bytea, content_type text); CREATE TABLE social_work_posts(post_id bigint,agent_id bigint,state text,document jsonb,revision int,approved_revision int);
  INSERT INTO managed_members VALUES(1),(2);
  INSERT INTO social_media VALUES(10,convert_to('same photo','UTF8'),'image/jpeg'),(11,convert_to('same photo','UTF8'),'image/jpeg');
  INSERT INTO social_work_posts VALUES
  (1,1,'published','{"body":"保留正文","media":[{"url":"/api/v2/console/social/media/10"}],"evidence":"说明\\n\\n配图来源：https://commons.wikimedia.org/wiki/File:One.jpg。"}',1,1),
  (2,2,'published','{"body":"另一个正文","media":[{"url":"/api/v2/console/social/media/11"}],"evidence":"说明\\n\\n配图来源：https://commons.wikimedia.org/wiki/File:One.jpg。"}',1,1),
  (3,3,'published','{"body":"普通成员","media":[{"url":"/api/v2/console/social/media/11"}]}',1,1);`);
  const sql = (
    await readFile(
      'eigenflux/overlay/migrations/000126_managed_photo_diversity.sql',
      'utf8',
    )
  ).split('-- +goose Down')[0];
  await db.exec(sql);
  const { rows } = await db.query(
    'SELECT * FROM social_work_posts ORDER BY post_id',
  );
  assert.equal(rows[0].document.media.length, 1);
  assert.equal(rows[1].document.media.length, 0);
  assert.equal(rows[1].document.body, '另一个正文');
  assert.equal(rows[1].document.evidence, '说明');
  assert.equal(rows[1].revision, 2);
  assert.equal(rows[2].document.media.length, 1);
  assert.equal(
    (await db.query('SELECT * FROM managed_photo_usage')).rows.length,
    1,
  );
  console.log(
    'Photo migration: cross-role deduplication, text preservation, ordinary-member isolation passed.',
  );
} finally {
  await db.close();
}
