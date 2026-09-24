import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { checkConfig } from './check.mjs';
const env = parseEnv(
  readFileSync(new URL('../runtime.env.example', import.meta.url), 'utf8'),
);
Object.assign(env, {
  POSTGRES_PASSWORD: '1'.repeat(64),
  REDIS_PASSWORD: '2'.repeat(64),
  CONSOLE_V2_BOOTSTRAP_SECRET: '3'.repeat(64),
  CONSOLE_V2_OTP_PEPPER: '4'.repeat(64),
});
await test('deferred providers permit building, never mark activation ready', () => {
  assert.deepEqual(checkConfig(env, { providers: false }), []);
  assert(checkConfig(env).some((e) => e.includes('LLM_API_KEY')));
  assert(checkConfig(env).some((e) => e.includes('RESEND_API_KEY')));
});
await test('defer mode still rejects test OTP and disabled ownership verification', () => {
  assert(
    checkConfig({ ...env, OFFICIAL_TEST_OTP: '654321' }, { providers: false })
      .length,
  );
  assert(
    checkConfig(
      { ...env, ENABLE_EMAIL_VERIFICATION: 'false' },
      { providers: false },
    ).length,
  );
});
await test('secrets and origin validation remain mandatory', () => {
  assert(
    checkConfig(
      { ...env, CONSOLE_V2_OTP_PEPPER: env.CONSOLE_V2_BOOTSTRAP_SECRET },
      { providers: false },
    ).length,
  );
  assert(
    checkConfig(
      { ...env, PUBLIC_BASE_URL: 'https://example.org/path' },
      { providers: false },
    ).length,
  );
});
