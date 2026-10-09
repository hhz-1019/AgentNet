// Exercise the actual demo and live UI; fixtures are explicit, no real posting.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 4345 },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.AGENTNET_CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let productionRequests = 0;
  await page.route('**/api/v2/**', (route) => {
    productionRequests++;
    return route.abort();
  });
  await page.goto('http://127.0.0.1:4345/preview');
  const showcase = page.getByRole('region', { name: '工作精选' });
  await showcase.waitFor();
  await showcase.getByRole('button', { name: /打开精选工作/ }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await mkdir('.agentnet-audit', { recursive: true });
  await page.screenshot({
    path: '.agentnet-audit/codrops-discovery-desktop.png',
    fullPage: true,
  });
  await page.screenshot({
    path: '.agentnet-audit/codrops-discovery-desktop-viewport.png',
  });
  await showcase.getByRole('button', { name: /精选工作.*研究流程/ }).click();
  await showcase
    .getByRole('button', { name: /打开精选工作：研究流程/ })
    .waitFor();
  await showcase.getByRole('button', { name: /打开精选工作/ }).click();
  const dialog = page.getByRole('dialog', { name: '成果详情' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '交给我的 Agent' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#agent-instruction')
      ?.value.includes('工作编号：105'),
  );
  assert.match(
    await page.getByLabel('给个人 Agent 的指令').inputValue(),
    /研究流程.*工作编号：105/s,
  );
  assert.match(
    await page.getByLabel('给个人 Agent 的指令').inputValue(),
    /不要自动发送消息或发布/,
  );
  assert.equal(
    await page.locator('.ex-task').count(),
    0,
    'opening collaboration does not enqueue',
  );
  await page.getByRole('button', { name: '发送给个人 Agent' }).click();
  await page.locator('.ex-task').waitFor();
  await page.getByRole('button', { name: '我的工作', exact: true }).click();
  const home = page.getByRole('region', { name: '个人工作主页' });
  await home.waitFor();
  await home.getByRole('button', { name: '首次使用体验' }).waitFor();
  await page.screenshot({
    path: '.agentnet-audit/codrops-workhome-desktop.png',
    fullPage: true,
  });
  await home.getByRole('button', { name: '首次使用体验' }).click();
  const share = page.getByRole('dialog', { name: '让 Agent 分享工作' });
  assert.match(
    await share.getByLabel('你想分享什么？').inputValue(),
    /首次使用体验/,
  );
  await share.getByRole('button', { name: '关闭窗口' }).click();
  await page
    .locator('.sw-sidebar')
    .getByRole('link', { name: '发现', exact: true })
    .click();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      'overflow at ' + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '.agentnet-audit/codrops-discovery-mobile.png',
    fullPage: true,
  });
  await page.screenshot({
    path: '.agentnet-audit/codrops-discovery-mobile-viewport.png',
  });
  await showcase.getByRole('button', { name: /打开精选工作/ }).click();
  await page
    .getByRole('dialog', { name: '成果详情' })
    .getByRole('button', { name: '交给我的 Agent' })
    .click();
  await page.locator('.sw-rail-wrap.open').waitFor();
  assert.match(
    await page.getByLabel('给个人 Agent 的指令').inputValue(),
    /工作编号/,
  );
  await page.getByRole('button', { name: '关闭 Agent 面板' }).click();
  assert.equal(productionRequests, 0);
  await page.unroute('**/api/v2/**');
  let runtimeFails = true;
  const commands = [
    {
      id: '7001',
      instruction: '请分享研究结果',
      status: 'completed',
      result: {
        execution: 'model_analysis',
        reply: '没有足够资料，没有发布。',
      },
      created_at: 1,
    },
    {
      id: '7002',
      instruction: '请分享项目成果',
      status: 'completed',
      result: { execution: 'shared', post_id: '8801', reply: '已发布。' },
      created_at: 1,
    },
  ];
  const owner = {
    id: '8801',
    agent_id: '1',
    author_name: '测试 Agent',
    state: 'published',
    visibility: 'public',
    revision: 1,
    document: {
      title: '研究项目的实际结果',
      summary: '工作记录中的结果。',
      body: '真实接口夹具中的项目说明。',
      kind: 'result',
      tags: ['研究'],
      source: '实验记录',
      evidence: '待复核',
      media: [],
      identity: 'agent',
      project_name: '研究项目',
    },
    likes: 0,
    saves: 0,
    comments: 0,
    created_at: 1,
    published_at: 1,
  };
  const respond = (route, data) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data }),
    });
  await page.route('**/api/v2/**', (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v2/', '');
    if (path === 'console/session')
      return respond(route, {
        agent_id: '1',
        agent_name: '测试 Agent',
        owner_uid: '314159265',
        owner_bound: true,
        bio: '研究助理',
        onboarding: { state: 'completed', current_step: 6, revision: 1 },
      });
    if (path === 'public/agents/by-id/1/card')
      return respond(route, {
        card: {
          agent_id: '1',
          agent_name: '测试 Agent',
          agent_description: '研究助理',
          offering: ['实验设计'],
          seeking: ['对照复核'],
        },
      });
    if (path === 'console/social/preferences')
      return respond(route, { tags: [], revision: 1 });
    if (path === 'console/social/posts')
      return respond(route, {
        items:
          url.searchParams.get('scope') === 'mine'
            ? [owner]
            : [
                owner,
                {
                  ...owner,
                  id: '8802',
                  agent_id: '2',
                  document: { ...owner.document, project_name: '别人的项目' },
                },
              ],
        next_cursor: '',
      });
    if (path === 'console/social/posts/8801')
      return respond(route, { post: owner });
    if (path.endsWith('/comments')) return respond(route, { items: [] });
    if (path === 'console/social/commands')
      return respond(route, { items: commands });
    if (path === 'console/today/status')
      return runtimeFails
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: '服务暂不可用' } }),
          })
        : respond(route, {
            runtime_state: 'active',
            fresh_until: Date.now() + 60000,
          });
    return respond(route, { items: [], allowed: false });
  });
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('http://127.0.0.1:4345/dashboard/mine');
  await home.getByRole('button', { name: '研究项目', exact: true }).waitFor();
  await home.getByText('UID 314159265', { exact: true }).waitFor();
  assert.equal(
    await home.getByRole('button', { name: '别人的项目' }).count(),
    0,
  );
  await home.getByText('连接状态读取失败', { exact: true }).waitFor();
  runtimeFails = false;
  await home.getByRole('button', { name: '刷新状态' }).click();
  await home.getByText('Agent 已连接', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '查看已发布成果', exact: true })
      .count(),
    1,
    'model completion is not publication',
  );
  await page
    .getByRole('button', { name: '查看已发布成果', exact: true })
    .click();
  await page.getByRole('dialog', { name: '成果详情' }).waitFor();
  await page
    .getByRole('dialog', { name: '成果详情' })
    .getByRole('button', { name: '关闭窗口' })
    .click();
  await page.screenshot({
    path: '.agentnet-audit/codrops-task-status-desktop.png',
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .locator('.sw-sidebar')
    .getByRole('link', { name: '发现', exact: true })
    .click();
  await showcase.getByRole('button', { name: /打开精选工作/ }).click();
  await page.getByRole('dialog', { name: '成果详情' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: showcase/detail, contextual draft without automatic sending, project handoff, UID/owner isolation, connection recovery, receipt truthfulness, demo isolation and 360–1440px layouts',
  );
} finally {
  await browser?.close();
  await server.close();
}
