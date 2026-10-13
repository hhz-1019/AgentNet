import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { membersPreview } from '../web/admin-members-preview.ts';
import { analyticsPreview } from '../web/analytics-preview.ts';
await mkdir('.impeccable/review', { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 4333, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let status = 200;
await page.route('**/api/v2/**', async (route) => {
  const url = new URL(route.request().url());
  const send = (data) => route.fulfill({ json: { data } });
  if (url.pathname.endsWith('/console/session'))
    return send({
      agent_id: 'test-admin',
      owner_uid: 'test-admin',
      agent_name: '测试管理员',
      owner_bound: true,
      onboarding: { state: 'completed', current_step: 5, revision: 1 },
    });
  if (url.pathname.endsWith('/analytics/heartbeat'))
    return send({ recorded: true });
  if (url.pathname.endsWith('/admin/members')) {
    if (status !== 200)
      return route.fulfill({
        status,
        json: { error: { message: '测试权限或网络故障' } },
      });
    return send(membersPreview(url.pathname + url.search));
  }
  if (url.pathname.endsWith('/console/analytics'))
    return send(analyticsPreview(Number(url.searchParams.get('days'))));
  if (url.pathname.endsWith('/console/managed'))
    return send({
      sponsor_number: 'test-admin',
      campaign: null,
      spent_fen: 0,
      members: [],
      runs: [],
      audit: [],
      worker_configured: false,
      model_configured: false,
    });
  return route.fulfill({
    status: 404,
    json: { error: { message: '无此测试接口' } },
  });
});
try {
  await page.goto('http://127.0.0.1:4333/dashboard/members');
  await page.getByText('找到 32 位真实用户', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('navigation', { name: '管理员栏目' })
      .getByRole('link')
      .count(),
    4,
  );
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('第 2 / 2 页', { exact: false }).waitFor();
  assert.equal(await page.locator('.members-table tbody tr').count(), 7);
  await page.getByRole('textbox', { name: '搜索成员' }).fill('120002');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('找到 1 位真实用户', { exact: true }).waitFor();
  await page.getByText('1 位身份', { exact: true }).click();
  await page.getByRole('link', { name: '示例 Agent 2' }).waitFor();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByText('找到 32 位真实用户', { exact: true }).waitFor();
  await page.getByLabel('成员状态').selectOption('unconnected');
  await page.getByText('找到 10 位真实用户', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByText('找到 32 位真实用户', { exact: true }).waitFor();
  await page.screenshot({
    path: '.impeccable/review/members-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'document overflow',
  );
  await page.screenshot({
    path: '.impeccable/review/members-mobile.png',
    fullPage: true,
  });
  await page.getByRole('textbox', { name: '搜索成员' }).fill('不存在');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('没有符合条件的真实用户。', { exact: false }).waitFor();
  status = 503;
  await page.getByRole('button', { name: '刷新列表' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /保留上次/);
  status = 403;
  await page.getByRole('button', { name: '重新读取' }).click();
  await page.getByText('需要管理员权限', { exact: true }).waitFor();
  assert.equal(await page.locator('.members-table').count(), 0);
  await page
    .getByRole('link', { name: '官方 Agent 管理', exact: true })
    .click();
  await page
    .getByRole('heading', { name: '官方 Agent 管理', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('navigation', { name: '管理员栏目' })
      .getByRole('link')
      .count(),
    4,
  );
  await page.getByRole('link', { name: '数据看板', exact: true }).click();
  await page.getByRole('heading', { name: '网站使用概览' }).waitFor();
  assert.equal(
    await page
      .getByRole('navigation', { name: '管理员栏目' })
      .getByRole('link')
      .count(),
    4,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Admin members UI: four-column navigation, real-member fixture, filters, pagination, identity expansion, error/permission states and mobile passed.',
  );
} finally {
  await browser.close();
  await server.close();
}
