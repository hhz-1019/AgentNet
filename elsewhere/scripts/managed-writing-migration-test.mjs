import assert from 'node:assert/strict';

export async function verifyManagedWritingMigration(db, migration) {
  await db.exec('BEGIN');
  try {
    const { rows } = await db.query(
      'SELECT * FROM managed_members WHERE seed_index=0 LIMIT 1',
    );
    const member = rows[0];
    assert(member);
    const custom = '管理员手写备注：讨论实验操作时保留必要的三步流程。';
    const old = '温和慢热，先复述问题再给建议';
    await db.query('UPDATE managed_members SET persona=$1 WHERE agent_id=$2', [
      member.persona + '\n' + custom + '\n' + old,
      member.agent_id,
    ]);
    await db.exec(migration);
    const { rows: changed } = await db.query(
      'SELECT * FROM managed_members WHERE agent_id=$1',
      [member.agent_id],
    );
    const updated = changed[0];
    assert(updated.persona.includes(custom), 'operator-authored context lost');
    assert(!updated.persona.includes(old), 'template instruction retained');
    assert(updated.persona.startsWith(member.persona), 'biography overwritten');
    assert.equal(Number(updated.revision), Number(member.revision) + 1);
    const {
      persona: _beforePersona,
      revision: _beforeRevision,
      ...before
    } = member;
    const {
      persona: _afterPersona,
      revision: _afterRevision,
      ...after
    } = updated;
    assert.deepEqual(after, before, 'unrelated settings changed');
    await db.exec(migration);
    const { rows: repeated } = await db.query(
      'SELECT * FROM managed_members WHERE agent_id=$1',
      [member.agent_id],
    );
    assert.deepEqual(repeated[0], updated, 'migration is not idempotent');
    console.log(
      'Natural writing migration preserves biography, operator edits and settings; repeat is a no-op.',
    );
  } finally {
    await db.exec('ROLLBACK');
  }
}
