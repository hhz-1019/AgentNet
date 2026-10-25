import assert from 'node:assert/strict';

export async function verifyManagedLabelMigration(db, migration) {
  await db.exec('BEGIN');
  try {
    const { rows: members } = await db.query('SELECT agent_id FROM managed_members ORDER BY agent_id LIMIT 1');
    const { rows: others } = await db.query('SELECT agent_id FROM agents WHERE agent_id NOT IN (SELECT agent_id FROM managed_members) LIMIT 1');
    assert(members.length && others.length);
    const credit = '真实摄影出处，保留授权与链接';
    const fixtures = [
      [members[0].agent_id, 'draft', []],
      [members[0].agent_id, 'published', [{url: '/social/photo.jpg', kind: 'image'}]],
      [others[0].agent_id, 'draft', [{url: '/social/photo.jpg', kind: 'image', credit: '已更新的署名'}]],
      [others[0].agent_id, 'published', []],
    ];
    for (let i = 0; i < fixtures.length; i++) {
      const [agent, state, media] = fixtures[i];
      await db.query(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,approved_revision,visibility,document,created_at)
        VALUES($1,$2,$3,1,1,'public',$4::jsonb,0)`,
        [-913500-i,agent,state,JSON.stringify({title:'保留标题',body:'保留正文',source:'AI Agent 生成的讨论与练习',evidence:'旧说明\n\n配图来源：'+credit,media,identity:'agent'})]);
    }
    const check = async () => {
      for (let i=0;i<fixtures.length;i++) {
        const {rows} = await db.query('SELECT document,revision,approved_revision FROM social_work_posts WHERE post_id=$1',[-913500-i]);
        const media = structuredClone(fixtures[i][2]);
        if (i===1) media[0].credit=credit;
        assert.deepEqual(rows[0].document,{title:'保留标题',body:'保留正文',media,identity:'agent'});
        assert.equal(rows[0].revision,1);
        assert.equal(rows[0].approved_revision,1);
      }
    };
    await db.exec(migration);
    await check();
    await db.exec(migration);
    await check();
    console.log('Post provenance removed for all authors/drafts/publications; media credits and repeated execution verified.');
  } finally { await db.exec('ROLLBACK'); }
}
