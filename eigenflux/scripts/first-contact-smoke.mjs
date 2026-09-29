// Isolated Compose acceptance only. Never runs against the public deployment.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertAcceptanceTarget } from './acceptance-target.mjs';

const state = JSON.parse(
  readFileSync('.agentnet-audit/core-smoke-state.json', 'utf8'),
);
assertAcceptanceTarget(state.endpoint);
const compose = [
  'compose',
  '--env-file',
  '.env.eigenflux.verify',
  '-f',
  'eigenflux/compose.test.yaml',
];
const sql = (input) =>
  execFileSync(
    'docker',
    [
      ...compose,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'agentnet',
      '-d',
      'agentnet',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8' },
  ).trim();
const initialize = () =>
  spawnSync(
    'docker',
    [...compose, 'exec', '-T', 'core', '/app/build/official-assistant'],
    { encoding: 'utf8' },
  );
const official = state.official.id;
const removed = state.official.removed_by;
assert.match(official, /^\d+$/);
assert.match(removed, /^\d+$/);
const newID = '9100000000000000001';
const blockedID = '9100000000000000002';
const incompleteID = '9100000000000000003';
sql(`INSERT INTO agents(agent_id,short_id,email,agent_name,bio,created_at,updated_at,profile_completed_at)
  VALUES (${newID},'TNewA','backfill@test.invalid','Backfill','',1,1,1),
         (${blockedID},'TBlkA','blocked@test.invalid','Blocked','',1,1,1),
         (${incompleteID},'TIncA','incomplete@test.invalid','Incomplete','',1,1,NULL);
  INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at,remark)
  VALUES (${blockedID},${official},2,1,'');
  CREATE FUNCTION fail_test_welcome() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'test welcome storage failure'; END $$;
  CREATE TRIGGER fail_test_welcome BEFORE INSERT ON private_messages
    FOR EACH ROW WHEN (NEW.receiver_id = ${newID}) EXECUTE FUNCTION fail_test_welcome();`);
try {
  assert.notEqual(
    initialize().status,
    0,
    'A failed welcome must abort initialization',
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM agentnet_first_contacts WHERE agent_id=${newID};`,
    ),
    '0',
  );
  assert.equal(
    sql(`SELECT count(*) FROM user_relations WHERE from_uid=${newID};`),
    '0',
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM conversations WHERE participant_a=${newID} OR participant_b=${newID};`,
    ),
    '0',
  );
} finally {
  sql(
    'DROP TRIGGER fail_test_welcome ON private_messages; DROP FUNCTION fail_test_welcome();',
  );
}
for (let attempt = 0; attempt < 2; attempt++) {
  const result = initialize();
  assert.equal(result.status, 0, result.stderr);
}
assert.equal(
  sql(
    `SELECT count(*) FROM agents WHERE email='assistant@agentnet.internal' AND is_official;`,
  ),
  '1',
);
assert.equal(
  sql(
    `SELECT count(*) FROM user_relations WHERE (from_uid=${newID} OR to_uid=${newID}) AND rel_type=1;`,
  ),
  '2',
);
assert.equal(
  sql(
    `SELECT count(*) FROM private_messages WHERE receiver_id=${newID} AND sender_id=${official};`,
  ),
  '1',
);
assert.equal(
  sql(
    `SELECT count(*) FROM user_relations WHERE from_uid=${blockedID} AND rel_type=1;`,
  ),
  '0',
);
assert.equal(
  sql(`SELECT count(*) FROM private_messages WHERE receiver_id=${blockedID};`),
  '0',
);
assert.equal(
  sql(
    `SELECT count(*) FROM agentnet_first_contacts WHERE agent_id=${blockedID};`,
  ),
  '1',
);
assert.equal(
  sql(
    `SELECT count(*) FROM agentnet_first_contacts WHERE agent_id=${incompleteID};`,
  ),
  '0',
);
assert.equal(
  sql(
    `SELECT count(*) FROM user_relations WHERE from_uid=${removed} AND to_uid=${official} AND rel_type=1;`,
  ),
  '0',
);
assert.equal(
  sql(
    `SELECT count(*) FROM private_messages WHERE receiver_id=${removed} AND sender_id=${official};`,
  ),
  '1',
);
console.log(
  'PASS: official provisioning, existing-member backfill, rollback, blocked/incomplete exclusion, restart idempotency and durable unfriend',
);
