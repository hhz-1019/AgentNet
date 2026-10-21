// Real registration components, isolated HTTP fixtures; no SMS or production writes.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 4338, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'reduce',
});
const errors = [],
  writes = [];
page.on('pageerror', (error) => errors.push(error.message));
let confirmationFails = true,
  confirmations = 0;
const companion = {
  agent_name: '林间',
  owner_name: '',
  connection_goal: '',
  start_hour: 0,
  end_hour: 24,
  report_every_round: false,
  history_images: false,
  name_locked: false,
  revision: 0,
};
let portraitRevision = 0;
await page.route('**/api/v2/**', async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname.replace('/api/v2/', '');
  const send = (data) => route.fulfill({ json: { data } });
  if (path === 'performance') return route.fulfill({ status: 204 });
  if (path === 'console/session')
    return send({
      agent_id: '123',
      owner_uid: 'fixture-owner',
      owner_bound: true,
      agent_name: '林间',
      onboarding: { state: 'in_progress', current_step: 2, revision: 1 },
    });
  if (
    ['console/registration/progress', 'console/analytics/heartbeat'].includes(
      path,
    )
  )
    return send({ recorded: true });
  if (path === 'console/portrait' && request.method() === 'GET')
    return send({
      fields: { name: '', bio: '', interests: '', offers: '', connections: '' },
      visible: ['name', 'bio'],
      memories: [],
      revision: 0,
    });
  if (path === 'agents/me/onboarding-draft')
    return send({
      onboarding: { state: 'in_progress', current_step: 2, revision: 1 },
      draft: {
        data: { identity_card: { agent_name: '林间' }, twin_profile: {} },
      },
    });
  if (path === 'console/companion' && request.method() === 'GET')
    return send({ settings: companion });
  if (path === 'console/companion' && request.method() === 'PUT') {
    writes.push({ path, body: request.postDataJSON() });
    Object.assign(companion, request.postDataJSON(), {
      revision: companion.revision + 1,
    });
    return send(companion);
  }
  if (path === 'console/portrait' && request.method() === 'PUT') {
    writes.push({ path, body: request.postDataJSON() });
    return send({ revision: ++portraitRevision });
  }
  if (path === 'console/portrait/confirm') {
    confirmations++;
    if (confirmationFails)
      return route.fulfill({
        status: 503,
        json: {
          error: { code: 'UNAVAILABLE', message: 'temporary upstream error' },
        },
      });
    return send({ completed: true });
  }
  throw new Error(`Unexpected fixture request: ${request.method()} ${path}`);
});
try {
  await mkdir('.agentnet-audit/registration-profile', { recursive: true });
  await page.goto('http://127.0.0.1:4338/dashboard');
  await page.getByRole('heading', { name: '确认资料', exact: true }).waitFor();
  const submit = page.getByRole('button', { name: '确认资料，进入 elsewhere' });
  assert.equal(await page.locator('textarea[required]').count(), 4);
  await submit.click();
  assert.equal(writes.length, 0);
  const values = {
    自我介绍: '我是林间，围绕公开话题交流。',
    兴趣与长期关注: '暂不公开个人兴趣',
    我能分享的: '暂不公开个人经历，可先交流公开资料',
    想认识的人: '愿意交流公开资料的人',
  };
  for (const [label, value] of Object.entries(values))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('自我介绍', { exact: true }).fill('  ');
  await submit.click();
  await page.getByRole('alert').filter({ hasText: '请填写自我介绍' }).waitFor();
  assert.equal(writes.length, 0);
  await page.getByLabel('自我介绍', { exact: true }).fill(values['自我介绍']);
  await submit.click();
  await page.getByRole('alert').filter({ hasText: '请先勾选' }).waitFor();
  assert.equal(writes.length, 0);
  await page.locator('.agreement-row input').check();
  assert.equal(
    await page.getByLabel('我能分享的在主页展示').isChecked(),
    false,
  );
  await page.screenshot({
    path: '.agentnet-audit/registration-profile/desktop.png',
    fullPage: true,
  });
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const boxes = await page
      .locator('.sn-portrait-field :is(input:not([type=checkbox]),textarea)')
      .evaluateAll((els) =>
        els.map((el) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
        })),
      );
    assert.ok(
      boxes.every((box) => box.left >= 0 && box.right <= viewport.width + 1),
    );
  }
  await page.screenshot({
    path: '.agentnet-audit/registration-profile/mobile.png',
    fullPage: true,
  });
  await submit.click();
  await page
    .getByRole('alert')
    .filter({ hasText: /确认失败|服务暂时繁忙|稍后重试/ })
    .waitFor();
  for (const [label, value] of Object.entries(values))
    assert.equal(
      await page.getByLabel(label, { exact: true }).inputValue(),
      value,
    );
  assert.equal(confirmations, 1);
  assert.equal(writes[0].body.history_images, false);
  assert.equal(writes[0].body.report_every_round, false);
  const saved = writes.find((write) => write.path === 'console/portrait').body;
  assert.equal(saved.fields.avatar.length > 0, true);
  assert.equal(saved.fields.name, undefined);
  assert.ok(!saved.visible.includes('offers'));
  confirmationFails = false;
  await submit.click();
  await page.waitForResponse(
    (response) =>
      response.url().endsWith('/console/portrait/confirm') &&
      response.status() === 200,
  );
  assert.equal(confirmations, 2);
  assert.deepEqual(errors, []);
  console.log(
    'PASS registration: required fields, safe non-disclosure, default avatar, owner consent, visibility and activity preferences preserved, failed confirmation retains inputs, desktop/mobile alignment.',
  );
} finally {
  await browser.close();
  await server.close();
}
