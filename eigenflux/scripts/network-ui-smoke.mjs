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
async function assertViewport(page, name) {
  const dimensions = await page.evaluate(() => {
    window.scrollTo(0, 1000);
    const shell = document
      .querySelector('.agent-workspace')
      .getBoundingClientRect();
    return {
      fitsWidth: document.documentElement.scrollWidth <= innerWidth,
      fitsHeight: document.documentElement.scrollHeight <= innerHeight,
      top: shell.top,
      height: shell.height,
      viewport: innerHeight,
      scroll: window.scrollY,
    };
  });
  assert.equal(dimensions.fitsWidth, true, name + ' horizontal overflow');
  assert.equal(dimensions.fitsHeight, true, name + ' vertical overflow');
  assert.equal(dimensions.top, 0, name + ' shell moved');
  assert.equal(dimensions.height, dimensions.viewport, name + ' shell height');
  assert.equal(dimensions.scroll, 0, name + ' document scrolled');
}
async function assertPanelScroll(page, name) {
  const panel = page.locator('.reader-scroll');
  const header = await page.locator('.network-header').boundingBox();
  const map = await page.locator('.network-map').boundingBox();
  await panel.evaluate((element) => {
    element.scrollTop = 0;
  });
  await panel.hover();
  await page.mouse.wheel(0, 650);
  await page.waitForFunction(
    () => document.querySelector('.reader-scroll').scrollTop > 0,
  );
  assert.deepEqual(
    await page.locator('.network-header').boundingBox(),
    header,
    name + ' header moved',
  );
  assert.deepEqual(
    await page.locator('.network-map').boundingBox(),
    map,
    name + ' map moved',
  );
  await assertViewport(page, name);
}
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
    await page.locator('.network-overview h2').waitFor({ state: 'attached' });
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
    await assertViewport(page, name + ' home');
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
    if (name === 'mobile')
      await page.getByRole('button', { name: '展开内容', exact: true }).click();
    await assertPanelScroll(page, name + ' reader');
    if (name === 'mobile') {
      await page.getByRole('button', { name: '收起内容', exact: true }).click();
      assert.equal(await page.locator('.reader-scroll').isVisible(), false);
    }
    await page
      .getByRole('button', { name: '林间，1 件待决定，0 条未读', exact: true })
      .click();
    await page.getByRole('button', { name: '同意联系', exact: true }).waitFor();
    await assertViewport(page, name + ' decision');
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
      await page.locator('.agent-profile').evaluate((element) => {
        element.scrollTop = 0;
      });
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
    const profileScroll = await page
      .locator(name === 'mobile' ? '.agent-profile' : '.profile-editor')
      .evaluate((element) => element.scrollTop);
    assert.ok(
      profileScroll > 0,
      name + ' deep settings must scroll inside the profile panel',
    );
    await assertViewport(page, name + ' deep settings');
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
  // Short windows and orientation changes must keep deep content reachable.
  for (const [name, width, height] of [
    ['short-desktop', 1280, 600],
    ['tablet', 768, 1024],
    ['small-mobile', 375, 667],
    ['landscape', 844, 390],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4327/preview');
    await page.locator('.graph-node').first().waitFor();
    await assertViewport(page, name + ' home');
    if (capture)
      await page.screenshot({
        path: `.impeccable/review/${name}-viewport.png`,
      });
    if (name === 'landscape') {
      const map = await page.locator('.network-map').boundingBox();
      const before = await page.locator('.own-node').boundingBox();
      await page.mouse.move(map.x + 12, map.y + 70);
      await page.mouse.down();
      await page.mouse.move(map.x + 72, map.y + 110, {
        steps: 5,
      });
      await page.mouse.up();
      const after = await page.locator('.own-node').boundingBox();
      assert.equal(
        Math.round(after.x - before.x),
        60,
        'short graph pans horizontally',
      );
      assert.equal(
        Math.round(after.y - before.y),
        40,
        'short graph pans vertically',
      );
      await assertViewport(page, name + ' graph pan');
    }
    if (width <= 720)
      await page.getByRole('button', { name: '展开内容', exact: true }).click();
    await page.locator('.reader-boundary').scrollIntoViewIfNeeded();
    await assertViewport(page, name + ' reader end');
    if (width <= 720) {
      await page.getByRole('button', { name: '收起内容', exact: true }).focus();
      await page.keyboard.press('Escape');
      assert.equal(
        await page
          .getByRole('button', { name: '展开内容', exact: true })
          .getAttribute('aria-expanded'),
        'false',
      );
    }
    await page.getByRole('link', { name: '我的 Agent', exact: true }).click();
    await page.getByRole('button', { name: '关于我', exact: true }).click();
    await page
      .getByRole('button', { name: '复制 Agent ID', exact: true })
      .scrollIntoViewIfNeeded();
    await assertViewport(page, name + ' expanded identity');
    await page.getByLabel('报告间隔', { exact: true }).scrollIntoViewIfNeeded();
    await assertViewport(page, name + ' profile end');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Network UI passed: six viewport sizes, fixed shell and independent panel scrolling, scoped navigation, decision, portrait/policy edits, preview isolation, no browser exceptions.',
  );
} finally {
  await browser.close();
  await server.close();
}
