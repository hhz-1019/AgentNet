import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH,
});
const origin = server.resolvedUrls.local[0],
  errors = [];
const rect = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
function equal(a, b, label) {
  for (const key of Object.keys(a))
    assert.ok(
      Math.abs(a[key] - b[key]) < 1,
      `${label}: ${key} ${a[key]} -> ${b[key]}`,
    );
}
try {
  for (const [width, height, touch] of [
    [1440, 900, false],
    [1024, 600, false],
    [390, 844, true],
    [844, 390, true],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + 'preview#messages');
    await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
    // An explicit classic scrollbar width exercises occupied tracks on macOS too.
    await page.addStyleTag({
      content: '::-webkit-scrollbar{width:16px;height:16px}',
    });
    const shell = await rect(page.locator('.sw-main'));
    const sectionTabs = await rect(page.locator('.sw-message-sections'));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      `chat must not create a second document scrollbar ${width}/${height}/${touch}`,
    );
    const inbox = await rect(page.locator('.sn-inbox'));
    assert.ok(
      inbox.height > 120 && inbox.y + inbox.height <= height,
      'chat stays inside viewport',
    );
    const filters = page.locator('.sn-message-filters');
    const filterBounds = await rect(filters);
    for (const name of ['私信', '群聊', '全部']) {
      await filters.getByRole('button', { name, exact: true }).click();
      equal(await rect(filters), filterBounds, 'message filters');
      equal(await rect(page.locator('.sn-inbox')), inbox, 'chat height');
    }
    // Short/long content must reserve the same inner scroll track.
    const conversations = page.locator('.sn-conversations');
    const innerWidth = await conversations.evaluate((e) => e.clientWidth);
    await conversations.evaluate((e) => {
      const filler = document.createElement('div');
      filler.dataset.scrollFixture = '';
      filler.style.height = '2000px';
      e.append(filler);
    });
    assert.equal(
      await conversations.evaluate((e) => e.clientWidth),
      innerWidth,
    );
    await page.locator('[data-scroll-fixture]').evaluate((e) => e.remove());
    for (const route of [
      'network',
      'explore',
      'me',
      'liked',
      'saved',
      'settings',
      'activity',
      'crossing',
      'messages',
    ]) {
      await page.evaluate((route) => {
        location.hash = route;
        window.scrollTo(0, 0);
      }, route);
      await page.locator(`.sw-workspace[data-page="${route}"]`).waitFor();
      if (route === 'crossing') await page.locator('.mb-live').waitFor();
      const r = await rect(page.locator('.sw-main'));
      equal(
        { x: r.x, width: r.width },
        { x: shell.x, width: shell.width },
        `${width}/${height}/${route} shell`,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        'no horizontal page overflow',
      );
      if (route === 'network' || route === 'messages')
        equal(
          await rect(page.locator('.sw-message-sections')),
          sectionTabs,
          'messages/address-book tabs',
        );
    }
    // Modal locking must leave the underlying shell and its scroll position still.
    await page.evaluate(() => {
      location.hash = 'explore';
    });
    await page.locator('.sw-feed-grid .sw-post').first().waitFor();
    await page.evaluate(() => scrollTo(0, 180));
    const before = await rect(page.locator('.sw-main'));
    const scroll = await page.evaluate(() => scrollY);
    await page
      .getByRole('button', { name: '发布', exact: true })
      .filter({ visible: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    equal(await rect(page.locator('.sw-main')), before, 'modal background');
    const initial = await rect(dialog);
    const formWidth = await dialog
      .locator('form')
      .first()
      .evaluate((e) => e.getBoundingClientRect().width);
    await dialog.evaluate((e) => {
      const filler = document.createElement('div');
      filler.dataset.scrollFixture = '';
      filler.style.height = '1800px';
      e.append(filler);
    });
    assert.equal(
      await dialog
        .locator('form')
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
      formWidth,
      'dialog fields do not narrow when scrolling',
    );
    const long = await rect(dialog);
    equal(
      { x: long.x, width: long.width },
      { x: initial.x, width: initial.width },
      'dialog width',
    );
    await dialog.locator('[data-scroll-fixture]').evaluate((e) => e.remove());
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    equal(await rect(page.locator('.sw-main')), before, 'modal close');
    assert.equal(await page.evaluate(() => scrollY), scroll);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: document/inner scroll gutters, chat viewport sizing, parallel page/filter geometry, dialog locking/overflow, desktop and mobile portrait/landscape.',
  );
} finally {
  await browser.close();
  await server.close();
}
