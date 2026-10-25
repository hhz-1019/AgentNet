import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const migrations = new URL('../../core/migrations/', import.meta.url);
const forwardName = '000156_elsewhere_aggregate_views.sql';
const views = [
  'grafana_pgc_audience_reach_24h',
  'grafana_pgc_demand_supply_24h',
  'grafana_pgc_feedback_7d',
  'grafana_pgc_surface_7d',
  'grafana_pgc_profile_completeness',
  'pgc_feedback_outcomes_7d',
];

for (const previousDefinitions of [true, false]) await test(`aggregate migration preserves identities, events and privileges (${previousDefinitions ? 'existing database' : 'fresh schema'})`, async () => {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  try {
    await db.exec('CREATE ROLE grafana_ro_v2; CREATE ROLE pgc_demand;');
    // Recreate an already-installed database with previous classification rules.
    // The old fixture domain is intentionally unrelated to any live account.
    for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql') && n < forwardName).sort()) {
      let source = (await readFile(new URL(name, migrations), 'utf8')).split('-- +goose Down')[0].replace(/\bCONCURRENTLY\b/g, '');
      if (previousDefinitions && /^0000(?:75|81|82|83)_/.test(name)) {
        source = source.replaceAll('elsewhere.internal', 'previous.invalid').replaceAll('bot.elsewhere', 'bot.previous').replaceAll('pgc.elsewhere', 'pgc.previous');
      }
      await db.exec(source);
    }
    const now = Date.now();
    await db.exec(`
      INSERT INTO agents(agent_id,email,agent_name,created_at,updated_at) VALUES
        (9156001,'source@pgc.elsewhere.internal','来源',1,1),
        (9156002,'reader@example.com','读者',1,1),
        (9156003,'internal@bot.elsewhere.internal','内部账号',1,1);
      INSERT INTO agent_profiles(agent_id,keywords,updated_at) VALUES(9156002,'research',1);
      INSERT INTO raw_items(item_id,author_agent_id,raw_content,created_at) VALUES(9156001,9156001,'research source',1);
      INSERT INTO processed_items(item_id,domains,keywords,updated_at) VALUES(9156001,'research','research',1);
      INSERT INTO replay_logs(id,impression_id,agent_id,item_id,served_at,created_at,delivered) VALUES
        (9156001,'brand-view-1',9156002,9156001,${now},${now},true),
        (9156002,'brand-view-2',9156003,9156001,${now},${now},true);
      INSERT INTO feedback_logs(stream_message_id,agent_id,item_id,score,feedback_at,created_at) VALUES
        ('brand-view-1',9156002,9156001,2,${now},${now}),
        ('brand-view-2',9156003,9156001,2,${now},${now});
    `);
    const before = (await db.query('SELECT * FROM agents ORDER BY agent_id')).rows;
    const original = (await db.query('SELECT * FROM grafana_pgc_audience_reach_24h')).rows[0];
    assert.equal(Number(original.pgc_reached_agents), previousDefinitions ? 0 : 1);
    assert.equal(Number(original.all_deliveries), previousDefinitions ? 2 : 1);
    const dependency = (await db.query("SELECT 'grafana_pgc_demand_supply_24h_snapshot'::regclass::oid AS oid")).rows[0].oid;
    const [up, down] = (await readFile(new URL(forwardName, migrations), 'utf8')).split('-- +goose Down');
    await db.exec(`BEGIN; ${up} COMMIT;`);
    assert.deepEqual((await db.query('SELECT * FROM agents ORDER BY agent_id')).rows, before);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM replay_logs')).rows[0].n), 2);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM feedback_logs')).rows[0].n), 2);
    const current = (await db.query('SELECT * FROM grafana_pgc_audience_reach_24h')).rows[0];
    assert.equal(Number(current.pgc_reached_agents), 1);
    assert.equal(Number(current.all_deliveries), 1);
    assert.equal(Number((await db.query('SELECT sum(strong_positive_events) AS n FROM grafana_pgc_strong_feedback_daily')).rows[0].n), 1);
    assert.equal((await db.query("SELECT 'grafana_pgc_demand_supply_24h_snapshot'::regclass::oid AS oid")).rows[0].oid, dependency);
    for (const name of views) {
      const row = (await db.query('SELECT pg_get_viewdef($1::regclass) AS definition, reloptions FROM pg_class WHERE oid=$1::regclass', [name])).rows[0];
      assert.doesNotMatch(row.definition, /previous/);
      assert.ok(row.reloptions.includes('security_barrier=true'));
      const role = name === 'pgc_feedback_outcomes_7d' ? 'pgc_demand' : 'grafana_ro_v2';
      assert.equal((await db.query('SELECT has_table_privilege($1,$2,\'SELECT\') AS allowed', [role, name])).rows[0].allowed, true);
    }
    assert.equal((await db.query("SELECT has_table_privilege('grafana_ro_v2','grafana_pgc_strong_feedback_daily','SELECT') AS allowed")).rows[0].allowed, true);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM pg_index WHERE indrelid='grafana_pgc_strong_feedback_daily'::regclass AND indisunique")).rows[0].n), 1);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.relname = ANY($1) AND a.grantee=0", [[...views, 'grafana_pgc_strong_feedback_daily']])).rows[0].n), 0);
    await db.exec(down);
    assert.equal((await db.query("SELECT pg_get_viewdef('grafana_pgc_audience_reach_24h'::regclass) AS definition")).rows[0].definition.includes('previous'), false);
  } finally {
    await db.close();
  }
});
