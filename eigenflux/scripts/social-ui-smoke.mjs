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
  await page.goto('http://127.0.0.1:4322/preview');
  await page.waitForSelector('.sw-post');
  await page.screenshot({ path: '.agentnet-audit/social-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.agentnet-audit/social-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1040 });
  assert.equal(await page.locator('.sw-post').count(), 4);
  await page.getByRole('button', { name: '标签', exact: true }).click();
  await page
    .locator('.sw-tag-panel')
    .getByRole('button', { name: '#React', exact: true })
    .click();
  await page
    .locator('.sw-tag-panel')
    .getByRole('button', { name: '#Agent 工程', exact: true })
    .click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.sw-post').count(), 1);
  await page.getByRole('button', { name: '清除标签', exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: '点赞', exact: true }).first().click();
  assert.equal(
    await page.getByRole('button', { name: '取消点赞', exact: true }).count(),
    1,
  );
  await page.getByRole('button', { name: '收藏', exact: true }).first().click();
  await page
    .getByRole('button', { name: '查看评论', exact: true })
    .first()
    .click();
  await page.getByLabel('你的评论').fill('具体过程能否补充一个失败样例？');
  await page.getByRole('button', { name: '发布本地评论', exact: true }).click();
  await page
    .getByText('具体过程能否补充一个失败样例？', { exact: true })
    .waitFor();
  await page.getByLabel('你的评论').fill('具体过程能否补充一个失败样例？');
  await page.getByRole('button', { name: '发布本地评论', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.sw-comments article').length === 2,
  );
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page
    .locator('.sw-sidebar')
    .getByRole('button', { name: '分享工作', exact: true })
    .click();
  assert.equal(await page.locator('.sw-starter').count(), 0);
  await page.getByLabel('你想分享什么？').fill('分享社会模拟项目的验证工作');
  await page.getByLabel('发布范围').selectOption('friends');
  await page.screenshot({ path: '.agentnet-audit/agent-share-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.agentnet-audit/agent-share-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1040 });
  assert.equal(await page.getByLabel('标题', { exact: true }).count(), 0);
  await page
    .getByRole('button', { name: '授权 Agent 整理并发布', exact: true })
    .click();
  await page
    .getByText('请整理并发布以下工作的中文分享：分享社会模拟项目的验证工作', {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator('.sw-post').count(), 4);
  await page.reload();
  await page
    .getByLabel('给个人 Agent 的指令')
    .fill('请检查这份工作能否补充一个失败样例。');
  await page.getByRole('button', { name: '发送给个人 Agent' }).click();
  await page.getByText('本地演示记录', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.sw-agent-bubble').count(), 0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, `overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '个人 Agent', exact: true }).click();
  await page.locator('.sw-rail-wrap.open').waitFor();
  await page.getByRole('button', { name: '关闭 Agent 面板' }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: desktop/mobile layout, tag intersection, likes, saves, comments, Agent sharing instruction, no manual editor, persistence, real queued-state UI; no browser errors',
  );
} finally {
  await browser.close();
  await server.close();
}
