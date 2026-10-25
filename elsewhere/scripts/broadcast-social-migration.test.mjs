import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

void test('completed broadcasts recover into real social posts, sync once and honor deletion', async () => {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  try {
    const sources = new Map();
    for (const dir of ['core/migrations']) {
      for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')))
        sources.set(name, `${dir}/${name}`);
    }
    const versions = [...sources.keys()].map((name) => name.split('_')[0]);
    assert.equal(
      new Set(versions).size,
      versions.length,
      'Goose migration versions must be unique',
    );
    const bridgeName = '000129_broadcast_social_posts.sql';
    for (const [name, path] of [...sources].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (name === bridgeName) continue;
      const up = (await readFile(path, 'utf8'))
        .split('-- +goose Down')[0]
        .replace(/\bCONCURRENTLY\b/g, '');
      await db.exec(`BEGIN; ${up} COMMIT;`);
    }
    await db.exec(`
      INSERT INTO agents(agent_id,email,agent_name,created_at,updated_at) VALUES(7001,'bridge@example.test','发布测试 Agent',10,10),(7002,'unbound@example.test','无所有者 Agent',10,10);
      INSERT INTO human_accounts(uid,password_hash,recovery_hash,created_at) VALUES('70001','test','test',10);
      INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(7001,'70001',10);
      INSERT INTO raw_items(item_id,author_agent_id,raw_content,raw_notes,created_at) VALUES
        (9223372036854775000,7001,E'三个 Agent 赞同，可能只有一条证据\n\n原始正文。','{"domains":["ai","research"],"summary":"关于重复证据的讨论。"}',20),
        (9223372036854774999,7001,'仍在处理','',21),
        (9223372036854774998,7001,'处理失败','',22),
        (9223372036854774997,7002,'没有绑定所有者','',23);
      INSERT INTO processed_items(item_id,status,updated_at) VALUES(9223372036854775000,3,20),(9223372036854774999,0,21),(9223372036854774998,2,22),(9223372036854774997,3,23);
    `);
    const migration = await readFile(sources.get(bridgeName), 'utf8');
    await db.exec(`BEGIN; ${migration.split('-- +goose Down')[0]} COMMIT;`);
    let rows = (
      await db.query(
        'SELECT post_id::text,agent_id::text,document,state,visibility FROM social_work_posts WHERE broadcast_item_id IS NOT NULL',
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].post_id, '9223372036854775000');
    assert.equal(rows[0].agent_id, '7001');
    assert.equal(rows[0].document.title, '三个 Agent 赞同，可能只有一条证据');
    assert.equal(
      rows[0].document.body,
      '三个 Agent 赞同，可能只有一条证据\n\n原始正文。',
    );
    assert.deepEqual(rows[0].document.media, []);
    assert.equal(rows[0].state, 'published');
    assert.equal(rows[0].visibility, 'public');
    // Processing completes after the CLI returns: this creates the web post.
    await db.exec(`UPDATE raw_items SET raw_notes='malformed old metadata' WHERE item_id=9223372036854774999;
      UPDATE processed_items SET status=3 WHERE item_id=9223372036854774999;
      UPDATE processed_items SET status=3 WHERE item_id=9223372036854774999;`);
    rows = (
      await db.query(
        'SELECT document FROM social_work_posts WHERE broadcast_item_id=9223372036854774999',
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].document.tags, ['Agent 动态']);
    // This is the same table used by mine, author, guest and social reactions.
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM social_work_posts WHERE agent_id=7001 AND state='published'",
        )
      ).rows[0].n,
      2,
    );
    await db.exec(`INSERT INTO social_work_reactions(post_id,agent_id,kind) VALUES(9223372036854774999,7001,'like');
      UPDATE processed_items SET status=5 WHERE item_id=9223372036854774999;`);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM social_work_posts WHERE broadcast_item_id=9223372036854774999',
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM social_work_reactions'))
        .rows[0].n,
      0,
    );
    await db.exec(`INSERT INTO raw_items(item_id,author_agent_id,raw_content,created_at) VALUES(7003,7001,'直接完成的广播',30);
      INSERT INTO processed_items(item_id,status,updated_at) VALUES(7003,3,30);
      DELETE FROM raw_items WHERE item_id=7003;`);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM social_work_posts WHERE post_id=7003',
        )
      ).rows[0].n,
      0,
    );
    await db.exec(`BEGIN; ${migration.split('-- +goose Down')[1]} COMMIT;`);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM social_work_posts WHERE agent_id=7001',
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
