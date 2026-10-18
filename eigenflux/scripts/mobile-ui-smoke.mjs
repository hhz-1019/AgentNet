import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch(
  process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {},
);
let page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  reducedMotion: 'reduce',
});
const origin = server.resolvedUrls.local[0];
const screenshots = process.env.AGENTNET_UI_SCREENSHOT_DIR;
async function capture(name) {
  if (!screenshots) return;
  await fs.mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, name + '.png') });
}
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const font = (locator) => locator.evaluate((e) => getComputedStyle(e).fontSize);
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}
async function checkPill(locator) {
  assert.equal(
    await locator.evaluate((e) => getComputedStyle(e, '::after').display),
    'none',
  );
  assert.deepEqual(
    await locator.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.boxShadow, s.borderBottomWidth, s.backgroundImage];
    }),
    ['none', '0px', 'none'],
  );
  assert.notEqual(
    await locator.evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
}
try {
  await page.goto(origin + 'preview#explore');
  await page.locator('.sw-post').first().waitFor();
  await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
  for (const width of [320, 390, 430, 760, 844, 1024]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    assert.equal(await page.locator('.sw-sidebar').isVisible(), false);
    assert.equal(await page.locator('.sw-mobile-nav').isVisible(), true);
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector('.sw-feed-grid'),
        ).gridTemplateColumns.split(' ').length === 2,
    );
    await page.waitForFunction(() => {
      const grid = document.querySelector('.sw-feed-grid');
      const gap = parseFloat(
        getComputedStyle(grid).getPropertyValue('--ew-feed-gap'),
      );
      return [...grid.children].every(
        (child) =>
          child.style.gridRowEnd ===
          `span ${Math.ceil(child.offsetHeight + gap)}`,
      );
    });
    await noOverflow();
    assert.equal(
      await page
        .locator('.sw-feed-grid .sw-post-author')
        .first()
        .evaluate((e) => getComputedStyle(e).flexWrap),
      'nowrap',
      'author avatar and name remain on the same row on narrow phones',
    );
    const cards = await page
      .locator('.sw-feed-grid > div')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      );
    assert.ok(Math.abs(cards[0].width - cards[1].width) < 1);
    assert.ok(cards[1].x > cards[0].x + cards[0].width);
    // Different natural heights must pack without either overlap or row alignment.
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i],
          b = cards[j];
        assert.ok(
          a.x + a.width <= b.x + 1 ||
            b.x + b.width <= a.x + 1 ||
            a.y + a.height <= b.y + 1 ||
            b.y + b.height <= a.y + 1,
          'cards overlap',
        );
      }
    const nav = page.locator('.sw-mobile-nav');
    assert.deepEqual(
      await nav
        .locator(':scope > *')
        .evaluateAll((nodes) =>
          nodes.map(
            (n) => n.getAttribute('aria-label') || n.textContent.trim(),
          ),
        ),
      ['此刻', '发现', '发布', '消息', '我的'],
    );
    const publish = await nav
      .getByRole('button', { name: '发布', exact: true })
      .boundingBox();
    assert.ok(
      Math.abs(publish.x + publish.width / 2 - width / 2) < 1,
      'publish is not centered',
    );
    assert.equal(publish.width, 64);
    const selected = nav.getByRole('link', { name: '发现', exact: true });
    assert.equal(
      await selected
        .locator('.ew-nav-icon')
        .evaluate((e) => getComputedStyle(e).opacity),
      '1',
    );
    const labelMatrix = await selected
      .locator('.ew-nav-label')
      .evaluate((e) => {
        const m = new DOMMatrix(getComputedStyle(e).transform);
        return [m.m41, m.m42];
      });
    assert.deepEqual(labelMatrix, [0, -22]);
    assert.equal(
      await font(page.locator('.sw-feed-grid .sw-post-title').first()),
      '15px',
    );
    await checkPill(
      page
        .getByRole('navigation', { name: '发现频道' })
        .getByRole('button', { name: '推荐', exact: true }),
    );
    if (width === 390) await capture('phone-feed');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.sw-post').first().getByRole('button').first().click();
  await page.getByRole('dialog').waitFor();
  await noOverflow();
  assert.equal(await font(page.locator('.ew-reading-intro h2')), '20px');
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(
    await page
      .locator('.ew-detail-layout')
      .evaluate((e) => getComputedStyle(e).display),
    'block',
    'touch landscape retains stacked post detail',
  );
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  const nav = page.locator('.sw-mobile-nav');
  await nav.getByRole('link', { name: '消息', exact: true }).click();
  for (const label of ['私信', '群聊', '全部']) {
    const filter = page
      .getByRole('group', { name: '消息类型' })
      .getByRole('button', { name: label, exact: true });
    await filter.click();
    await checkPill(filter);
  }
  await page.getByRole('button', { name: /周末去哪儿/ }).click();
  for (const width of [844, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    assert.equal(await page.locator('.sn-conversations').isVisible(), false);
    assert.equal(await page.locator('.sn-chat').isVisible(), true);
    assert.equal(await page.locator('.sn-conversation-back').isVisible(), true);
    await noOverflow();
  }
  assert.equal(await font(page.locator('.sn-message p').first()), '15px');
  assert.equal(
    await font(page.locator('.sn-message-composer textarea')),
    '16px',
  );
  await noOverflow();
  await nav.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await font(page.locator('.ew-share-title-input')), '20px');
  await noOverflow();
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  assert.equal(
    await nav
      .getByRole('link', { name: '我的', exact: true })
      .locator('.ew-nav-icon')
      .evaluate((e) => getComputedStyle(e).opacity),
    '1',
  );
  await noOverflow();
  await page.goto(origin + 'preview/onboarding-profile');
  await page.locator('textarea').first().waitFor();
  assert.equal(await font(page.locator('textarea').first()), '16px');
  await noOverflow();
  // Desktop cards use the product title scale, independent of page headings.
  await page.close();
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + 'preview#explore');
  await page.locator('.sw-post').first().waitFor();
  assert.equal(
    await font(page.locator('.sw-feed-grid .sw-post-title').first()),
    '18px',
  );
  await page
    .getByRole('navigation', { name: '发现频道' })
    .getByRole('button', { name: '关注', exact: true })
    .click();
  await checkPill(
    page
      .getByRole('navigation', { name: '发现频道' })
      .getByRole('button', { name: '关注', exact: true }),
  );
  assert.equal(await page.locator('.ew-tab-indicator').count(), 0);
  await page
    .getByRole('navigation', { name: '发现频道' })
    .getByRole('button', { name: '推荐', exact: true })
    .click();
  await page.locator('.sw-post').first().waitFor();
  await capture('desktop-filters');
  for (const width of [
    1440, 1180, 1100, 1000, 901, 900, 801, 800, 761, 760, 700, 680, 640, 620,
    430, 390, 320,
  ]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.locator('.sw-sidebar').isVisible(),
      true,
      `desktop sidebar at ${width}`,
    );
    assert.equal(
      await page.locator('.sw-mobile-nav').isVisible(),
      false,
      `desktop bottom navigation at ${width}`,
    );
    assert.equal(await page.locator('.ew-theme-floating').isVisible(), false);
    assert.equal(await page.locator('.sw-sidebar .sw-brand').isVisible(), true);
    assert.equal(
      await page
        .locator('.sw-sidebar')
        .evaluate((e) => getComputedStyle(e).overflowX),
      'hidden',
      `no horizontal sidebar scrollbar at ${width}`,
    );
    await noOverflow();
    if (width === 390 || width === 800) await capture(`desktop-${width}`);
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: touch layouts through landscape/tablet widths, desktop shell across 17 widths, phone typography, masonry, navigation and dialogs.',
  );
} finally {
  await browser.close();
  await server.close();
}
