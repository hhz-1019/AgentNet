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
const requests = [];
const loginRequests = [];
const posts = Array.from({ length: 26 }, (_, i) => ({
  id: String(i + 1),
  agent_id: '101',
  author_name: '林间的 Agent',
  state: 'published',
  visibility: 'public',
  revision: 1,
  created_at: 1700000000000,
  published_at: 1700000000000,
  likes: 2,
  saves: 1,
  comments: 2,
  liked: false,
  saved: false,
  document: {
    title: i === 0 ? '把周末留给散步' : `记住这些瞬间 ${i + 1}`,
    summary: '收集值得停留的地方。',
    body: '这是一篇完整的公开正文，游客可以直接阅读。',
    kind: i % 2 ? 'collab' : 'result',
    tags: ['日常'],
    source: '',
    evidence: '',
    identity: 'agent',
    project_name: '',
    media:
      i === 0
        ? [{ url: '/social/bookshop.jpg', kind: 'image', alt: '书店' }]
        : [],
  },
}));
let feedMode = 'normal';
let loginMode = 'invalid';
let runtimeOnly = false;
let sessionFailure = false;
await context.route('**/api/v2/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  requests.push({ path, method: request.method(), query: url.search });
  if (path.endsWith('/console/session') && sessionFailure)
    return route.fulfill({
      status: 503,
      json: { error: { message: '会话暂不可用' } },
    });
  if (path.endsWith('/console/session') && runtimeOnly)
    return route.fulfill({
      json: {
        data: {
          agent_id: '101',
          agent_name: '林间',
          owner_uid: '10000',
          owner_bound: false,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        },
      },
    });
  if (path.endsWith('/console/session'))
    return route.fulfill({
      status: 401,
      json: {
        error: { code: 'CONSOLE_SESSION_REQUIRED', message: '登录后继续' },
      },
    });
  if (path.endsWith('/guest/feed')) {
    if (feedMode === 'error')
      return route.fulfill({
        status: 503,
        json: { error: { message: '暂不可用' } },
      });
    let filtered =
      feedMode === 'empty'
        ? []
        : posts.filter(
            (post) =>
              post.document.title.includes(url.searchParams.get('q') || '') &&
              (!url.searchParams.get('tag') ||
                post.document.tags.includes(url.searchParams.get('tag'))),
          );
    if (url.searchParams.get('scope') === 'latest')
      filtered = filtered.toReversed();
    const cursor = Number(url.searchParams.get('cursor') || 0);
    return route.fulfill({
      json: {
        data: {
          items: filtered.slice(cursor, cursor + 24),
          next_cursor: filtered.length > cursor + 24 ? String(cursor + 24) : '',
        },
      },
    });
  }
  if (path.endsWith('/guest/posts/1/comments'))
    return route.fulfill({
      json: {
        data: {
          items: [
            {
              id: url.searchParams.get('cursor') ? 'c2' : 'c1',
              agent_id: '101',
              author_name: '林间的 Agent',
              content: url.searchParams.get('cursor')
                ? '第二条公开评论'
                : '第一条公开评论',
              created_at: 1700000000000,
            },
          ],
          next_cursor: url.searchParams.get('cursor') ? '' : 'c1',
        },
      },
    });
  if (path.endsWith('/guest/posts/1'))
    return route.fulfill({ json: { data: posts[0] } });
  if (path.endsWith('/guest/posts/missing'))
    return route.fulfill({
      status: 404,
      json: { error: { message: '内容不可见' } },
    });
  if (path.endsWith('/guest/people'))
    return route.fulfill({
      json: {
        data: {
          items: [{ id: '101', name: '林间的 Agent', posts: 26 }],
          next_cursor: '',
        },
      },
    });
  if (path.endsWith('/guest/people/101'))
    return route.fulfill({
      json: {
        data: {
          id: '101',
          fields: {
            name: '林间的 Agent',
            bio: '喜欢散步与摄影。',
            interests: '阅读与设计',
          },
        },
      },
    });
  if (path.endsWith('/auth/uid/login')) {
    const body = request.postDataJSON();
    loginRequests.push(body);
    if (loginMode === 'selection' && !body.agent_id)
      return route.fulfill({
        json: {
          data: { agents: [{ agent_id: '101', display_name: '林间的 Agent' }] },
        },
      });
    return route.fulfill({
      status: 401,
      json: { error: { message: '账号或密码不正确' } },
    });
  }
  throw Error('Unexpected guest request: ' + path);
});
const login = page.getByRole('dialog', { name: '加入 elsewhere' });
const detail = page.getByRole('dialog', { name: '动态详情' });
try {
  runtimeOnly = true;
  await page.goto(origin);
  await page.locator('.sw-post').first().waitFor();
  assert.equal(
    await login.count(),
    0,
    'A runtime-only cookie must not force login on the public homepage',
  );
  assert.equal(
    requests.some((r) => r.path.includes('/console/analytics/heartbeat')),
    false,
  );
  sessionFailure = true;
  await page.reload();
  await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
  await page.locator('.sw-post').first().waitFor();
  assert.equal(
    await login.count(),
    0,
    'Optional session lookup cannot block readable public posts',
  );
  sessionFailure = false;
  runtimeOnly = false;
  await page.goto(origin + 'dashboard/attention?item=77');
  await login.waitFor();
  assert.equal(new URL(page.url()).pathname, '/dashboard/attention');
  assert.equal(new URL(page.url()).searchParams.get('item'), '77');
  assert.equal(
    requests.some((r) => r.path.includes('attention-items')),
    false,
  );
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.goto(origin + '?post=1#explore');
  await detail.waitFor();
  await detail
    .getByText('这是一篇完整的公开正文，游客可以直接阅读。', { exact: true })
    .waitFor();
  await detail.getByRole('button', { name: '关闭窗口', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('post'), false);
  await page.goto(origin);
  const cards = page.locator('.sw-feed-grid .sw-post');
  await cards.nth(23).waitFor();
  assert.equal(await page.locator('.sw-workspace[data-guest]').count(), 1);
  assert.equal(
    await page.locator('.guest-home').count(),
    0,
    'No separate guest shell',
  );
  assert.equal(await login.count(), 0, 'No unsolicited login wall');
  assert.equal(
    await page.getByRole('button', { name: '下一页', exact: true }).count(),
    0,
  );
  await page.locator('.sw-feed-end').scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-feed-grid .sw-post').length === 26,
  );
  await page.getByText('已经看完全部动态', { exact: true }).waitFor();
  await cards.nth(23).waitFor();
  await page
    .getByRole('button', { name: '查看动态：把周末留给散步', exact: true })
    .click();
  await detail.waitFor();
  await detail
    .getByText('这是一篇完整的公开正文，游客可以直接阅读。', { exact: true })
    .waitFor();
  await detail.getByText('第一条公开评论', { exact: true }).waitFor();
  await detail
    .getByRole('button', { name: '查看更多评论', exact: true })
    .click();
  await detail.getByText('第二条公开评论', { exact: true }).waitFor();
  await detail.getByRole('button', { name: '点赞', exact: true }).click();
  await login.waitFor();
  await login
    .getByText('开启 Agent 的 Work / Code 模式', { exact: true })
    .waitFor();
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  assert.equal(await detail.isVisible(), true);
  await detail.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await detail.waitFor({ state: 'detached' });
  assert.equal(
    await cards.count(),
    26,
    'Closing a post preserves all loaded feed pages',
  );
  await page
    .getByRole('textbox', { name: '搜索动态', exact: true })
    .fill('散步');
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-feed-grid .sw-post').length === 1,
  );
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await cards.nth(23).waitFor();
  await page.getByRole('button', { name: '最新', exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.sw-feed-grid .sw-post')
        ?.getAttribute('data-post-id') === '26',
  );
  await page.getByRole('button', { name: '关注', exact: true }).click();
  await login.waitFor();
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  assert.deepEqual(
    await nav
      .locator('a')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
    ['此刻', '发现', '消息', '通讯录'],
  );
  await nav.getByRole('link', { name: '此刻', exact: true }).click();
  await login.waitFor();
  assert.equal(await page.locator('.mb-live').count(), 0);
  assert(!requests.some((r) => r.path.endsWith('/console/moment')));
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  await nav.getByRole('link', { name: '通讯录', exact: true }).click();
  await page.locator('.sw-peer-card').waitFor();
  assert.equal(await login.count(), 0);
  await page
    .getByRole('button', { name: '查看公开主页', exact: false })
    .click();
  const profile = page.locator('.sn-person-home');
  await profile.getByText('喜欢散步与摄影。', { exact: true }).waitFor();
  await profile.getByRole('button', { name: '资料', exact: true }).click();
  await profile
    .locator('.sn-public-fields')
    .getByText('阅读与设计', { exact: true })
    .waitFor();
  await profile.getByRole('button', { name: '关注', exact: true }).click();
  await login.waitFor();
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  assert.equal(await profile.isVisible(), true);
  await page.goBack();
  await page.locator('.sw-peer-card').waitFor();
  await page.goForward();
  await profile.waitFor();
  await nav.getByRole('link', { name: '消息', exact: true }).click();
  await page.locator('.messages .ew-live-chat').waitFor();
  assert.equal(await login.count(), 0);
  await page
    .locator('.ew-live-chat')
    .getByRole('button', { name: '登录 / 加入', exact: true })
    .click();
  await login.waitFor();
  // Both credential methods use the same owner login contract.
  await login
    .getByRole('textbox', { name: '手机号', exact: true })
    .fill('13800138000');
  await login
    .getByLabel('账号密码', { exact: true })
    .fill('test-password-only');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  await login.getByRole('alert').waitFor();
  assert.deepEqual(loginRequests.at(-1), {
    phone: '13800138000',
    password: 'test-password-only',
  });
  await login.getByRole('button', { name: '账号登录', exact: true }).click();
  assert.equal(
    await login.getByLabel('账号密码', { exact: true }).inputValue(),
    '',
  );
  await login
    .getByRole('textbox', { name: '账号', exact: true })
    .fill('123456');
  await login
    .getByLabel('账号密码', { exact: true })
    .fill('test-password-only');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="alert"]')
      ?.textContent.includes('账号或密码不正确'),
  );
  assert.deepEqual(loginRequests.at(-1), {
    uid: '123456',
    password: 'test-password-only',
  });
  loginMode = 'selection';
  await login.getByRole('button', { name: '手机号登录', exact: true }).click();
  await login
    .getByLabel('账号密码', { exact: true })
    .fill('test-password-only');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForResponse(
    (response) =>
      response.url().endsWith('/auth/uid/login') && response.status() === 401,
  );
  assert.deepEqual(loginRequests.at(-1), {
    phone: '13800138000',
    password: 'test-password-only',
    agent_id: '101',
  });
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  // The guest and signed-in preview render the exact same shell and card components.
  const metrics = () =>
    page.evaluate(() => {
      const selectors = [
        '.sw-sidebar',
        '.sw-main',
        '.ew-feed-toolbar',
        '.sw-feed-grid',
        '.sw-mobile-nav',
        '.sw-brand',
        '.sw-sidebar nav',
        '.sw-sidebar .sw-create',
        '.sw-sidebar .sn-account',
      ];
      return selectors.map((selector) => {
        const el = document.querySelector(selector);
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return [
          selector,
          Math.round(rect.x),
          Math.round(rect.width),
          style.display,
          style.columnCount,
          style.gridTemplateColumns,
          selector.startsWith('.sw-sidebar ') || selector === '.sw-brand'
            ? Math.round(rect.y)
            : null,
        ];
      });
    });
  for (const theme of ['warm', 'cool', 'night']) {
    await page.addInitScript(
      (value) => localStorage.setItem('elsewhere-appearance', value),
      theme,
    );
    await page.goto(origin + '#explore');
    await cards.nth(23).waitFor();
    assert.equal(
      await page.locator('.ew-guest-settings, .sn-brand-note').count(),
      0,
    );
    assert.deepEqual(
      await page
        .locator('.sw-sidebar nav a')
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute('aria-label')),
        ),
      ['此刻', '发现', '消息', '通讯录'],
    );
    const guestMetrics = await metrics();
    await page.goto(origin + 'preview#explore');
    await page.locator('.sw-post').first().waitFor();
    assert.deepEqual(
      await metrics(),
      guestMetrics,
      'Desktop layout parity in ' + theme,
    );
  }
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', (error) => errors.push(error.message));
  await mobilePage.goto(origin + 'preview/login#explore');
  await mobilePage.locator('.sw-post').first().waitFor();
  assert.equal(await mobilePage.locator('.sw-mobile-nav').isVisible(), true);
  assert.equal(
    await mobilePage
      .locator('.sw-feed-grid')
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
      ),
    2,
  );
  assert.ok(
    await mobilePage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const mobileNav = mobilePage.getByRole('navigation', {
    name: '移动导航',
    exact: true,
  });
  assert.deepEqual(
    await mobileNav
      .locator('a,button')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('aria-label') || n.textContent.trim()),
      ),
    ['此刻', '发现', '消息', '发布', '通讯录', '我的'],
  );
  await mobileNav.getByRole('link', { name: '通讯录', exact: true }).click();
  await mobilePage.locator('.sw-peer-card').first().waitFor();
  await mobileNav.getByRole('button', { name: '发布', exact: true }).click();
  await mobilePage.getByRole('dialog', { name: '加入 elsewhere' }).waitFor();
  await mobile.close();
  // A direct post URL can mount a native modal while entry resources are pending.
  // It must stay below the curtain, including the morph-to-reveal transition.
  const animated = await context.newPage();
  animated.on('pageerror', (error) => errors.push(error.message));
  await animated.emulateMedia({ reducedMotion: 'no-preference' });
  await animated.addInitScript(() =>
    sessionStorage.removeItem('elsewhere:entry-seen:v1'),
  );
  let releaseLogo;
  const logoReady = new Promise((resolve) => {
    releaseLogo = resolve;
  });
  await animated.route('**/brand/wordmark.svg', async (route) => {
    await logoReady;
    await route.continue();
  });
  await animated.goto(origin + '?post=1#explore', {
    waitUntil: 'domcontentloaded',
  });
  await animated.locator('.ew-note-detail').waitFor({ state: 'attached' });
  const curtain = animated.locator('.ew-brand-entry');
  assert.equal(await curtain.getAttribute('data-entry-phase'), 'loading');
  assert.equal(await curtain.evaluate((el) => el.matches(':modal')), true);
  assert.equal(
    await animated
      .locator('.ew-note-detail')
      .evaluate((el) => el.matches(':modal')),
    false,
  );
  assert.equal(
    await animated
      .locator('.sw-sidebar')
      .evaluate((el) => getComputedStyle(el).visibility),
    'hidden',
  );
  assert.equal(
    await animated
      .getByText('你的 agent，正在登陆「别处」', { exact: true })
      .isVisible(),
    true,
  );
  releaseLogo();
  await animated.locator('.ew-brand-entry[data-entry-phase="morph"]').waitFor();
  assert.equal(
    await animated
      .locator('.sw-sidebar')
      .evaluate((el) => getComputedStyle(el).visibility),
    'hidden',
  );
  await curtain.waitFor({ state: 'detached' });
  await animated.locator('.ew-note-detail[open]').waitFor();
  assert.equal(
    await animated
      .locator('.ew-note-detail')
      .evaluate((el) => el.matches(':modal')),
    true,
  );
  assert.equal(
    await animated.locator('.ew-entry-content').getAttribute('aria-hidden'),
    null,
  );
  await animated.close();
  await page.goto(origin + '#explore');
  await cards.nth(23).waitFor();
  feedMode = 'error';
  await page.reload();
  await page
    .getByRole('alert')
    .filter({ hasText: '暂时无法读取动态' })
    .waitFor();
  feedMode = 'empty';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('还没有新动态', { exact: true }).waitFor();
  assert.equal(
    requests.filter((r) => r.method !== 'GET').length,
    4,
    'Only explicit login attempts may write',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: shared desktop/mobile layout, public reading/search/paging/profiles, selective login, private API isolation and phone login.',
  );
} finally {
  await browser.close();
  await server.close();
}
