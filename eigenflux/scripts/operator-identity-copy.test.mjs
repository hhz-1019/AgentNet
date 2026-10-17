import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

void test('identity copy migrates current managed projections without certifying identity or rewriting history', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE managed_members(agent_id bigint,owner_uid text,name text,persona text);
      CREATE TABLE agents(agent_id bigint,agent_name text,bio text,is_official boolean,updated_at bigint);
      CREATE TABLE twin_users(user_id text,portrait_fields jsonb,portrait_revision bigint,portrait_last_write_hash text);
      CREATE TABLE agent_onboarding_drafts(agent_id bigint,revision bigint,draft_data jsonb);
      CREATE TABLE agent_context_revisions(agent_id bigint,revision bigint,compiled_context jsonb);
      CREATE TABLE agent_context_heads(agent_id bigint,active_revision bigint);
      CREATE SEQUENCE agent_card_rebuild_fence_seq;
      CREATE TABLE agent_cards(agent_id bigint,public_card jsonb,rebuild_fence bigint,card_version bigint,public_card_version bigint,generated_at bigint,public_card_generated_at bigint);
    `);
    const old =
      'elsewhere 创建的某人模拟代理，非本人，未获本人授权。关注设计。';
    const next = '关注某人公开动态的 Agent，由账号运营者管理。关注设计。';
    const profile = {
      owner_kind: 'platform_test',
      representation: 'fictional_character',
      identity_card: {
        agent_description: old,
        human_description: 'elsewhere 官方运营；不是公众人物本人账号。',
      },
      sources: ['https://example.com/original'],
      custom: '用户自定义观点',
      verified: false,
      quota: 5,
      tags: [],
      unknown: null,
    };
    await db.query('INSERT INTO managed_members VALUES(1,$1,$2,$3)', [
      'owner-1',
      '某人 · 模拟代理',
      old,
    ]);
    for (const id of [1, 2]) {
      await db.query('INSERT INTO agents VALUES($1,$2,$3,false,1)', [
        id,
        '某人 · 模拟代理',
        old,
      ]);
      await db.query('INSERT INTO twin_users VALUES($1,$2,1,$3)', [
        'owner-' + id,
        profile,
        'previous-write',
      ]);
      await db.query('INSERT INTO agent_cards VALUES($1,$2,0,1,1,1,1)', [
        id,
        profile,
      ]);
      await db.query('INSERT INTO agent_context_heads VALUES($1,2)', [id]);
      for (const revision of [1, 2]) {
        await db.query('INSERT INTO agent_onboarding_drafts VALUES($1,$2,$3)', [
          id,
          revision,
          profile,
        ]);
        await db.query('INSERT INTO agent_context_revisions VALUES($1,$2,$3)', [
          id,
          revision,
          profile,
        ]);
      }
    }
    const migration = (
      await readFile(
        new URL(
          '../overlay/migrations/000150_operator_identity_copy.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).split('-- +goose Down')[0];
    await db.exec(migration);
    const { rows: agents } = await db.query(
      'SELECT * FROM agents ORDER BY agent_id',
    );
    assert.equal(agents[0].bio, next);
    assert.equal(agents[0].agent_name, '某人 · 资讯 Agent');
    assert.equal(agents[0].is_official, false);
    assert.equal(agents[1].bio, old);
    const expected = {
      ...profile,
      owner_kind: 'platform_operator',
      representation: 'operator_agent',
      identity_card: {
        agent_description: next,
        human_description: '本账号运营者',
      },
    };
    for (const [table, column] of [
      ['agent_onboarding_drafts', 'draft_data'],
      ['agent_context_revisions', 'compiled_context'],
    ]) {
      const { rows } = await db.query(
        `SELECT * FROM ${table} ORDER BY agent_id,revision`,
      );
      assert.deepEqual(
        rows.map((r) => r[column]),
        [profile, expected, profile, profile],
      );
    }
    const { rows: cards } = await db.query(
      'SELECT * FROM agent_cards ORDER BY agent_id',
    );
    assert.deepEqual(cards[0].public_card, expected);
    assert.deepEqual(cards[1].public_card, profile);
    const { rows: portraits } = await db.query(
      'SELECT * FROM twin_users ORDER BY user_id',
    );
    assert.deepEqual(portraits[0].portrait_fields, expected);
    assert.deepEqual(portraits[1].portrait_fields, profile);
    await db.exec(migration);
    assert.deepEqual(
      (await db.query('SELECT * FROM agent_cards ORDER BY agent_id')).rows,
      cards,
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM twin_users ORDER BY user_id')).rows,
      portraits,
    );
    const text = '公开招聘信息画像，由 elsewhere 整理；未代表企业入驻或授权。';
    assert.equal(
      (
        await db.query('SELECT pg_temp.operator_identity_copy($1) AS value', [
          text,
        ])
      ).rows[0].value,
      '公开招聘信息 Agent，由账号运营者管理。',
    );
  } finally {
    await db.close();
  }
});
