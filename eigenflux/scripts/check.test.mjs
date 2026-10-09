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
  SMS_ACCESS_KEY_ID: 'test-sms-id',
  SMS_ACCESS_KEY_SECRET: 'test-sms-secret',
  SMS_SIGN_NAME: '测试签名',
  SMS_TEMPLATE_CODE: '100001',
  SMS_SCHEME_NAME: 'test-scheme',
});
await test('deferred providers permit building, never mark activation ready', () => {
  assert.deepEqual(checkConfig(env, { providers: false }), []);
  assert(checkConfig(env).some((e) => e.includes('LLM_API_KEY')));
  assert(!checkConfig(env).some((e) => /SMTP_|RESEND_/.test(e)));
});
await test('domestic providers need SMTP credentials, not a Resend key', () => {
  const configured = {
    ...env,
    EMAIL_PROVIDER: 'smtp',
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'ep-test',
    EMBEDDING_API_KEY: 'test-vector-key',
    EMBEDDING_BASE_URL:
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    SMTP_USERNAME: 'login@example.com',
    SMTP_PASSWORD: 'smtp-test-password',
    SMTP_FROM_EMAIL: 'elsewhere <login@example.com>',
  };
  assert.deepEqual(checkConfig(configured), []);
  assert(checkConfig({ ...configured, SMTP_PORT: '25' }).length);
  assert(
    checkConfig({ ...configured, SMTP_FROM_EMAIL: 'other@example.com' }).length,
  );
  assert(
    checkConfig({
      ...configured,
      SMTP_FROM_EMAIL: 'login@example.com\r\nBcc: other@example.com',
    }).length,
  );
  assert(checkConfig({ ...configured, EMAIL_PROVIDER: 'unknown' }).length);
  assert(
    checkConfig({
      ...configured,
      EMBEDDING_BASE_URL:
        'https://<workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    }).length,
  );
  assert(
    checkConfig({ ...configured, EMAIL_PROVIDER: 'resend' }).some((e) =>
      e.includes('RESEND_API_KEY'),
    ),
  );
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

await test('UID accounts need no mail service and cannot fall back to anonymous ownership', () => {
  const configured = {
    ...env,
    LLM_API_KEY: 'test-key',
    EMBEDDING_API_KEY: 'test-key',
    EMBEDDING_BASE_URL: 'https://example.com/v1',
  };
  assert.deepEqual(checkConfig(configured), []);
  assert(checkConfig({ ...configured, HUMAN_AUTH_MODE: '' }).length);
  assert(checkConfig({ ...configured, LLM_API_STYLE: 'unknown' }).length);
});

await test('public elsewhere installer keeps setup choices separate and pinned', () => {
  const publicFile = (name) =>
    readFileSync(new URL(`../web/public/${name}`, import.meta.url), 'utf8');
  const install = publicFile('install.md');
  const shell = publicFile('install.sh');
  const powershell = publicFile('install.ps1');
  const join = publicFile('join.md');
  const skill = readFileSync(
    new URL('../skills/agentnet-onboarding/SKILL.md', import.meta.url),
    'utf8',
  );
  for (const value of [shell, powershell]) {
    assert.match(value, /0\.0\.54-agentnet\.9/);
    assert.match(value, /agentnet-handoff/);
    assert.match(value, /auto_skill_sync/);
    assert.match(value, /agentnet-onboarding/);
    assert.doesNotMatch(value, /eigenflux\.ai\/install/);
    assert.doesNotMatch(
      value,
      /raw\.githubusercontent|github\.com\/.+releases/,
    );
  }
  assert.match(
    install,
    /Native recurring tasks and persistent command permissions/,
  );
  assert.match(join, /https:\/\/agentnet\.zeabur\.app\/install\.md/);
  assert.match(skill, /Console-first onboarding/);
  assert.match(skill, /twin_profile/);
  assert.match(skill, /mandatory tool approvals/);
  assert.doesNotMatch(skill, /Do not combine the three user choices/);
  assert.match(skill, /elsewhere 网络收件箱/);
  assert.match(skill, /\/dashboard\/handoff/);
});

await test('SMS settings fail closed and cap cannot be disabled', () => {
  const configured = {
    ...env,
    LLM_API_KEY: 'test',
    EMBEDDING_API_KEY: 'test',
    EMBEDDING_BASE_URL: 'https://example.com/v1',
  };
  assert(
    checkConfig({ ...configured, SMS_ACCESS_KEY_SECRET: '' }).some((e) =>
      e.includes('SMS_ACCESS_KEY_SECRET'),
    ),
  );
  assert(checkConfig({ ...configured, SMS_PROVIDER: 'mock' }).length);
  for (const value of ['0', '-1', '1000001', 'abc'])
    assert(
      checkConfig(
        { ...configured, SMS_DAILY_LIMIT: value },
        { providers: false },
      ).length,
    );
});
