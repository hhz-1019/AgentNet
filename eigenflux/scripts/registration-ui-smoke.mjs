import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { registrationPreview } from '../web/registration-preview.ts';
await mkdir('.impeccable/review', { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 4336, strictPort: true },
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let status = 200,
  requested = '',
  empty = false;
await page.route('**/api/v2/**', async (route) => {
  const url = new URL(route.request().url()),
    path = url.pathname.replace('/api/v2/', '');
  if (path === 'console/session')
    return route.fulfill({
      json: {
        data: {
          agent_id: 'admin-test',
          owner_uid: 'admin',
          owner_bound: true,
          agent_name: '测试管理员',
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        },
      },
    });
  if (path === 'console/analytics/heartbeat')
    return route.fulfill({ json: { data: { recorded: true } } });
  if (path === 'console/admin/registration') {
    requested = url.search;
    if (status !== 200)
      return route.fulfill({
        status,
        json: {
          error: {
            code: 'TEST_ERROR',
            message: status === 403 ? '此账号没有运营管理权限' : '服务暂不可用',
          },
        },
      });
    const data = registrationPreview(path + url.search);
    if (empty) {
      data.total = 0;
      data.journeys = [];
      data.summary = {
        started: 0,
        completed: 0,
        dormant: 0,
        active: 0,
        legacy_pending: 0,
      };
      data.funnel.forEach((f) => {
        f.reached = 0;
        f.stalled = 0;
      });
    }
    return route.fulfill({ json: { data } });
  }
  throw Error('Unexpected API ' + path);
});
try {
  await page.goto('http://127.0.0.1:4336/dashboard/registration');
  await page.getByText('找到 32 条记录', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('navigation', { name: '管理员栏目' })
      .getByRole('link')
      .count(),
    4,
  );
  assert.equal(
    await page.locator('.registration-records tbody tr').count(),
    25,
  );
  await page.screenshot({
    path: '.impeccable/review/registration-desktop.png',
    fullPage: true,
  });
  await page.screenshot({
    path: '.impeccable/review/registration-desktop-top.png',
  });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('第 2 / 2 页', { exact: false }).waitFor();
  assert.equal(await page.locator('.registration-records tbody tr').count(), 7);
  await page.getByRole('textbox', { name: '搜索注册记录' }).fill('80002');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('找到 1 条记录', { exact: true }).waitFor();
  await page.getByText('查看记录', { exact: true }).click();
  await page.getByText('PHONE_CODE_INVALID', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索注册记录' }).fill('');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('combobox', { name: '注册状态' }).selectOption('legacy');
  await page.getByText('找到 3 条记录', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: '统计周期' }).selectOption('30');
  await page.waitForResponse((r) => r.url().includes('days=30'));
  assert.ok(requested.includes('days=30'));
  await page.getByRole('combobox', { name: '未继续时长' }).selectOption('1440');
  await page.waitForResponse((r) => r.url().includes('idle=1440'));
  assert.ok(requested.includes('idle=1440'));
  await page.getByRole('combobox', { name: '注册状态' }).selectOption('all');
  await page.getByText('找到 32 条记录', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const nav = document
      .querySelector('.admin-nav nav')
      .getBoundingClientRect();
    const active = document
      .querySelector('.admin-nav [aria-current="page"]')
      .getBoundingClientRect();
    return active.left >= nav.left - 1 && active.right <= nav.right + 1;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '.impeccable/review/registration-mobile.png',
    fullPage: true,
  });
  await page.screenshot({
    path: '.impeccable/review/registration-mobile-top.png',
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'mobile overflow',
  );
  status = 503;
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page.locator('.registration-records tbody tr').count(),
    25,
  );
  status = 200;
  empty = true;
  await page.getByRole('button', { name: '重新读取' }).click();
  await page.getByText('没有符合条件的注册记录。', { exact: false }).waitFor();
  assert.equal(await page.locator('.registration-records tbody tr').count(), 0);
  empty = false;
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await page.getByText('找到 32 条记录', { exact: true }).waitFor();
  status = 403;
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await page.getByText('此账号没有运营管理权限', { exact: false }).waitFor();
  assert.equal(await page.locator('.registration-records tbody tr').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'Registration UI: four tabs, funnel, thresholds, filters, pagination, historical gaps, errors, permission clearing and desktop/mobile passed. Synthetic fixtures only.',
  );
} finally {
  await browser.close();
  await server.close();
}
