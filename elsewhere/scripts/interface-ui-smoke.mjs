import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  configFile: 'elsewhere/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const origin = server.resolvedUrls.local[0];
async function go(route) {
  await page.goto(origin + 'preview#' + route);
  await page.locator('.sw-sidebar').waitFor();
  await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
}
try {
  await go('explore');
  const nav = page.locator('.sw-sidebar nav');
  assert.equal(
    await page
      .locator('body')
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(255, 255, 255)',
  );
  for (const link of await nav.locator('a').all()) {
    const active = await link.getAttribute('aria-current');
    assert.equal(
      await link
        .locator('.ew-nav-label')
        .evaluate((e) => getComputedStyle(e).opacity),
      active ? '0' : '1',
    );
    assert.equal(
      await link
        .locator('.ew-nav-icon')
        .evaluate((e) => getComputedStyle(e).opacity),
      active ? '1' : '0',
    );
  }
  assert.equal(await nav.locator('.ew-unread-dot').count(), 1);
  await nav.getByRole('link', { name: '消息', exact: true }).click();
  await page.locator('.sn-conversations').waitFor();
  assert.equal(
    await page.locator('.sn-conversations .ew-unread-dot').count(),
    2,
  );
  await page.getByRole('button', { name: /周末去哪儿/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.sn-conversations .ew-unread-dot').length ===
      1,
  );
  await page.getByRole('button', { name: /新产品讨论组/ }).click();
  await page.waitForFunction(
    () => !document.querySelector('.sw-sidebar nav .ew-unread-dot'),
  );
  assert.equal(
    await page
      .locator('.sn-message-composer')
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(250, 246, 238)',
  );
  await page.reload();
  await page.locator('.sw-sidebar').waitFor();
  assert.equal(await nav.locator('.ew-unread-dot').count(), 0);
  await go('settings');
  for (const theme of ['暖色', '冷色', '夜间']) {
    await page
      .getByRole('button', { name: theme, exact: true })
      .filter({ visible: true })
      .click();
    for (const button of await page.locator('button').all()) {
      if (!(await button.isVisible())) continue;
      assert.equal(
        await button.evaluate((e) => getComputedStyle(e).backgroundImage),
        'none',
      );
    }
  }
  await page
    .getByRole('button', { name: '暖色', exact: true })
    .filter({ visible: true })
    .click();
  await go('settings');
  assert.equal(
    await page
      .getByRole('link', { name: '活动记录', exact: true })
      .evaluate((e) => getComputedStyle(e).borderWidth),
    '0px',
  );
  await page.getByRole('button', { name: '发布', exact: true }).first().click();
  assert.equal(
    await page
      .getByRole('dialog')
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(255, 255, 255)',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.sw-sidebar')
    .getByRole('link', { name: '消息', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '消息与通讯录' })
    .getByRole('link', { name: '通讯录', exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: white surfaces, no button gradients, navigation faces, unread/read persistence, borderless activity, neutral publishing and mobile.',
  );
} finally {
  await browser.close();
  await server.close();
}
