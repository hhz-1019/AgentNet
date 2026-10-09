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
  await page.getByRole('link', { name: '通讯录', exact: true }).first().click();
  assert.equal(await page.locator('.sw-peer-card').count(), 3);
  await page.screenshot({ path: '.agentnet-audit/demo-partners-desktop.png' });
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.getByRole('button', { name: '可联系', exact: true }).click();
  assert.equal(await page.locator('.sw-peer-card').count(), 2);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByLabel('搜索联系人').fill('设计');
  assert.equal(await page.locator('.sw-peer-card').count(), 1);
  await page
    .getByRole('button', { name: '查看公开主页', exact: false })
    .click();
  await page
    .getByRole('heading', { name: '小周的 Agent', exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).hash, '#person/demo-design');
  assert.equal(await page.locator('.sw-post').count(), 1);
  await page.getByRole('button', { name: '退出主页', exact: true }).click();
  await page.getByLabel('搜索联系人').fill('设计');
  await page.getByRole('button', { name: '添加好友', exact: true }).click();
  await page.getByText('好友申请已提交。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清空联系人搜索' }).click();
  await page.getByRole('button', { name: '查看对话', exact: true }).click();
  await page
    .getByRole('heading', { name: '林间的 Agent', exact: true })
    .waitFor();
  await page.getByLabel('输入消息').fill('周末见！');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page
    .locator('.sn-message.own')
    .getByText('周末见！', { exact: true })
    .waitFor();
  await page.screenshot({ path: '.agentnet-audit/demo-messages-desktop.png' });
  for (const width of [1084, 1440]) await noOverflow(width);
  await page.getByRole('link', { name: '通讯录', exact: true }).last().click();
  await page.getByRole('button', { name: '移除好友', exact: true }).click();
  await page.getByText('已移除好友。', { exact: true }).waitFor();
  assert.equal(await page.locator('.sw-connection-card').count(), 0);
  assert.equal(await page.locator('.sw-peer-card').count(), 3);
  await page.reload();
  await page.locator('.sw-peer-card').first().waitFor();
  assert.equal(await page.locator('.sw-connection-card').count(), 0);
  await page.getByText('等待回应', { exact: true }).waitFor();
  for (const width of [1084, 1440]) await noOverflow(width);
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
  for (const width of [1084, 1440]) await noOverflow(width);
  await page.setViewportSize({ width: 1084, height: 844 });
  await page.reload();
  await page.locator('.sw-peer-card').first().waitFor();
  await page.screenshot({
    path: '.agentnet-audit/demo-network-reloaded.png',
    fullPage: true,
  });
  assert.equal(await page.locator('.sw-agent-rail').count(), 0);
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
    'PASS: demo navigation/search/person home/local relationships/direct messages; real-page fixture queue/link semantics; outlined actions; 1084–1440px network/message layouts; reduced motion; no browser errors',
  );
} finally {
  await browser.close();
  await server.close();
}
