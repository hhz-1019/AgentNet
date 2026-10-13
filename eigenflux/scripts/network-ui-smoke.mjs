import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const capture = process.argv.includes('--capture');
const server = await createServer({
  configFile: resolve('eigenflux/web/vite.config.mjs'),
  server: { host: '127.0.0.1', port: 4327, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
});
const errors = [];
await mkdir('.impeccable/review', { recursive: true });
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 960],
    ['mobile', 390, 844],
  ]) {
    if (process.argv.includes('--mobile') && name !== 'mobile') continue;
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
      colorScheme: 'light',
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const writes = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET')
        writes.push(r.url());
    });
    await page.goto('http://127.0.0.1:4327/preview');
    await page.getByRole('heading', { name: '有些事，等你决定。' }).waitFor();
    assert.equal(
      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link')
        .count(),
      2,
    );
    assert.equal(
      await page.getByRole('link', { name: /通讯录|发现|发布|消息/ }).count(),
      0,
    );
    assert.equal(await page.locator('.graph-node').count(), 12);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      name + ' overflow',
    );
    if (capture)
      await page.screenshot({
        path: `.impeccable/review/${name}.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: '切换至夜间模式' }).click();
    assert.equal(
      await page.locator('html').getAttribute('data-appearance'),
      'night',
    );
    if (capture)
      await page.screenshot({
        path: `.impeccable/review/${name}-night.png`,
        fullPage: true,
      });
    await page.reload();
    await page.getByRole('button', { name: '切换至白天模式' }).waitFor();
    assert.equal(
      await page.locator('html').getAttribute('data-appearance'),
      'night',
    );
    await page.getByRole('button', { name: '切换至白天模式' }).click();
    await page
      .getByRole('button', { name: '林间，1 件待决定，0 条未读', exact: true })
      .click();
    await page.getByRole('button', { name: '同意联系', exact: true }).waitFor();
    if (capture)
      await page.screenshot({
        path: `.impeccable/review/${name}-decision.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: '同意联系', exact: true }).click();
    await page.getByText('已建立联系', { exact: true }).first().waitFor();
    assert.equal(
      await page.getByRole('button', { name: '同意联系', exact: true }).count(),
      0,
    );
    await page.getByRole('link', { name: '我的 Agent', exact: true }).click();
    await page.getByLabel('昵称', { exact: true }).waitFor();
    if (capture)
      await page.screenshot({
        path: `.impeccable/review/${name}-profile.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: '切换至夜间模式' }).click();
    if (capture)
      await page.screenshot({
        path: `.impeccable/review/${name}-profile-night.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: '切换至白天模式' }).click();
    if (capture && name === 'mobile') {
      await page.getByRole('button', { name: '关于我', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: '.impeccable/review/mobile-profile-expanded.png',
        fullPage: true,
      });
      await page.getByRole('button', { name: '收起资料', exact: true }).click();
    }
    await page.getByLabel('昵称', { exact: true }).fill('测试中的 Agent');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '画像已保存' }).waitFor();
    await page.getByLabel('探索间隔', { exact: true }).selectOption('60');
    await page.getByLabel('报告间隔', { exact: true }).selectOption('72');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByText('活动配置已保存', { exact: true }).waitFor();
    await page.getByRole('link', { name: '首页', exact: true }).click();
    await page.getByRole('link', { name: '我的 Agent', exact: true }).click();
    assert.equal(
      await page.getByLabel('昵称', { exact: true }).inputValue(),
      '测试中的 Agent',
    );
    assert.equal(
      await page.getByLabel('探索间隔', { exact: true }).inputValue(),
      '60',
    );
    assert.equal(writes.length, 0, 'preview must never mutate real endpoints');
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Network UI passed: desktop/mobile, scoped navigation, decision, portrait/policy edits, preview isolation, no overflow or browser exceptions.',
  );
} finally {
  await browser.close();
  await server.close();
}
