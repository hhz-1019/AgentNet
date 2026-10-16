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
const origin = server.resolvedUrls.local[0];
const errors = [];
const post = (id) => ({
  id: String(id),
  agent_id: '2',
  author_name: '知遥',
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
    title: `推荐片段 ${id}`,
    summary: '沿途留下的生活记录。',
    body: '在这里一起记录生活。',
    kind: 'social',
    tags: [],
    media: [],
    identity: 'agent',
    project_name: '',
  },
});
try {
  for (const [width, touch, guest, theme] of [
    [1440, false, false, 'warm'],
    [390, true, false, 'night'],
    [390, true, true, 'cool'],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: touch,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (theme) => localStorage.setItem('elsewhere-appearance', theme),
      theme,
    );
    const calls = [];
    const requestLog = [];
    let fail = false;
    await page.route('**/api/v2/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      let data = { items: [], next_cursor: '' };
      if (p.endsWith('/console/session')) {
        if (guest)
          return route.fulfill({
            status: 401,
            json: { error: { code: 'CONSOLE_SESSION_REQUIRED' } },
          });
        data = {
          agent_id: '1',
          agent_name: '我的 Agent',
          owner_uid: '10001',
          owner_bound: true,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        };
      }
      if (p.endsWith('/console/portrait'))
        data = {
          fields: { name: '我的 Agent' },
          visible: ['name'],
          revision: 1,
          memories: [],
        };
      if (p.endsWith('/accounts')) data = { accounts: [] };
      if (p.endsWith('/avatars')) data = { avatars: { 2: 'tide' } };
      if (p.endsWith('/social/preferences')) data = { tags: [], revision: 1 };
      if (p.endsWith('/activity/stream'))
        return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (p.endsWith('/social/posts') || p.endsWith('/guest/feed')) {
        calls.push(url.searchParams.get('cursor') || '');
        requestLog.push(url.pathname + url.search);
        if (fail)
          return route.fulfill({
            status: 503,
            json: { error: { message: 'temporary' } },
          });
        const next = url.searchParams.get('cursor') === 'batch-2';
        data = {
          items: Array.from({ length: 6 }, (_, i) =>
            post((next ? 100 : 1) + i),
          ),
          next_cursor: next ? '' : 'batch-2',
        };
      }
      if (p.endsWith('/guest/people')) {
        const q = url.searchParams.get('q');
        // An older response arrives after the new query; it must not replace it.
        if (q === '旧名') await new Promise((r) => setTimeout(r, 800));
        data = {
          items:
            q === '没有'
              ? []
              : [{ id: '2', name: q === '旧名' ? '旧名' : '知遥' }],
          next_cursor: '',
        };
      }
      if (p.endsWith('/console/people/2') || p.endsWith('/guest/people/2'))
        data = {
          fields: { name: '知遥', bio: '刚加入，还没有发布动态。' },
          visible: ['name', 'bio'],
          revision: 1,
          following: false,
          followed_by: false,
        };
      await route.fulfill({ json: { data } });
    });
    await page.goto(origin + (guest ? '' : 'dashboard/explore'));
    const skip = page.getByRole('button', { name: '跳过动画' });
    if (await skip.isVisible()) await skip.click();
    await page
      .getByRole('navigation', { name: '发现频道' })
      .getByRole('button', { name: '推荐', exact: true })
      .click();
    await page.locator('.sw-feed-grid .sw-post').first().waitFor();
    await page
      .getByRole('navigation', { name: '搜索类型' })
      .getByRole('button', { name: '用户', exact: true })
      .click();
    await page.locator('#post-search').fill('旧名');
    await page.waitForRequest(
      (r) =>
        r.url().includes('/guest/people?q=') &&
        r.url().includes(encodeURIComponent('旧名')),
    );
    await page.locator('#post-search').fill('知遥');
    await page
      .locator('.ew-person-result')
      .filter({ hasText: '知遥' })
      .waitFor();
    await page.waitForTimeout(850);
    assert.equal(await page.locator('.ew-person-result').innerText(), '知遥');
    await page.locator('.ew-person-result').click();
    await page
      .locator('.elsewhere-identity')
      .filter({ hasText: '知遥' })
      .waitFor();
    await page.getByRole('button', { name: '退出主页' }).click();
    await page
      .getByRole('navigation', { name: '搜索类型' })
      .getByRole('button', { name: '用户', exact: true })
      .click();
    await page.locator('#post-search').fill('没有');
    await page.getByText('没有找到这个名字', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清空搜索' }).click();
    await page
      .getByRole('navigation', { name: '搜索类型' })
      .getByRole('button', { name: '动态', exact: true })
      .click();
    await page.getByRole('button', { name: '刷新推荐', exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.ew-recommendation-refresh').disabled,
    );
    const before = calls.length;
    if (touch) {
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForTimeout(100);
      const region = page.locator('.ew-recommendation-region');
      const gesture = (type, init) =>
        region.evaluate(
          (el, { type, init }) => {
            el.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                touches: init.touches.map(
                  (t) => new Touch({ identifier: 1, target: el, ...t }),
                ),
              }),
            );
          },
          { type, init },
        );
      await gesture('touchstart', {
        touches: [{ clientX: 150, clientY: 650 }],
      });
      await gesture('touchmove', {
        touches: [{ clientX: 152, clientY: 610 }],
      });
      await gesture('touchend', { touches: [] });
      assert.equal(
        calls.length,
        before,
        'short gesture must not refresh ' +
          JSON.stringify({ width, guest, requestLog }),
      );
      await gesture('touchstart', {
        touches: [{ clientX: 150, clientY: 650 }],
      });
      await gesture('touchmove', {
        touches: [{ clientX: 152, clientY: 550 }],
      });
      await page.getByRole('button', { name: '松开刷新推荐' }).waitFor();
      await gesture('touchend', { touches: [] });
    } else
      await page.getByRole('button', { name: '刷新推荐', exact: true }).click();
    await page
      .getByRole('button', { name: '查看动态：推荐片段 100', exact: true })
      .waitFor();
    assert.equal(calls.at(-1), 'batch-2');
    assert.equal(
      await page
        .getByRole('button', { name: '查看动态：推荐片段 1', exact: true })
        .count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    fail = true;
    await page.getByRole('button', { name: '刷新推荐', exact: true }).click();
    await page.getByText('刷新未完成，请重试', { exact: true }).waitFor();
    assert.equal(await page.locator('.sw-post[data-post-id="100"]').count(), 1);
    fail = false;
    await page.getByRole('button', { name: '刷新推荐', exact: true }).click();
    await page
      .getByRole('button', { name: '查看动态：推荐片段 1', exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      'no horizontal overflow',
    );
    if (touch)
      assert.equal(
        await page.locator('.sw-mobile-nav').isVisible(),
        true,
        'mobile navigation must stay visible',
      );
    await page.screenshot({
      path: `.agentnet-audit/discovery-${width}-${guest ? 'guest' : 'member'}.png`,
      fullPage: true,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: member/guest name search, profile navigation, empty results, recommendation replacement, upward pull threshold, failed refresh preservation/retry, desktop/mobile themes.',
  );
} finally {
  await browser.close();
  await server.close();
}
