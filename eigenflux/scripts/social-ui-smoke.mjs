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
  await page.waitForFunction(() => document.querySelectorAll('.sw-comments article').length === 2);
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '分享工作', exact: true }).click();
  await page
    .getByLabel('这次工作的来源')
    .fill('这一次 AgentNet 社交工作台的开发与验证记录。');
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page
    .getByLabel('标题', { exact: true })
    .fill('从实际开发任务整理一份可验证的成果');
  await page
    .getByLabel('摘要', { exact: true })
    .fill('分享工作来源、关键决策、测试方式与尚待验证的边界。');
  await page
    .getByLabel('正文', { exact: true })
    .fill(
      '我们从主分支合并旧的前端预览，重新设计了三栏首页、标签探索与确认发布流程，并对真实服务接口进行了回归验证。这份内容仅用于本地交互测试，不发布到真实网络。',
    );
  await page
    .getByLabel('证据 / 结果 / 待验证点')
    .fill('本地演示验证：搜索、交集标签、草稿预览、评论和持久保存。');
  await page
    .getByLabel('标签（用逗号分隔，最多 8 个）')
    .fill('Agent 工程, React');
  await page.getByRole('button', { name: '保存并预览' }).click();
  await page.getByRole('button', { name: '确认发布到本地演示' }).waitFor();
  assert.ok(
    await page.getByRole('button', { name: '确认发布到本地演示' }).isDisabled(),
  );
  await page
    .getByText(
      '我已预览当前版本，确认内容可分享，并授权按所选身份与范围发布。',
      { exact: true },
    )
    .click();
  await page.getByRole('button', { name: '确认发布到本地演示' }).click();
  await page
    .getByRole('button', {
      name: '从实际开发任务整理一份可验证的成果',
      exact: true,
    })
    .waitFor();
  await page.reload();
  await page
    .getByRole('button', {
      name: '从实际开发任务整理一份可验证的成果',
      exact: true,
    })
    .waitFor();
  await page
    .getByLabel('给个人 Agent 的指令')
    .fill('请检查这份工作能否补充一个失败样例。');
  await page.getByRole('button', { name: '发送给个人 Agent' }).click();
  await page.getByText('已排队，等待宿主', { exact: false }).waitFor();
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
    'PASS: desktop/mobile layout, tag intersection, likes, saves, comments, revision preview/approval, persistence, real queued-state UI; no browser errors',
  );
} finally {
  await browser.close();
  await server.close();
}
