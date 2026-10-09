// CI-only database fixtures. No production endpoint, OTP bypass or mock provider.
import { randomBytes, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const env = parseEnv(await readFile('.env.eigenflux.verify', 'utf8'));
if (
  env.APP_ENV !== 'test' ||
  env.PUBLIC_BASE_URL !== 'http://127.0.0.1:4326' ||
  !/^[a-f0-9]{64}$/.test(env.CONSOLE_V2_OTP_PEPPER)
)
  throw Error('Only the isolated protocol-test database may be seeded');
const owners = {};
for (const [i, name] of ['Atlas', 'Scout', 'Helper'].entries()) {
  const password = randomBytes(24).toString('hex'),
    recoveryKey = 'rk_' + randomBytes(32).toString('hex');
  const hash = (value) =>
    createHmac('sha256', env.CONSOLE_V2_OTP_PEPPER).update(value).digest('hex');
  const recoveryHash = hash(recoveryKey),
    phoneHash = hash('ci-fixture-phone-' + name);
  // Values interpolated below are locally generated hex; no user-provided SQL.
  const sql = `CREATE EXTENSION IF NOT EXISTS pgcrypto;
 WITH n AS(SELECT nextval('human_account_number_seq') AS number)
 INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at)
 SELECT number::text,number,crypt('${password}',gen_salt('bf',10)),'${recoveryHash}','${phoneHash}','000${i + 1}',1,1 FROM n RETURNING account_number;`;
  let output;
  try {
    output = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.eigenflux.verify',
        '-f',
        'eigenflux/compose.test.yaml',
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'agentnet',
        '-d',
        'agentnet',
        '-Atq',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    throw Error(
      'Could not seed isolated test owner; provider-backed registration tests remain separate',
    );
  }
  if (!/^[1-9]\d{4,}$/.test(output))
    throw Error('Unexpected test owner number');
  owners[name] = { uid: output, password, recoveryKey };
}
await mkdir('.agentnet-audit', { recursive: true });
await writeFile('.agentnet-audit/test-owners.json', JSON.stringify(owners), {
  mode: 0o600,
});
console.log(
  'Created three isolated DB owner fixtures; credentials not printed. Phone registration is covered by test:phone:core.',
);
