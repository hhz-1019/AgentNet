import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('.agentnet-audit', { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
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
  await page.goto(origin + '/preview');
  await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
  await page.locator('.sw-post').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#explore');
  const mainNav = page.getByRole('navigation', { name: '主导航', exact: true });
  const motions = new Set();
  for (const [label, route] of [
    ['此刻', 'crossing'],
    ['发现', 'explore'],
    ['消息', 'messages'],
  ]) {
    const link = mainNav.getByRole('link', { name: label, exact: true });
    await link.click();
    assert.equal(new URL(page.url()).hash, '#' + route);
    assert.equal(await link.getAttribute('aria-current'), 'page');
    const names = await link
      .locator('svg > *')
      .evaluateAll((parts) =>
        parts
          .map((part) => getComputedStyle(part).animationName)
          .filter((name) => name !== 'none'),
      );
    assert.ok(names.length > 0, label + ' has selection feedback');
    motions.add(names.join(','));
  }
  assert.equal(motions.size, 3, 'navigation destinations have distinct motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mainNav.getByRole('link', { name: '此刻', exact: true }).click();
  assert.equal(
    await mainNav.locator('[aria-current] [data-icon="Moment"]').count(),
    1,
  );
  assert.ok(
    await mainNav
      .locator('[aria-current] svg > *')
      .evaluateAll((parts) =>
        parts.every((part) => getComputedStyle(part).animationName === 'none'),
      ),
  );
  await page.locator('.sw-brand').click();
  assert.equal(new URL(page.url()).hash, '#explore');
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.goto(origin + '/preview#explore');
  await phone.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
  const mobileNav = phone.locator('.sw-mobile-nav');
  await mobileNav.waitFor();
  assert.equal(await mobileNav.locator(':scope > *').count(), 5);
  await mobileNav.getByRole('link', { name: '此刻', exact: true }).click();
  await phone.locator('.mb-field').waitFor();
  const field = await phone.locator('.mb-field').boundingBox();
  const bottom = await mobileNav.boundingBox();
  assert.ok(field.height > 500, 'Moment owns the available phone viewport');
  assert.ok(
    field.y + field.height <= bottom.y + 1,
    'navigation cannot cover the field',
  );
  assert.equal(
    await mobileNav.locator('[aria-current] [data-icon="Moment"]').isVisible(),
    true,
  );
  await mobileNav.getByRole('link', { name: '发现', exact: true }).click();
  assert.equal(new URL(phone.url()).hash, '#explore');
  await mobileNav.getByRole('link', { name: '消息', exact: true }).click();
  await phone.locator('.sn-message-page').waitFor();
  const messageSections = await phone
    .locator('.sw-message-sections')
    .boundingBox();
  assert.equal(messageSections.x, 12);
  await phone.screenshot({
    path: '.agentnet-audit/moment-mobile-messages.png',
  });
  await phone
    .getByRole('navigation', { name: '消息与通讯录' })
    .getByRole('link', { name: '通讯录', exact: true })
    .click();
  await phone.locator('.sw-network-page').waitFor();
  const contactSections = await phone
    .locator('.sw-message-sections')
    .boundingBox();
  assert.equal(contactSections.x, messageSections.x);
  assert.equal(contactSections.y, messageSections.y);
  await phone.screenshot({
    path: '.agentnet-audit/moment-mobile-contacts.png',
  });
  assert.equal(
    await mobileNav
      .getByRole('link', { name: '消息', exact: true })
      .getAttribute('aria-current'),
    'page',
  );
  await phone
    .getByRole('navigation', { name: '消息与通讯录' })
    .getByRole('link', { name: '会话', exact: true })
    .click();
  await phone.locator('.sn-message-page').waitFor();
  await phone.close();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
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
  await page
    .getByRole('button', {
      name: '查看动态：把周末留一点给无目的的散步',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '#散步', exact: true })
    .click();
  await page.getByText('话题 · #散步', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 1,
  );
  await page.getByRole('button', { name: '返回全部', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 7,
  );
  await page
    .getByRole('button', { name: '查看小周的 Agent的主页', exact: true })
    .click();
  await page.getByRole('button', { name: '退出主页', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-post').length === 7,
  );
  assert.equal(new URL(page.url()).hash, '#explore');
  await page.getByRole('button', { name: '点赞', exact: true }).first().click();
  await page.getByRole('button', { name: '取消点赞', exact: true }).waitFor();
  await page
    .getByRole('button', {
      name: '查看动态：把周末留一点给无目的的散步',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '收藏', exact: true })
    .click();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
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
  await page
    .getByRole('button', {
      name: '查看动态：把周末留一点给无目的的散步',
      exact: true,
    })
    .click();
  assert.equal(await page.getByText('来源与说明', { exact: true }).count(), 0);
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('你的评论').fill('这个想法很有意思。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.sw-comments article').length === n,
      i + 1,
    );
  }
  // Preview authors have no uploaded portraits. Keep their avatar frames,
  // without inventing an image or falling back to the numeric Agent ID.
  const commentAvatars = page.locator('.ew-comment-avatar');
  assert.equal(await commentAvatars.count(), 2);
  assert.deepEqual(await commentAvatars.allTextContents(), ['', '']);
  assert.equal(await page.getByLabel('你的评论').inputValue(), '');
  assert.equal(
    await page.getByRole('button', { name: '发送', exact: true }).isVisible(),
    false,
  );
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
  assert.equal(
    await page
      .locator('.sn-message-byline, .sn-message-time, .sn-sender-kind')
      .count(),
    0,
  );
  await page.getByLabel('输入消息', { exact: true }).focus();
  const inputAppearance = await page
    .getByLabel('输入消息', { exact: true })
    .evaluate((el) => ({
      outline: getComputedStyle(el).outlineStyle,
      placeholder: getComputedStyle(el, '::placeholder').fontSize,
      body: getComputedStyle(el).fontSize,
    }));
  assert.equal(inputAppearance.outline, 'none');
  assert.equal(
    inputAppearance.placeholder,
    inputAppearance.body,
    'Composer placeholder must use the same readable scale as its text',
  );
  await page.screenshot({ path: '.agentnet-audit/messages-density.png' });
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
  assert.ok((await page.locator('.sn-message .ew-chat-avatar').count()) > 0);
  await page.reload();
  await page
    .locator('.sn-message.own')
    .getByText('周末一起去书店吧。', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '发布', exact: true }).first().click();
  await page
    .getByLabel('正文', { exact: true })
    .fill('沿着河边走，发现一家新的书店。');
  await page.getByLabel('标题', { exact: true }).fill('分享今天散步的发现');
  await page.getByLabel(/^Tag/).fill('日常，散步，日常');
  assert.equal(
    await page.locator('.ew-share-tags .ew-share-tag-list > span').count(),
    2,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '添加图片', exact: true })
      .innerText(),
    '',
  );
  assert.equal(
    await page
      .getByRole('button', { name: '添加视频', exact: true })
      .innerText(),
    '',
  );
  await page.getByLabel('正文', { exact: true }).focus();
  assert.equal(
    await page
      .getByLabel('正文', { exact: true })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
    'none',
  );
  assert.equal(
    await page
      .getByLabel('正文', { exact: true })
      .evaluate((el) => getComputedStyle(el).boxShadow),
    'none',
  );
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: '发布', exact: true }).first().click();
  assert.equal(
    await page.getByLabel('标题', { exact: true }).inputValue(),
    '分享今天散步的发现',
  );
  assert.equal(await page.getByLabel(/^Tag/).inputValue(), '日常，散步，日常');
  await page.getByLabel(/^Tag/).fill('一，二，三，四，五，六，七，八，九');
  assert.equal(
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '发布', exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel(/^Tag/).fill('日常，散步');
  const audience = page.getByRole('group', { name: '谁可以看', exact: true });
  await audience.getByRole('radio', { name: '好友可见', exact: true }).check();
  await audience
    .getByRole('radio', { name: '好友可见', exact: true })
    .press('ArrowLeft');
  assert.equal(
    await audience
      .getByRole('radio', { name: '公开', exact: true })
      .isChecked(),
    true,
  );
  await audience
    .getByRole('radio', { name: '公开', exact: true })
    .press('ArrowRight');
  assert.equal(
    await audience
      .getByRole('radio', { name: '好友可见', exact: true })
      .isChecked(),
    true,
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '发布', exact: true })
    .click();
  await page.getByText('动态已发布。', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: '查看动态：分享今天散步的发现', exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole('button', { name: '查看动态：分享今天散步的发现', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: '查看动态：分享今天散步的发现', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .locator('.ew-reading-body')
    .getByText('沿着河边走，发现一家新的书店。', { exact: true })
    .waitFor();
  assert.ok(
    (await page.getByRole('dialog').locator('.sw-tags').innerText()).includes(
      '散步',
    ),
  );
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
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
    await page.goto(origin + '/preview#' + route);
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
