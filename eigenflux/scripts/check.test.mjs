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
      EMBEDDING_DISABLED: 'false',
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

await test('public elsewhere installer uses Console-first setup and refreshes stale skills', () => {
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
  for (const recipe of [
    'Dockerfile.web',
    'Dockerfile.host',
    'Dockerfile.core',
  ]) {
    assert(
      readFileSync(new URL('../' + recipe, import.meta.url), 'utf8').includes(
        JSON.parse(publicFile('release.json')).cli_version,
      ),
      recipe,
    );
  }
  for (const value of [shell, powershell]) {
    assert(value.includes(JSON.parse(publicFile('release.json')).cli_version));
    assert.match(value, /agentnet-handoff/);
    assert.match(value, /agentnet-social/);
    assert(value.includes('references/behavior.md'));
    assert(value.includes('references/daily-review.md'));
    assert(value.includes('references/host-context.md'));
    assert.match(value, /auto_skill_sync/);
    assert.match(value, /agentnet-onboarding/);
    assert.doesNotMatch(value, /eigenflux\.ai\/install/);
    assert.doesNotMatch(
      value,
      /raw\.githubusercontent|github\.com\/.+releases/,
    );
  }
  assert.match(install, /references\/behavior\.md/);
  assert.match(install, /agentnet-onboarding\/SKILL\.md/);
  assert.match(join, /https:\/\/inspiralai\.com\/install\.md/);
  const onboardingVersion = JSON.parse(
    publicFile('release.json'),
  ).onboarding_version;
  assert(skill.includes(onboardingVersion));
  assert(install.includes(onboardingVersion));
  assert.match(skill, /heartbeat plan --onboarding/);
  assert.match(skill, /简洁资料契约/);
  assert.match(skill, /宿主强制审批/);
  assert.doesNotMatch(skill, /Do not combine the three user choices/);
  assert.match(skill, /scheduler_prompt/);
  assert.match(skill, /\/dashboard\/register/);
  assert.match(skill, /不是一次性认领/);
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

await test('disabled vectors need no model credentials but retain index dimensions',()=>{
 const disabled={...env,EMBEDDING_DISABLED:'true',EMBEDDING_API_KEY:'',EMBEDDING_BASE_URL:'',EMBEDDING_MODEL:''};
 assert(!checkConfig(disabled).some(e=>/EMBEDDING_(API_KEY|BASE_URL|MODEL)/.test(e)));
 assert(checkConfig({...disabled,EMBEDDING_DIMENSIONS:'0'}).some(e=>e.includes('EMBEDDING_DIMENSIONS')));
});

await test('deferred provider checks still reject stale registration origins',()=>{
 const configured={...env,CONSOLE_V2_PUBLIC_URL:env.PUBLIC_BASE_URL,CONSOLE_V2_ALLOWED_ORIGINS:env.PUBLIC_BASE_URL};
 assert.deepEqual(checkConfig(configured,{providers:false}),[]);
 assert(checkConfig({...configured,CONSOLE_V2_PUBLIC_URL:'https://elsewhere.twintalk.cn'},{providers:false}).some(x=>x.includes('CONSOLE_V2_PUBLIC_URL')));
 assert(checkConfig({...configured,CONSOLE_V2_ALLOWED_ORIGINS:'https://elsewhere.twintalk.cn'},{providers:false}).some(x=>x.includes('CONSOLE_V2_ALLOWED_ORIGINS')));
});
