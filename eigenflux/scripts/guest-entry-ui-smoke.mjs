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
await context.route('**/api/v2/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  requests.push({ path, method: request.method(), query: url.search });
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
  await page.goto(origin);
  await page
    .getByRole('button', { name: '查看动态：把周末留给散步', exact: true })
    .waitFor();
  assert.equal(await login.count(), 0, 'No unsolicited login wall');
  await page.getByRole('button', { name: '继续看看', exact: true }).click();
  await page.locator('.guest-post').nth(25).waitFor();
  assert.equal(await page.locator('.guest-post').count(), 26);
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
  await login.getByText('开启 Work / Code 模式', { exact: true }).waitFor();
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  assert.equal(
    await detail.isVisible(),
    true,
    'Closing login preserves reading',
  );
  await detail.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await detail.waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('.guest-post').count(),
    26,
    'Closing reader preserves loaded pages',
  );
  await page.goBack();
  await detail.waitFor();
  await page.goForward();
  await detail.waitFor({ state: 'detached' });
  await page.getByRole('textbox', { name: '搜索公开动态' }).fill('散步');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.guest-post').length === 1,
  );
  assert.equal(await login.count(), 0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.locator('.guest-post').nth(23).waitFor();
  await page.getByRole('button', { name: '#阅读', exact: true }).click();
  await page.getByText('还没有找到这样的故事', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByRole('button', { name: '最新', exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.guest-cover-open')
        ?.getAttribute('aria-label') === '查看动态：记住这些瞬间 26',
  );
  await page.getByRole('button', { name: '认识新朋友', exact: true }).click();
  await page.locator('.guest-person-card').click();
  const profile = page.getByRole('dialog', { name: '公开主页' });
  await profile.waitFor();
  assert.equal(
    await profile
      .locator('.guest-grid')
      .evaluate((el) => getComputedStyle(el).columnCount),
    '2',
  );
  await profile.getByText('喜欢散步与摄影。', { exact: true }).waitFor();
  await profile.getByRole('button', { name: '关于 TA', exact: true }).click();
  await profile.getByText('阅读与设计', { exact: true }).waitFor();
  await profile.getByRole('button', { name: '关注', exact: true }).click();
  await login.waitFor();
  await login.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  assert.equal(await profile.isVisible(), true);
  await profile.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await profile.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '消息', exact: true }).click();
  await page.getByText('让话题继续，聊得更近。', { exact: true }).waitFor();
  assert.equal(await login.count(), 0);
  await page.getByRole('button', { name: '登录查看消息' }).click();
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
  await login.getByRole('button', { name: 'UID 登录', exact: true }).click();
  assert.equal(
    await login.getByLabel('账号密码', { exact: true }).inputValue(),
    '',
  );
  await login
    .getByRole('textbox', { name: '账号 UID', exact: true })
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
  for (const theme of ['warm', 'cool', 'night']) {
    await page.addInitScript(
      (value) => localStorage.setItem('elsewhere-appearance', value),
      theme,
    );
    await page.goto(origin + '#guest?section=explore&post=1');
    await detail.waitFor();
    assert.equal(await login.count(), 0);
    assert.notEqual(
      await detail.evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '#guest?section=explore');
  await page.locator('.guest-post').first().waitFor();
  assert.equal(
    await page
      .locator('.guest-grid')
      .evaluate((el) => getComputedStyle(el).columnCount),
    '2',
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole('navigation', { name: '游客底部导航' })
    .getByRole('button', { name: '新朋友', exact: true })
    .click();
  await page.locator('.guest-person-card').waitFor();
  await page.goto(origin + '#guest?section=explore&post=missing');
  await detail.getByText('这篇动态暂时无法查看', { exact: true }).waitFor();
  await detail.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await detail.waitFor({ state: 'detached' });
  feedMode = 'error';
  await page.reload();
  await page
    .getByRole('alert')
    .filter({ hasText: '动态暂时没有加载出来' })
    .waitFor();
  feedMode = 'empty';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('还没有找到这样的故事', { exact: true }).waitFor();
  assert.equal(
    requests.filter((r) => r.method !== 'GET').length,
    4,
    'Guest interactions never send writes',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: guest browsing, paging, search, topics, public reader/comments/profiles, selective login, back navigation, themes, mobile and privacy gates.',
  );
} finally {
  await browser.close();
  await server.close();
}
