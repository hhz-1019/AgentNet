// Explicit synthetic HTTP fixture: UI regression only, never production evidence.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { analyticsPreview } from '../web/analytics-preview.ts';

await mkdir('.impeccable/review', { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 4328, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let status = 200,
  calls = 0,
  heartbeat = 0,
  requestedDays = 0,
  empty = false;
await page.route('**/api/v2/**', async (route) => {
  const url = new URL(route.request().url());
  const send = (data) => route.fulfill({ json: { data } });
  if (url.pathname.endsWith('/console/session'))
    return send({
      agent_id: 'analytics-admin',
      agent_name: '测试管理员',
      short_id: 'ADMIN',
      owner_uid: 'fixture',
      owner_bound: true,
      onboarding: { state: 'completed', current_step: 5, revision: 1 },
    });
  if (url.pathname.endsWith('/analytics/heartbeat')) {
    heartbeat++;
    return send({ recorded: true });
  }
  if (url.pathname.endsWith('/console/analytics')) {
    calls++;
    requestedDays = Number(url.searchParams.get('days'));
    if (status !== 200)
      return route.fulfill({
        status,
        json: {
          error: {
            code: 'TEST_ERROR',
            message: status === 403 ? '此账号没有运营管理权限' : '测试连接中断',
          },
        },
      });
    const data = analyticsPreview(requestedDays);
    if (empty) {
      for (const key of Object.keys(data.metrics)) data.metrics[key] = 0;
      data.metrics.retention_eligible = null;
      data.metrics.retention_returned = null;
      data.metrics.yesterday_dau = null;
      data.trend = data.trend.map((p) => ({
        ...p,
        dau: null,
        new_users: 0,
        active_agents: 0,
      }));
      data.retention = data.retention.map((p) => ({
        ...p,
        registered: 0,
        eligible: null,
        retained: null,
      }));
      data.features = data.features.map((p) => ({
        ...p,
        events: 0,
        agents: 0,
      }));
    }
    return send(data);
  }
  return route.fulfill({
    status: 404,
    json: { error: { message: '未配置测试接口' } },
  });
});
try {
  await page.goto('http://127.0.0.1:4328/dashboard/analytics');
  await page.getByText('1,248', { exact: true }).first().waitFor();
  assert.equal(requestedDays, 7);
  assert.equal(heartbeat, 1);
  await page.getByRole('button', { name: '近 30 天', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.analytics-chart-column').length === 30,
  );
  assert.equal(requestedDays, 30);
  await page.getByRole('button', { name: '新增用户', exact: true }).click();
  await page.locator('.analytics-chart-column').first().focus();
  assert.match(
    await page.locator('.analytics-chart-readout').innerText(),
    /新增用户/,
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const download = await downloadPromise;
  const content = await readFile(await download.path(), 'utf8');
  assert.ok(content.startsWith('\uFEFF'));
  assert.match(content, /第 7 天返回/);
  assert.match(content, /30/);
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.analytics-chart-column').length === 7,
  );
  await page.getByRole('button', { name: '日活跃用户', exact: true }).click();
  await page.getByRole('button', { name: '暂停自动刷新' }).click();
  await page.clock.install();
  const pausedCalls = calls;
  await page.clock.fastForward(20000);
  assert.equal(calls, pausedCalls);
  await page.getByRole('button', { name: '开启自动刷新' }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('.analytics-actions button:nth-child(2)')
        .disabled,
  );
  const resumedCalls = calls;
  await page.clock.fastForward(16000);
  await page.waitForFunction(
    () =>
      !document.querySelector('.analytics-actions button:nth-child(2)')
        .disabled,
  );
  assert.ok(calls > resumedCalls, 'auto refresh did not poll');
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: '.impeccable/review/analytics-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'mobile document overflow',
  );
  await page.screenshot({
    path: '.impeccable/review/analytics-mobile.png',
    fullPage: true,
  });
  status = 503;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /上次成功快照/);
  assert.equal(
    await page.getByRole('button', { name: '导出 CSV' }).isDisabled(),
    true,
  );
  status = 200;
  empty = true;
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page
    .getByText('暂未形成可计算的完整留存样本。', { exact: false })
    .waitFor();
  assert.equal(await page.locator('.analytics-ratio strong').innerText(), '—');
  assert.equal(
    await page.locator('.analytics-retention-stat strong').innerText(),
    '—',
  );
  await page.screenshot({
    path: '.impeccable/review/analytics-empty.png',
    fullPage: true,
  });
  status = 403;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('需要管理员权限', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.analytics-kpis').count(),
    0,
    'cached admin metrics survived revocation',
  );
  const forbiddenCalls = calls;
  await page.clock.fastForward(20000);
  assert.equal(calls, forbiddenCalls);
  assert.deepEqual(errors, []);
  console.log(
    'Analytics UI: range, chart keyboard, CSV, polling/pause, mobile, stale error, empty coverage and permission revocation passed. Screenshots use synthetic fixtures.',
  );
} finally {
  await browser.close();
  await server.close();
}
