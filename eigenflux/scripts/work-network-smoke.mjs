// Actual React UI with explicit API fixtures. No real publication or SMS.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 4341, host: '127.0.0.1' },
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
    viewport: { width: 1600, height: 1100 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mkdir('.agentnet-audit', { recursive: true });
  const origin = 'http://127.0.0.1:4341';
  let requests = 0;
  await page.route('**/api/v2/**', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto(origin + '/preview');
  await page.locator('.ex-network-disclosure > summary').click();
  const graph = page.getByRole('region', { name: '工作与 Agent 关系图' });
  await graph.waitFor();
  await graph.getByRole('button', { name: '查看关联理由' }).click();
  await graph.getByText('关联依据', { exact: true }).waitFor();
  await graph.getByRole('button', { name: '产品开发' }).click();
  await graph.getByRole('button', { name: '查看工作来源' }).click();
  await graph.getByText('需求讨论与开发记录', { exact: true }).last().waitFor();
  await graph.getByRole('button', { name: '下一步演示' }).click();
  assert.equal(
    await graph.locator('.wn-canvas').getAttribute('data-step'),
    '1',
  );
  await graph.getByRole('button', { name: '播放演示' }).click();
  await graph.getByRole('button', { name: '暂停演示' }).click();
  await graph.getByRole('button', { name: '重播演示' }).click();
  await graph.getByRole('button', { name: '暂停演示' }).click();
  assert.equal(
    await graph.locator('.wn-canvas').getAttribute('data-step'),
    '0',
  );
  await graph.getByRole('button', { name: '4 发现关联' }).click();
  await graph.getByRole('button', { name: '查看工作成果' }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: '.agentnet-audit/codrops-network-desktop.png',
  });
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
    const node = await graph
      .getByRole('button', { name: '查看工作成果' })
      .boundingBox();
    assert(node && node.x >= 0 && node.x + node.width <= width);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({
    path: '.agentnet-audit/codrops-network-mobile.png',
  });
  await graph.getByRole('button', { name: '让我的 Agent 分享工作' }).click();
  const share = page.getByRole('dialog', { name: '让 Agent 分享工作' });
  assert.match(
    await share.getByLabel('你想分享什么？').inputValue(),
    /首次使用流程/,
  );
  await share.getByRole('button', { name: '授权 Agent 整理并发布' }).click();
  await share.getByRole('status').filter({ hasText: '已记录在本机' }).waitFor();
  assert.equal(requests, 0, 'demo must not reach production APIs');
  await share
    .getByRole('button', { name: '关闭，任务保留在 Agent 对话中' })
    .click();
  await page.unroute('**/api/v2/**');
  const post = {
    id: '601',
    agent_id: '2',
    author_name: '研究伙伴 Agent',
    state: 'published',
    revision: 1,
    visibility: 'public',
    document: {
      title: '社会模拟研究的对照结果',
      summary: '公开工作中的方法与验证边界。',
      body: '公开研究记录，说明实验设定、方法、对照结果与下一步验证。',
      kind: 'result',
      tags: ['社会模拟'],
      source: '公开的实验记录',
      evidence: '公开的对照结果，尚未完成外部复核。',
      media: [],
      identity: 'agent',
      project_name: '',
    },
    likes: 0,
    saves: 0,
    comments: 0,
    liked: false,
    saved: false,
    created_at: 1,
    published_at: 1,
  };
  const command = {
    id: '9991',
    instruction: '',
    status: 'pending',
    result: {},
    created_at: 1,
  };
  let submitted;
  let submissions = 0;
  let failPost = true;
  const respond = (route, data) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data }),
    });
  await page.route('**/api/v2/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      '/api/v2/',
      '',
    );
    if (path === 'console/session')
      return respond(route, {
        agent_id: '1',
        agent_name: '我的 Agent',
        short_id: 'SELF',
        owner_uid: '12345',
        owner_bound: true,
        runtime_name: 'Codex',
        runtime_version: '',
        device_name: '',
        bio: '',
        email: '',
        email_bound: false,
        onboarding: { state: 'completed', current_step: 6, revision: 1 },
      });
    if (path === 'console/social/preferences')
      return respond(route, { tags: ['社会模拟'], revision: 1 });
    if (path === 'console/social/posts')
      return respond(route, {
        items: [
          post,
          {
            ...post,
            id: '602',
            visibility: 'private',
            document: { ...post.document, title: '私人内容不能进入关系图' },
          },
        ],
        next_cursor: '',
      });
    if (path === 'console/social/posts/601') {
      if (failPost)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'TEMPORARY_FAILURE', message: '暂时无法读取成果' },
          }),
        });
      return respond(route, { post });
    }
    if (path.endsWith('/comments')) return respond(route, { items: [] });
    if (path === 'console/home/discovery')
      return respond(route, {
        items: [
          {
            agent_id: '3',
            agent_name: '模拟方法 Agent',
            capabilities: ['社会模拟'],
            short_id: 'PEER',
            is_friend: false,
          },
        ],
      });
    if (path === 'public/agents/by-id/1/card')
      return respond(route, {
        card: {
          agent_id: '1',
          agent_name: '我的 Agent',
          agent_description: '我的研究助理',
          offering: ['社会模拟'],
          seeking: [],
        },
      });
    if (path === 'console/social/commands')
      return respond(route, {
        items: [
          {
            ...command,
            id: '9992',
            status: 'completed',
            result: { execution: 'shared', post_id: '888' },
          },
          command,
        ],
      });
    if (path === 'console/today/status')
      return respond(route, { runtime_state: 'offline', fresh_until: 0 });
    if (path === 'agent-commands') {
      submissions++;
      submitted = route.request().postDataJSON();
      command.instruction = submitted.payload.instruction;
      return respond(route, { command_id: command.id });
    }
    return respond(route, { items: [] });
  });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(origin + '/dashboard');
  await page.locator('.ex-network-disclosure > summary').click();
  await graph.getByRole('button', { name: '查看工作成果' }).waitFor();
  assert.equal(
    await graph.locator('option').count(),
    1,
    'private posts must not enter graph',
  );
  await graph.getByRole('button', { name: '查看关联理由' }).click();
  await graph
    .getByText('共同标签：社会模拟。标签相关不代表已经合作。', { exact: true })
    .waitFor();
  await graph.getByRole('button', { name: '让我的 Agent 分享工作' }).click();
  await share.getByRole('button', { name: '授权 Agent 整理并发布' }).click();
  await share.getByRole('status').filter({ hasText: '已排队' }).waitFor();
  assert.equal(submitted.payload.publish, true);
  assert.equal(submitted.payload.visibility, 'public');
  for (const [status, label] of [
    ['notified', '已通知宿主'],
    ['claimed', '宿主正在处理'],
    ['completed', '处理完成，未确认发布'],
  ]) {
    command.status = status;
    command.result =
      status === 'completed'
        ? {
            execution: 'model_analysis',
            reply: '未找到足够资料，本次没有发布。',
          }
        : {};
    await share.getByRole('button', { name: '刷新回执' }).click();
    await share.getByRole('status').filter({ hasText: label }).waitFor();
    assert.equal(
      await share.getByRole('button', { name: '查看已发布成果' }).count(),
      0,
    );
  }
  command.result = {
    execution: 'shared',
    post_id: '601',
    reply: '已整理并发布这份工作分享。',
  };
  await share.getByRole('button', { name: '刷新回执' }).click();
  await share.getByRole('status').filter({ hasText: '已发布' }).waitFor();
  await page.screenshot({ path: '.agentnet-audit/codrops-share-receipt.png' });
  await share.getByRole('button', { name: '查看已发布成果' }).click();
  await share
    .getByRole('alert')
    .filter({ hasText: '成果暂时无法读取' })
    .waitFor();
  failPost = false;
  await share.getByRole('button', { name: '查看已发布成果' }).click();
  await page.getByRole('dialog', { name: '成果详情' }).waitFor();
  assert.equal(
    submissions,
    1,
    'reading a receipt must never resubmit publication',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: graph privacy/tag reasons, project switch/play/pause/replay, 360–1440px layouts, demo isolation, exact command receipt and verified publication',
  );
} finally {
  await browser?.close();
  await server.close();
}
