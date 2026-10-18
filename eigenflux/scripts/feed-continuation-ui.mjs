import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
const origin = server.resolvedUrls.local[0];
const post = (id) => ({
  id,
  agent_id: '2',
  author_name: '林间',
  state: 'published',
  visibility: 'public',
  revision: 1,
  created_at: 1700000000000,
  published_at: 1700000000000,
  likes: 0,
  saves: 0,
  comments: 0,
  liked: false,
  saved: false,
  document: {
    title: `路上的记录 ${id}`,
    summary: '今天沿河走了一段，发现一家小书店。',
    body: '门口的猫正趴在椅子上晒太阳。',
    kind: 'social',
    tags: [],
    media: [],
    identity: 'agent',
    project_name: '',
  },
});
const errors = [];
try {
  for (const [width, touch] of [
    [1440, false],
    [320, true],
    [390, true],
    [844, true],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: touch,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const calls = [];
    let failNext = false;
    let delayNext = false;
    await page.route('**/api/v2/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      let data = { items: [], next_cursor: '' };
      if (p.endsWith('/console/session'))
        data = {
          agent_id: '1',
          agent_name: '我的 Agent',
          owner_uid: '10001',
          owner_bound: true,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        };
      if (p.endsWith('/console/portrait'))
        data = {
          fields: { name: '我的 Agent' },
          visible: ['name'],
          revision: 1,
          memories: [],
        };
      if (p.endsWith('/accounts')) data = { accounts: [] };
      if (p.endsWith('/avatars')) data = { avatars: {} };
      if (p.endsWith('/social/preferences')) data = { tags: [], revision: 1 };
      if (p.endsWith('/activity/stream'))
        return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (p.endsWith('/social/posts')) {
        const scope = url.searchParams.get('scope');
        const cursor = url.searchParams.get('cursor') || '';
        calls.push({ scope, cursor });
        if (cursor && failNext) {
          failNext = false;
          return route.fulfill({
            status: 503,
            json: { error: { message: 'temporary' } },
          });
        }
        if (cursor && delayNext) await new Promise((r) => setTimeout(r, 600));
        const batch = Number(cursor || 0);
        data = {
          items: Array.from({ length: 20 }, (_, i) =>
            post(`${scope}-${batch * 20 + i}`),
          ),
          next_cursor: batch < 2 ? String(batch + 1) : '',
        };
      }
      await route.fulfill({ json: { data } });
    });
    await page.goto(origin + 'dashboard/explore');
    await page.locator('.sw-post').first().waitFor();
    await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
    for (const [channel, scope] of [
      ['推荐', 'recommended'],
      ['关注', 'following'],
      ['最新', 'all'],
    ]) {
      await page
        .getByRole('navigation', { name: '发现频道' })
        .getByRole('button', { name: channel, exact: true })
        .click();
      await page.waitForFunction(
        (scope) =>
          document.querySelector('.sw-post')?.dataset.postId === scope + '-0',
        scope,
      );
      await page.waitForFunction(
        () =>
          !document
            .querySelector('.sw-feed-grid')
            .matches('[aria-busy="true"]'),
      );
      assert.equal(
        await page.evaluate(() => scrollY),
        0,
        'switching channels starts at the top',
      );
      assert.equal(await page.locator('.sw-post').count(), 20);
      failNext = channel === '推荐';
      delayNext = true;
      // Enter the prefetch margin without reaching the actual bottom.
      await page.evaluate(() => {
        const end =
          document.querySelector('.sw-feed-end').getBoundingClientRect().top +
          scrollY;
        scrollTo(0, end - innerHeight * 1.6);
      });
      const before = await page.evaluate(() => scrollY);
      if (failNext || channel === '推荐') {
        await page.locator('.sw-feed-end').getByRole('button').waitFor();
        assert.equal(
          await page.locator('.sw-post').count(),
          20,
          'failed append retains existing cards',
        );
        await page.locator('.sw-feed-end').getByRole('button').click();
      }
      await page.waitForFunction(
        () => document.querySelectorAll('.sw-post').length === 40,
      );
      // Retry click can scroll its target into view; verify continuity on normal append.
      if (channel !== '推荐')
        assert.equal(
          await page.evaluate(() => scrollY),
          before,
          'append must not move the reader',
        );
      assert.equal(
        await page.locator(`.sw-post[data-post-id="${scope}-0"]`).count(),
        1,
      );
      if (touch) {
        const toolbar = await page.locator('.ew-feed-toolbar').boundingBox();
        assert.ok(
          Math.abs(toolbar.y) < 1,
          `toolbar remains pinned: ${toolbar.y}`,
        );
        const search = await page
          .getByRole('button', { name: '搜索动态或用户', exact: true })
          .boundingBox();
        assert.ok(
          search.x + search.width >= width - 16 && search.width >= 44,
          'search stays in the upper-right with a usable target',
        );
        assert.ok(
          search.y >= 0 && search.y + search.height <= toolbar.height + 1,
        );
        assert.equal(await page.locator('.sw-mobile-nav').isVisible(), true);
      }
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForFunction(
        () => document.querySelectorAll('.sw-post').length === 60,
      );
      await page.getByText('已经看完全部动态', { exact: true }).waitFor();
      assert.equal(
        await page
          .locator('.sw-post')
          .evaluateAll(
            (nodes) => new Set(nodes.map((n) => n.dataset.postId)).size,
          ),
        60,
      );
      const count = calls.length;
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForTimeout(250);
      assert.equal(
        calls.length,
        count,
        'exhausted feed does not request endlessly',
      );
      assert.ok(
        calls.some((c) => c.scope === scope && c.cursor === '2'),
        'all channels consume the third page',
      );
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    if (touch) {
      await page
        .getByRole('button', { name: '搜索动态或用户', exact: true })
        .click();
      await page.locator('#post-search').fill('书店');
      await page.locator('.sw-post').first().waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        'search toolbar fits',
      );
    }
    if (process.env.AGENTNET_UI_SCREENSHOT_DIR) {
      await page.goto(origin + 'preview#explore');
      await page.locator('.sw-post').first().waitFor();
      await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
      await page.evaluate(() => scrollTo(0, 300));
      await fs.mkdir(process.env.AGENTNET_UI_SCREENSHOT_DIR, {
        recursive: true,
      });
      await page.screenshot({
        path: `${process.env.AGENTNET_UI_SCREENSHOT_DIR}/feed-${width}.png`,
      });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 3 pages in recommended/following/latest, prefetch, failure/retry, stable append, channel isolation, exhaustion, sticky mobile header/search and bottom navigation.',
  );
} finally {
  await browser.close();
  await server.close();
}
