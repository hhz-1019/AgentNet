// UI verification with explicit fixtures. This does not claim production network execution.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 4334, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('.agentnet-audit', { recursive: true });
const origin = 'http://127.0.0.1:4334';
async function noOverflow(width) {
  await page.setViewportSize({ width, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `overflow at ${width}`,
  );
}
try {
  let demoAPIRequests = 0;
  await page.route('**/api/v2/**', async (route) => {
    demoAPIRequests++;
    await route.abort();
  });
  await page.goto(origin + '/preview');
  await page.locator('.sw-post').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.agentnet-audit/demo-discover-desktop.png' });
  await page.getByRole('link', { name: '伙伴', exact: true }).first().click();
  assert.equal(await page.locator('.sw-peer-card').count(), 3);
  await page.screenshot({ path: '.agentnet-audit/demo-partners-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.agentnet-audit/demo-partners-mobile.png' });
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.getByRole('button', { name: '可联系', exact: true }).click();
  assert.equal(await page.locator('.sw-peer-card').count(), 2);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByLabel('搜索伙伴与能力').fill('产品设计');
  assert.equal(await page.locator('.sw-peer-card').count(), 1);
  await page
    .getByRole('button', { name: '查看公开主页', exact: false })
    .click();
  await page
    .getByRole('dialog', { name: '产品设计 Agent · 示例公开名片' })
    .waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page
    .getByRole('button', { name: '让 Agent 联系', exact: true })
    .click();
  await page
    .getByText('联系指令已记录在本机，未发送到真实网络。', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '清空伙伴搜索' }).click();
  await page
    .getByRole('button', { name: '让 Agent 解除联系', exact: true })
    .click();
  await page
    .getByText('解除指令已记录在本机，示例联系仍保留。', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.sw-connection-card').count(), 1);
  assert.equal(await page.locator('.sw-peer-card').count(), 3);
  await page.getByRole('button', { name: '查看对话', exact: true }).click();
  await page
    .getByLabel('给你的 Agent 一条指示')
    .fill('请一起讨论论文的对照实验。');
  await page.getByRole('button', { name: '记录演示指令' }).click();
  await page
    .getByText('请一起讨论论文的对照实验。', { exact: false })
    .waitFor();
  await page.screenshot({ path: '.agentnet-audit/demo-messages-desktop.png' });
  for (const width of [360, 390, 768, 1024, 1440]) await noOverflow(width);
  await page.getByRole('link', { name: '伙伴', exact: true }).last().click();
  for (const width of [360, 390, 768, 1024, 1440]) await noOverflow(width);
  assert.equal(demoAPIRequests, 0, 'demo must not call real network APIs');
  await page.unroute('**/api/v2/**');
  const commands = [];
  const peer = {
    agent_id: '2',
    short_id: 'P2',
    agent_name: '研究伙伴 Agent',
    agent_description:
      '整理文献来源、工作记录与验证边界，为下一次研究留下可以接着做的过程。',
    capabilities: ['论文研究', 'Agent 工程'],
    is_friend: true,
    friend_request_pending: false,
    show_add_friend: false,
    rule_key: 'fixture',
  };
  const stranger = {
    ...peer,
    agent_id: '3',
    short_id: 'P3',
    agent_name: '产品设计 Agent',
    agent_description: '从真实问题开始，整理需求与原型。',
    is_friend: false,
    show_add_friend: true,
  };
  const context = {
    identity_assertion: {
      display_name: '研究伙伴 Agent',
      verification_level: 'official',
    },
    card_summary: {
      agent_description: peer.agent_description,
      offering: peer.capabilities,
      seeking: [],
    },
    viewer_relation: 'friend',
  };
  await page.route('**/api/v2/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      '/api/v2/',
      '',
    );
    let data = {};
    if (path === 'console/session')
      data = {
        agent_id: '1',
        short_id: 'A1',
        agent_name: '你的 Agent',
        owner_bound: true,
        email_bound: true,
        onboarding: { state: 'completed', current_step: 4, revision: 1 },
      };
    else if (path === 'console/home/discovery')
      data = { items: [peer, stranger] };
    else if (path === 'console/relations/friends')
      data = {
        friends: [
          {
            peer_agent_id: '2',
            friend_since: Date.now() - 3600000,
            remark: '',
          },
        ],
        agent_contexts: { 2: context },
        next_cursor: '',
      };
    else if (path === 'console/social/preferences')
      data = { tags: [], revision: 0 };
    else if (path === 'console/accounts') data = { accounts: [] };
    else if (path === 'console/today/status')
      data = { runtime_state: 'inactive', fresh_until: 0 };
    else if (path === 'console/social/commands') data = { items: [] };
    else if (path === 'console/social/posts')
      data = { items: [], next_cursor: '' };
    else if (path === 'agent-commands') {
      commands.push(route.request().postDataJSON());
      data = { command_id: 'fixture-command' };
    }
    await route.fulfill({ json: { data } });
  });
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto(origin + '/dashboard/network');
  await page.locator('.sw-peer-card').first().waitFor();
  await page.locator('.sw-connection-card').waitFor();
  const profileLink = page.locator('.sw-peer-card .sw-button').first();
  assert.equal(await profileLink.getAttribute('href'), '/agent/2');
  const style = await profileLink.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      border: s.borderTopStyle,
      width: s.borderTopWidth,
      height: el.getBoundingClientRect().height,
    };
  });
  assert.equal(style.border, 'solid');
  assert.equal(style.width, '1px');
  assert(style.height >= 38);
  await page.screenshot({ path: '.agentnet-audit/demo-network-desktop.png' });
  await page
    .getByRole('button', { name: '让 Agent 联系', exact: true })
    .click();
  await page
    .getByText('指令已交给你的 Agent，等待它执行。', { exact: true })
    .waitFor();
  assert.equal(commands[0].command_type, 'human_instruction');
  assert(commands[0].payload.instruction.includes('Agent 3'));
  assert(commands[0].idempotency_key);
  await page
    .getByRole('button', { name: '让 Agent 解除联系', exact: true })
    .click();
  await page
    .getByText('已交给 Agent，等待解除关系的执行回执。', { exact: true })
    .waitFor();
  assert(commands[1].payload.instruction.includes('解除与 Agent 2'));
  assert.equal(
    await page.locator('.sw-connection-card').count(),
    1,
    'queued instruction must not fake a removed relationship',
  );
  for (const width of [360, 390, 768, 1024, 1440]) await noOverflow(width);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('.sw-peer-card').first().waitFor();
  await page.screenshot({
    path: '.agentnet-audit/demo-network-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '个人 Agent', exact: true }).click();
  await page.locator('.sw-rail-wrap.open').waitFor();
  await page.getByRole('button', { name: '关闭 Agent 面板' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.sw-peer-card')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: demo navigation/search/profile dialog/local commands; real-page fixture queue/link semantics; outlined actions; 360–1440px network/message layouts; reduced motion; no browser errors',
  );
} finally {
  await browser.close();
  await server.close();
}
