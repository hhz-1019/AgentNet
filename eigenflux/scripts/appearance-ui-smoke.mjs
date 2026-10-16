// Exercise appearance through the UI, including persistence and portaled dialogs.
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
page.on('pageerror', (error) => errors.push(error.message));
async function themeIs(target, value) {
  await target.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    value,
  );
}
try {
  await page.goto(origin + 'preview#explore');
  await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.ew-theme-switch').count(), 0);
  const backgrounds = new Set();
  for (const [id, name] of [
    ['warm', '暖色'],
    ['cool', '冷色'],
    ['night', '夜间'],
  ]) {
    await page
      .getByRole('link', { name: '我的', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await page
      .getByRole('button', { name, exact: true })
      .filter({ visible: true })
      .click();
    await themeIs(page, id);
    backgrounds.add(
      await page
        .locator('body')
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--ew-input-tint'),
        ),
    );
    assert.equal(
      await page.locator('.ew-tree-shadow, .ew-window-projection').count(),
      0,
    );
    for (const link of await page.locator('.sw-sidebar nav a').all()) {
      await link.hover();
      assert.deepEqual(
        await link.evaluate((el) => {
          const style = getComputedStyle(el);
          return [
            style.backgroundColor,
            style.backgroundImage,
            style.borderWidth,
          ];
        }),
        ['rgba(0, 0, 0, 0)', 'none', '0px'],
      );
    }
    await page
      .locator('.sw-sidebar')
      .getByRole('button', { name: '发布', exact: true })
      .click();
    const surfaces = await page.locator('dialog[open]').evaluate((dialog) => {
      const color = (el) => getComputedStyle(el).backgroundColor;
      const paper = dialog.querySelector('.ew-share-preview-paper');
      return {
        dialog: color(dialog),
        heading: color(dialog.querySelector('.sw-dialog-heading')),
        fields: color(dialog.querySelector('.sn-share-fields')),
        paper: color(paper),
        shadow: getComputedStyle(paper).boxShadow,
      };
    });
    assert.equal(surfaces.heading, surfaces.dialog);
    assert.equal(surfaces.paper, surfaces.dialog);
    assert.equal(surfaces.fields, 'rgba(0, 0, 0, 0)');
    assert.equal(surfaces.shadow, 'none');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
  await page.getByRole('link', { name: '消息', exact: true }).click();
  const empty = await page.locator('.sn-chat > .sw-empty').boundingBox();
  const chat = await page.locator('.sn-chat').boundingBox();
  assert.ok(
    empty && chat && Math.abs(empty.width - chat.width) < 2,
    'Empty state fills the conversation column',
  );
  await page.getByRole('link', { name: '发现', exact: true }).click();
  assert.equal(backgrounds.size, 3);
  await page.reload();
  await themeIs(page, 'night');
  const other = await context.newPage();
  await other.goto(origin + 'preview/onboarding-profile');
  await other.locator('.ew-brand-entry').waitFor({ state: 'detached' });
  await themeIs(other, 'night');
  assert.equal(await other.locator('.ew-theme-switch').count(), 0);
  await page
    .getByRole('link', { name: '我的', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '冷色', exact: true }).click();
  await themeIs(other, 'cool');
  await page
    .getByRole('link', { name: '发现', exact: true })
    .filter({ visible: true })
    .click();
  await other.locator('textarea').first().waitFor();
  const inputs = await other
    .locator(
      '.sn-portrait-grid input:not([type=checkbox]), .sn-portrait-grid textarea',
    )
    .all();
  assert.equal(
    inputs.length,
    5,
    'Host-memory onboarding has five public profile fields',
  );
  assert.equal(
    new Set(
      await Promise.all(
        inputs.map((input) =>
          input.evaluate((el) => getComputedStyle(el).backgroundColor),
        ),
      ),
    ).size,
    1,
  );
  for (const input of inputs)
    assert.ok(
      await input.evaluate(
        (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 18,
      ),
    );
  await page.locator('.sw-post').first().getByRole('button').first().click();
  assert.equal(
    await page
      .locator('dialog[open]')
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    '30px',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('link', { name: '我的', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page
    .getByRole('button', { name: '暖色', exact: true })
    .filter({ visible: true })
    .click();
  await themeIs(page, 'warm');
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Appearance UI passed: three palettes, transparent navigation, persistence, cross-tab sync, registration, dialogs and mobile.',
  );
} finally {
  await browser.close();
  await server.close();
}
