import assert from 'node:assert/strict';

// Run after the full-schema Go test, against its isolated cohort and operator.
export async function verifyManagedIdentityMigration(db, migration) {
  const rows = async (sql) => (await db.query(sql)).rows;
  const ownership =
    await rows(`SELECT m.*, h.account_number, n.number, n.source,
    n.reserved_agent_id FROM managed_members m JOIN human_accounts h ON h.uid=m.owner_uid
    JOIN owner_uid_numbers n ON n.owner_uid=m.owner_uid ORDER BY m.agent_id`);
  assert.equal(ownership.filter((m) => m.seed_index < 100).length, 100);
  const official =
    await rows(`SELECT a.* FROM agents a JOIN agent_owners o USING(agent_id)
    WHERE o.owner_uid='managed_operator_v1'`);
  assert.equal(official[0].is_official, true);
  const [member] = await rows(
    'SELECT agent_id FROM managed_members ORDER BY agent_id LIMIT 1',
  );
  const id = member.agent_id;
  await db.exec(`UPDATE agents a SET is_official=true, agent_name=m.name || ' · 官方AI',
      bio='我是 ' || m.name || '，elsewhere 官方 AI 虚构角色，关注技术。'
    FROM managed_members m WHERE m.agent_id=a.agent_id;
    UPDATE agents SET bio='自定义简介：讨论官方文档和开源技术' WHERE agent_id=${id};
    UPDATE managed_members SET persona='官方 AI 虚构角色，设定年龄 24 岁；测试。';
    UPDATE agent_network_goals SET goal_text='以明确标识的官方 AI 角色提供有用的技术交流，不虚构真实经历或成果。'
      WHERE agent_id IN (SELECT agent_id FROM managed_members) AND status='active';
    UPDATE agent_onboarding_drafts d SET draft_data=jsonb_set(jsonb_set(draft_data,
      '{identity_card,agent_name}', to_jsonb(a.agent_name)), '{identity_card,agent_description}', to_jsonb(a.bio))
      FROM agents a, managed_members m WHERE d.agent_id=m.agent_id AND a.agent_id=m.agent_id;
    INSERT INTO agent_cards(agent_id,public_card,generated_at,rebuild_fence)
      SELECT a.agent_id,jsonb_build_object('is_official',true,'agent_name',a.agent_name),0,
        nextval('agent_card_rebuild_fence_seq') FROM agents a JOIN managed_members m USING(agent_id)
      ON CONFLICT DO NOTHING;
    UPDATE social_work_posts SET document=jsonb_set(jsonb_set(document,'{body}',
      to_jsonb(E'【官方 AI 角色 · 讨论与练习】\n\n' || (document->>'body'))),
      '{source}','"官方 AI 角色生成的讨论与练习"'::jsonb)
      WHERE agent_id IN (SELECT agent_id FROM managed_members);
    UPDATE social_work_comments SET content='【官方 AI】' || content
      WHERE agent_id IN (SELECT agent_id FROM managed_members);`);
  const posts = await rows(
    'SELECT post_id,document FROM social_work_posts ORDER BY post_id',
  );
  const comments = await rows(
    'SELECT comment_id,content FROM social_work_comments ORDER BY comment_id',
  );
  assert.ok(posts.length > 0 && comments.length > 0);
  // Twice verifies label removal does not trim ordinary text on reapplication.
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(
    await rows(`SELECT a.* FROM agents a JOIN agent_owners o USING(agent_id)
    WHERE o.owner_uid='managed_operator_v1'`),
    official,
  );
  const after = await rows(`SELECT m.*, h.account_number, n.number, n.source,
    n.reserved_agent_id FROM managed_members m JOIN human_accounts h ON h.uid=m.owner_uid
    JOIN owner_uid_numbers n ON n.owner_uid=m.owner_uid ORDER BY m.agent_id`);
  assert.deepEqual(
    after.map(({ persona: _persona, ...rest }) => rest),
    ownership.map(({ persona: _persona, ...rest }) => rest),
  );
  assert.ok(
    after.every((m) => m.persona === 'AI 虚构角色，设定年龄 24 岁；测试。'),
  );
  const identities =
    await rows(`SELECT a.is_official,a.agent_name,a.bio,c.public_card,
      d.draft_data,r.compiled_context FROM agents a JOIN managed_members m USING(agent_id)
      JOIN agent_cards c USING(agent_id) JOIN LATERAL (SELECT draft_data FROM agent_onboarding_drafts WHERE agent_id=a.agent_id ORDER BY revision DESC LIMIT 1) d ON true
      JOIN agent_context_heads h USING(agent_id) JOIN agent_context_revisions r
      ON r.agent_id=h.agent_id AND r.revision=h.active_revision`);
  assert.equal(identities.length, ownership.length);
  for (const row of identities) {
    assert.equal(row.is_official, false);
    assert.equal(row.public_card.is_official, false);
    assert.ok(!row.agent_name.includes('官方'));
    assert.equal(row.public_card.agent_name, row.agent_name);
    assert.equal(row.draft_data.identity_card.agent_name, row.agent_name);
    assert.ok(!row.compiled_context.network_goal.text.includes('官方 AI'));
  }
  assert.equal(
    (await rows(`SELECT bio FROM agents WHERE agent_id=${id}`))[0].bio,
    '自定义简介：讨论官方文档和开源技术',
  );
  const newPosts = await rows(
    'SELECT post_id,document FROM social_work_posts ORDER BY post_id',
  );
  assert.deepEqual(
    newPosts,
    posts.map((p) => ({
      ...p,
      document: {
        ...p.document,
        body: p.document.body.replace(/^【官方 AI 角色 · 讨论与练习】\n\n/, ''),
        source: 'AI Agent 生成的讨论与练习',
      },
    })),
  );
  assert.deepEqual(
    await rows(
      'SELECT comment_id,content FROM social_work_comments ORDER BY comment_id',
    ),
    comments.map((c) => ({
      ...c,
      content: c.content.replace(/^【官方 AI】/, ''),
    })),
  );
  console.log(
    'Managed identity migration: 100 ordinary Agents, official operator, UID/control preservation and repeat application passed.',
  );
}
