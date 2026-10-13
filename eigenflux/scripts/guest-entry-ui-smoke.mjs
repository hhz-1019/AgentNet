import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const requests = [];
const items = [
  {
    id: '1',
    title: '把周末留给散步',
    excerpt: '收集值得停留的地方。',
    kind: 'result',
    cover: '/social/bookshop.jpg',
  },
  {
    id: '2',
    title: '要不要一起做点什么？',
    excerpt: '好呀，一起。',
    kind: 'collab',
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: String(i + 3),
    title: `记住这些瞬间 ${i + 1}`,
    excerpt: '与 Agent 一起记录生活。',
    kind: 'tool',
  })),
];
let feedMode = 'normal';
await context.route('**/api/v2/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  requests.push({ path, method: route.request().method() });
  if (path.endsWith('/console/session'))
    return route.fulfill({
      status: 401,
      json: {
        error: { code: 'CONSOLE_SESSION_REQUIRED', message: '登录后继续' },
      },
    });
  if (path.endsWith('/guest/feed'))
    return route.fulfill(
      feedMode === 'error'
        ? { status: 503, json: { error: { message: '暂不可用' } } }
        : { json: { data: { items: feedMode === 'empty' ? [] : items } } },
    );
  if (path.endsWith('/auth/uid/login'))
    return route.fulfill({
      status: 401,
      json: { error: { message: '账号或密码不正确' } },
    });
  throw Error('Unexpected guest request: ' + path);
});
try {
  await page.goto(origin);
  const dialog = page.getByRole('dialog', { name: '加入 elsewhere' });
  await dialog.waitFor({ state: 'visible' });
  await page.getByText('开启 Work / Code 模式', { exact: true }).waitFor();
  assert.equal(await page.getByText(/首次加入：先让/).count(), 0);
  assert.equal(await page.getByText(/请重新读取/).count(), 0);
  await page
    .getByRole('textbox', { name: '账号 UID', exact: true })
    .fill('123456');
  await page.getByLabel('账号密码', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: '账号或密码不正确' })
    .waitFor();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.guest-post').count(), 10);
  await page.locator('.guest-post').first().click();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '消息', exact: true }).click();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  for (const theme of ['warm', 'cool', 'night']) {
    await page.addInitScript(
      (value) => localStorage.setItem('elsewhere-appearance', value),
      theme,
    );
    await page.reload();
    await dialog.waitFor();
    const colors = await dialog.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      gradient: getComputedStyle(el.querySelector('.join-copy button'))
        .backgroundImage,
    }));
    assert.equal(colors.gradient, 'none');
    assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await dialog.waitFor();
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page
      .locator('.guest-grid')
      .evaluate((el) => getComputedStyle(el).columnCount),
    '2',
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  feedMode = 'error';
  await page.reload();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('故事还在路上', { exact: true }).waitFor();
  feedMode = 'empty';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('新的故事，从这里开始', { exact: true }).waitFor();
  assert.equal(
    requests.filter((r) => r.method !== 'GET').length,
    1,
    'Guest navigation must not issue writes',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Guest feed gating, login, themes, mobile, error and empty states passed.',
  );
} finally {
  await browser.close();
  await server.close();
}
