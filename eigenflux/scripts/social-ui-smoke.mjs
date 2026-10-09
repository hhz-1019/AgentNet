import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('.agentnet-audit', { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 4322, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch({
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.url());
  });
  await page.goto('http://127.0.0.1:4322/preview');
  await page.locator('.sw-post').first().waitFor();
  assert.equal(
    await page
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link')
      .count(),
    3,
  );
  assert.equal(await page.locator('.sw-agent-rail').count(), 0);
  assert.equal(await page.locator('.sn-account').count(), 1);
  await page.getByRole('button', { name: '关注', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 3,
  );
  await page.getByRole('button', { name: '推荐', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '标签', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '#散步', exact: true }).click();
  await page.getByText('话题 · #散步', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 1,
  );
  await page.getByRole('button', { name: '返回全部', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 6,
  );
  await page
    .getByRole('button', { name: '查看小周的 Agent的主页', exact: true })
    .click();
  await page.getByRole('button', { name: '退出主页', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 6,
  );
  assert.equal(new URL(page.url()).hash, '#explore');
  await page.getByRole('button', { name: '点赞', exact: true }).first().click();
  await page.getByRole('button', { name: '取消点赞', exact: true }).waitFor();
  await page.getByRole('button', { name: '收藏', exact: true }).first().click();
  await page.getByRole('link', { name: '我的', exact: true }).first().click();
  await page.getByRole('link', { name: '点赞', exact: true }).click();
  await page.getByRole('button', { name: '取消点赞', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '我的通讯录', exact: true }).count(),
    0,
  );
  await page.getByRole('link', { name: '收藏', exact: true }).click();
  await page.locator('.sw-post').waitFor();
  await page.reload();
  await page.locator('.sw-post').waitFor();
  assert.equal(new URL(page.url()).hash, '#saved');
  await page.getByRole('button', { name: '查看评论', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('你的评论').fill('这个想法很有意思。');
    await page.getByRole('button', { name: '发布评论', exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.sw-comments article').length === n,
      i + 1,
    );
  }
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('link', { name: '个人画像', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('link', { name: '隐私与连接', exact: true }).count(),
    0,
  );
  await page.getByRole('link', { name: '我的主页', exact: true }).click();
  await page.getByRole('button', { name: '编辑画像', exact: true }).click();
  await page.getByLabel('昵称', { exact: true }).waitFor();
  await page.getByRole('link', { name: '消息', exact: true }).first().click();
  await page.getByRole('button', { name: '发起群聊', exact: true }).click();
  await page.getByLabel('群聊名称').fill('前端流程验收群');
  await page.getByLabel('林间的 Agent', { exact: true }).check();
  await page.getByRole('button', { name: '创建群聊', exact: true }).click();
  await page
    .getByRole('heading', { name: '前端流程验收群', exact: true })
    .waitFor();
  await page.getByRole('button', { name: '群聊详情', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByText('我的 Agent', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('输入消息', { exact: true }).fill('周末一起去书店吧。');
  await page.getByLabel('输入消息', { exact: true }).press('Shift+Enter');
  assert.equal(
    await page.getByLabel('输入消息').inputValue(),
    '周末一起去书店吧。\n',
  );
  await page.getByLabel('输入消息').press('Enter');
  await page
    .locator('.sn-message.own')
    .getByText('周末一起去书店吧。', { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel('输入消息').inputValue(), '');
  await page.reload();
  await page
    .locator('.sn-message.own')
    .getByText('周末一起去书店吧。', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '发布', exact: true }).first().click();
  await page
    .getByLabel('想分享什么？', { exact: true })
    .fill('分享今天散步的发现');
  await page.getByLabel('谁可以看', { exact: true }).selectOption('好友');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '发布', exact: true })
    .click();
  await page.getByText('动态已发布。', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: '分享今天散步的发现', exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole('button', { name: '分享今天散步的发现', exact: true })
    .waitFor();
  for (const route of [
    'explore',
    'messages',
    'network',
    'me',
    'liked',
    'settings',
    'profile',
    'memories',
    'person/demo-research',
  ]) {
    await page.goto('http://127.0.0.1:4322/preview#' + route);
    await page.locator('#social-main').waitFor();
    assert.doesNotMatch(
      await page.locator('body').innerText(),
      /交互预览|示例内容|群聊示例|本机原型|推荐引擎待接入|在宿主中回复|Agent 代表我/,
    );

    for (const width of [1084, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow: ${route} at ${width}`,
      );
    }
  }
  assert.deepEqual(requests, [], 'preview must not contact backend APIs');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: social navigation, personal collection, topic browsing, comments, settings, direct personal/group messages, direct publication, refresh routes, desktop layout; no API calls or browser errors',
  );
} finally {
  await browser.close();
  await server.close();
}
