// Browser fixtures exercise the real React form; no provider receives a request.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 4337, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const session = {
  agent_id: '1',
  short_id: 'TEST',
  agent_name: '测试 Agent',
  bio: '',
  email: '',
  email_bound: false,
  owner_uid: '',
  owner_bound: false,
  runtime_name: '',
  runtime_version: '',
  device_name: '',
  onboarding: { state: 'pending', current_step: 1, revision: 1 },
};
let sends = 0,
  registrations = 0,
  registered = false,
  failSend = true;
const fulfill = (route, data) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
await page.route('**/api/v2/**', async (route) => {
  const path = new URL(route.request().url()).pathname.replace('/api/v2/', '');
  const body = route.request().postDataJSON();
  if (path === 'console/session') return fulfill(route, session);
  if (path === 'agents/me/onboarding-draft')
    return fulfill(route, {
      onboarding: session.onboarding,
      draft: { data: {} },
    });
  if (path === 'console/twin')
    return fulfill(route, {
      revision: 1,
      agreement_accepted: true,
      profile: {
        name: '',
        basic_info: {},
        persona: { traits: {} },
        episodes: [],
        knowledge: [],
        relationships: [],
        current_goal: '',
      },
    });
  if (path === 'console/twin/policy')
    return fulfill(route, {
      revision: 0,
      daily_posts: 3,
      daily_searches: 20,
      daily_feedback: 10,
    });
  if (path === 'auth/phone/challenges') {
    sends++;
    assert.equal(body.phone, '13800138000');
    assert.equal(body.purpose, 'register');
    if (failSend)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'PHONE_AUTH_UNAVAILABLE',
            message: '手机号验证暂不可用，请稍后重试',
          },
        }),
      });
    return fulfill(route, {
      challenge_id: 'ph_fixture',
      retry_after: 60,
      expires_in: 300,
    });
  }
  if (path === 'auth/uid/register') {
    registrations++;
    assert.equal(body.phone, '13800138000');
    assert.equal(body.code, '123456');
    assert.equal(body.challenge_id, 'ph_fixture');
    assert.equal(body.password, 'test-password-123');
    registered = true;
    session.owner_bound = true;
    session.owner_uid = '10000';
    return fulfill(route, {
      uid: '10000',
      recovery_key: 'rk_test_fixture_not_a_real_secret',
    });
  }
  if (path === 'auth/uid/login')
    return fulfill(route, { uid: '10000', agents: [] });
  throw Error(`unexpected request ${path}`);
});
try {
  await mkdir('.agentnet-audit', { recursive: true });
  await page.goto('http://127.0.0.1:4337/dashboard');
  await page.getByRole('heading', { name: '验证手机号，创建账号' }).waitFor();
  const submit = page.getByRole('button', {
    name: '创建账号并认领 Agent',
    exact: true,
  });
  assert.equal(await submit.isDisabled(), true);
  await page.getByLabel('手机号', { exact: true }).fill('123');
  assert.equal(
    await page
      .getByRole('button', { name: '获取验证码', exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel('手机号', { exact: true }).fill('+8613800138000');
  assert.equal(
    await page
      .getByLabel('手机号', { exact: true })
      .evaluate((input) => input.checkValidity()),
    true,
    '+86 phone must pass native form validation',
  );
  await page.getByLabel('手机号', { exact: true }).fill('13800138000');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page
    .getByText('手机号验证暂不可用，请稍后重试', { exact: true })
    .waitFor();
  assert.equal(await submit.isDisabled(), true);
  failSend = false;
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page.getByText('验证码已发送，5 分钟内有效', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: /秒后重发/ }).isDisabled(),
    true,
  );
  await page.getByLabel('短信验证码', { exact: true }).fill('123456');
  await page.getByLabel('账号密码', { exact: true }).fill('test-password-123');
  await page.screenshot({
    path: '.agentnet-audit/phone-registration-desktop.png',
  });
  // Changing phone invalidates the browser's old challenge and code.
  await page.getByLabel('手机号', { exact: true }).fill('13800138001');
  assert.equal(await submit.isDisabled(), true);
  assert.equal(
    await page.getByLabel('短信验证码', { exact: true }).inputValue(),
    '',
  );
  await page.reload();
  await page.getByLabel('手机号', { exact: true }).fill('13800138000');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page.getByText('验证码已发送，5 分钟内有效', { exact: true }).waitFor();
  await page.getByLabel('短信验证码', { exact: true }).fill('123456');
  await page.getByLabel('账号密码', { exact: true }).fill('test-password-123');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.agentnet-audit/phone-registration-mobile.png',
  });
  await page.getByRole('checkbox').check();
  await submit.click();
  await page.getByRole('heading', { name: '确认你的基础资料' }).waitFor();
  await page.getByText('10000', { exact: true }).waitFor();
  assert.equal(registered, true);
  assert.equal(registrations, 1);
  assert.equal(sends, 3);
  // Existing password/recovery login remains reachable.
  session.owner_bound = false;
  session.owner_uid = '';
  await page.reload();
  await page.getByRole('button', { name: '已有 UID，登录原账号' }).click();
  await page.getByLabel('账号 UID', { exact: true }).fill('10000');
  await page.getByLabel('账号密码', { exact: true }).fill('test-password-123');
  await page
    .getByRole('button', { name: '登录并选择 Agent', exact: true })
    .click();
  await page.getByRole('heading', { name: '选择这个运行环境的身份' }).waitFor();
  await page.getByRole('button', { name: '返回登录', exact: true }).click();
  await page.getByRole('button', { name: '忘记密码，用恢复密钥找回' }).click();
  await page.getByLabel('注册时保存的恢复密钥').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: phone form validates input, fails closed, handles send failures, counts down, invalidates changed-phone proof, submits numeric registration, keeps UID login/recovery; responsive 360–1440px',
  );
} finally {
  await browser.close();
  await server.close();
}
