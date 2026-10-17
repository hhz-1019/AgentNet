import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const results = [];
await mkdir('.agentnet-audit/performance', { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + 'preview/performance?posts=500#explore');
  // Recommendations use explicit batch refresh; latest keeps the infinite feed.
  await page.getByRole('button', { name: '最新', exact: true }).click();
  await page.locator('.sw-feed-grid [data-post-id]').first().waitFor();
  await page.screenshot({
    path: '.agentnet-audit/performance/feed-desktop.png',
  });
  const start = Date.now();
  while ((await page.locator('.sw-feed-grid [data-post-id]').count()) < 500) {
    const count = await page.locator('.sw-feed-grid [data-post-id]').count();
    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.waitForFunction(
      (previous) =>
        document.querySelectorAll('.sw-feed-grid [data-post-id]').length >
        previous,
      count,
      { timeout: 15000 },
    );
  }
  const cardCount = await page.locator('.sw-feed-grid [data-post-id]').count();
  const contained = await page
    .locator('.sw-feed-grid > .ew-feed-contained')
    .count();
  assert.equal(cardCount, 500);
  assert.equal(contained, 500);
  const before = await page.evaluate(() => ({
    y: scrollY,
    h: document.documentElement.scrollHeight,
  }));
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    y: scrollY,
    h: document.documentElement.scrollHeight,
  }));
  assert.ok(Math.abs(before.y - after.y) < 2, 'settled scroll position jumped');
  results.push({
    case: '500-card-scroll',
    cards: cardCount,
    contained,
    elapsedMs: Date.now() - start,
    settledScrollDelta: after.y - before.y,
  });
  await page.screenshot({
    path: '.agentnet-audit/performance/feed-bottom.png',
  });
  await page.getByRole('button', { name: '模拟断网', exact: true }).click();
  const visible = await page.locator('.sw-feed-grid [data-post-id]').count();
  await page.waitForTimeout(1000);
  assert.equal(
    await page.locator('.sw-feed-grid [data-post-id]').count(),
    visible,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(500);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'mobile horizontal overflow',
  );
  await page.screenshot({
    path: '.agentnet-audit/performance/feed-mobile.png',
  });
  assert.deepEqual(errors, []);
  await page.close();
  // Delay the actual first-page data. The animation must overlap this request.
  for (const delay of [3000, 5000]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'no-preference',
    });
    const p = await context.newPage();
    let listStarted = 0;
    await p.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = { items: [], next_cursor: '' };
      if (path.endsWith('/session'))
        data = {
          agent_id: '101',
          agent_name: '测试',
          owner_uid: 'test',
          owner_bound: true,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        };
      if (path.endsWith('/portrait'))
        data = {
          fields: { name: '测试' },
          visible: ['name'],
          memories: [],
          revision: 1,
        };
      if (path.endsWith('/accounts')) data = { accounts: [] };
      if (path.endsWith('/access')) data = { allowed: false };
      if (path.endsWith('/avatars')) data = { avatars: {}, previews: {} };
      if (path.endsWith('/activity/stream'))
        return route.fulfill({
          contentType: 'text/event-stream',
          body: ': test\n\n',
        });
      if (path.endsWith('/social/posts')) {
        listStarted = Date.now();
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      await route.fulfill({ json: { data } });
    });
    await p.goto(origin + 'dashboard', { waitUntil: 'domcontentloaded' });
    await p.locator('.ew-brand-entry').waitFor();
    await p
      .locator('.ew-brand-entry')
      .waitFor({ state: 'detached', timeout: 12000 });
    const extra = Date.now() - listStarted - delay;
    assert.ok(
      extra < 2000,
      'morph did not overlap loading; completion + reveal took too long: ' + extra,
    );
    assert.equal(
      await p.locator('.ew-entry-content').evaluate((el) => el.inert),
      false,
    );
    results.push({
      case: 'entry-overlap',
      dataDelayMs: delay,
      additionalWaitMs: extra,
    });
    if (delay === 3000) {
      const cacheResult = await p.evaluate(async () => {
        const { api } = await import('/api.ts');
        const { ReadCache } = await import('/read-cache.ts');
        const original = ReadCache.prototype.clear;
        let cleared = 0;
        ReadCache.prototype.clear = function () {
          cleared++;
          return original.call(this);
        };
        try {
          await api('console/analytics/heartbeat', {});
          await api('console/registration/progress', {});
          const telemetryClears = cleared;
          await api('console/social/posts/test/reactions', { kind: 'like' });
          return { telemetryClears, mutationClears: cleared - telemetryClears };
        } finally {
          ReadCache.prototype.clear = original;
        }
      });
      assert.equal(cacheResult.telemetryClears, 0, 'telemetry evicted reads');
      assert.ok(
        cacheResult.mutationClears >= 1,
        'real mutation retained stale reads',
      );
      results.push({ case: 'telemetry-cache', ...cacheResult });
    }
    await context.close();
  }
  await writeFile(
    '.agentnet-audit/performance/results.json',
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}
