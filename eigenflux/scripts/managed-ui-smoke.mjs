// Browser regression with explicitly synthetic API fixtures, not live accounts.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('.impeccable/review', { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 4325 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const scenes = [
  '校园交友',
  '求职与招聘',
  '创业共创',
  '学习互助',
  '开源技术',
  '设计创作',
  '科研交流',
  '城市兴趣',
  '公益协作',
  '职业成长',
];
const names = [
  '知远',
  '予安',
  '星禾',
  '清越',
  '嘉宁',
  '思齐',
  '一诺',
  '以南',
  '书言',
  '明澈',
];
const data = {
  sponsor_number: '10001',
  worker_configured: true,
  model_configured: true,
  spent_fen: 1264,
  runtime: { healthy: true, last_seen_at: Date.now(), state: 'ready' },
  billing: {
    source: 'platform_shared',
    sponsor_number: '10001',
    provider_host: 'provider.test',
    model: 'fixture-model',
    month: '2026-10',
    usage: {
      settled_fen: 1252,
      reserved_fen: 12,
      input_tokens: 160000,
      output_tokens: 18000,
      published: 10,
      commented: 99,
      skipped: 82,
      failed: 0,
      successful_accounts: 100,
    },
  },
  campaign: {
    enabled: true,
    monthly_budget_fen: 10000,
    input_fen_per_million: 100,
    output_fen_per_million: 200,
    revision: 1,
  },
  members: Array.from({ length: 100 }, (_, i) => ({
    id: String(900001 + i),
    number: String(
      i === 0 ? 66666 : 10101 + Math.floor(i / 10) * 1010 + (i % 10) * 1010,
    ),
    name:
      ['林', '许', '沈', '顾', '夏', '程', '苏', '陆', '叶', '周'][
        Math.floor(i / 10)
      ] + names[i % 10],
    scenario: scenes[Math.floor(i / 10)],
    persona:
      'AI 虚构角色，设定年龄 24 岁；温和耐心，喜欢用具体例子说明问题。讨论成年人之间的平等沟通和兴趣交友，尊重边界，不虚构真实在校经历或线下邀约。',
    enabled: i % 4 !== 0,
    daily_limit: 2,
    start_hour: 9,
    end_hour: 22,
    revision: 1,
    today_runs: i % 3,
    public_bio: 'AI 虚构角色，关注具体讨论与练习。',
    pending_topic: '',
    month_spent_fen: 12,
    successful_runs: 1,
    active_sessions: 2,
    last_status: i % 4 === 0 ? null : i % 3 === 0 ? 'skipped' : 'published',
    last_active_at: i % 4 === 0 ? null : 1791532800000,
    next_run_at: 1791565200000,
  })),
  runs: [
    {
      id: '1',
      agent_id: '900002',
      name: '林予安',
      status: 'published',
      detail: '',
      charged_fen: 1,
      input_tokens: 501,
      output_tokens: 201,
      post_id: '987654',
      created_at: 1791532800000,
    },
  ],
  audit: [{ action: 'seed_100', agent_id: null, created_at: 1791532800000 }],
};
let failedSave = true,
  loginCount = 0;
let queuedTopic = '',
  queueBlocked = true;
let returnedOperator = false;
await page.route('**/api/v2/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  const method = route.request().method();
  const body = method === 'GET' ? null : route.request().postDataJSON();
  const send = (value) => route.fulfill({ json: { data: value } });
  if (path.endsWith('/social/preferences'))
    return send({ tags: [], revision: 1 });
  if (path.endsWith('/console/session'))
    return send({
      agent_id: loginCount && !returnedOperator ? '900002' : '1',
      agent_name: loginCount && !returnedOperator ? '林予安' : '运营管理员',
      short_id: 'ADMIN',
      owner_uid: loginCount && !returnedOperator ? '11111' : '10001',
      owner_bound: true,
      onboarding: { state: 'completed', current_step: 5, revision: 1 },
    });
  if (path.endsWith('/managed') && method === 'GET') return send(data);
  if (path.endsWith('/managed/access'))
    return send({
      allowed: true,
      delegated: loginCount > 0 && !returnedOperator,
      sponsor_number: '10001',
    });
  if (path.endsWith('/managed/return')) {
    returnedOperator = true;
    return send({ returned: true });
  }
  if (path.endsWith('/revoke')) {
    data.members = data.members.map((m) =>
      m.id === path.split('/').at(-2) ? { ...m, active_sessions: 0 } : m,
    );
    return send({ revoked: 2 });
  }
  if (path.endsWith('/run')) {
    if (queueBlocked) {
      queueBlocked = false;
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'MANAGED_ACTIVITY_BLOCKED',
            message: '已达到今日尝试上限，可修改上限或明日再安排',
          },
        },
      });
    }
    queuedTopic = body.topic;
    return send({ queued: true });
  }
  if (path.endsWith('/managed/pause')) {
    data.campaign.enabled = false;
    data.campaign.revision++;
    return send({ paused: true });
  }
  if (path.endsWith('/managed/campaign')) {
    data.campaign = { ...body, revision: body.revision + 1 };
    return send({ saved: true });
  }
  if (path.endsWith('/managed/batch')) {
    data.members = data.members.map((m) =>
      body.ids.includes(m.id)
        ? { ...m, enabled: body.enabled, revision: m.revision + 1 }
        : m,
    );
    return send({ updated: body.ids.length });
  }
  if (/\/managed\/members\/\d+$/.test(path)) {
    if (failedSave) {
      failedSave = false;
      return route.fulfill({
        status: 503,
        json: {
          error: { code: 'UNAVAILABLE', message: '测试：保存暂时失败，请重试' },
        },
      });
    }
    data.members = data.members.map((m) =>
      m.id === path.split('/').at(-1)
        ? { ...m, ...body, revision: m.revision + 1 }
        : m,
    );
    return send({ saved: true });
  }
  if (path.endsWith('/login')) {
    loginCount++;
    return send({ managed: true });
  }
  return send({ items: [], accounts: [] });
});
try {
  await page.goto('http://127.0.0.1:4325/dashboard/managed');
  await page.getByRole('heading', { name: '社区角色管理' }).waitFor();
  await page.getByRole('button', { name: '编辑林知远', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 100);
  await page
    .getByRole('combobox', { name: '筛选场景' })
    .selectOption('校园交友');
  assert.equal(await page.locator('tbody tr').count(), 10);
  await page.getByRole('button', { name: '编辑林知远', exact: true }).click();
  await page.getByLabel('公开昵称', { exact: true }).fill('林知远（更新）');
  await page
    .getByLabel('公开简介', { exact: true })
    .fill('AI Agent，专注平等沟通与阅读练习。');
  await page.getByLabel('启用此角色的自动活动').check();
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page.getByLabel('公开昵称', { exact: true }).inputValue(),
    '林知远（更新）',
  );
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByText('角色资料已保存', { exact: true }).waitFor();
  assert.equal(
    data.members[0].public_bio,
    'AI Agent，专注平等沟通与阅读练习。',
  );
  await page
    .getByRole('button', { name: '编辑林知远（更新）', exact: true })
    .click();
  await page
    .getByLabel('下一次讨论主题', { exact: true })
    .fill('用一个假设场景讨论共同制定团队规则');
  await page.getByRole('button', { name: '安排一次活动', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: '已达到今日尝试上限，可修改上限或明日再安排' })
    .waitFor();
  assert.equal(
    await page.getByLabel('下一次讨论主题', { exact: true }).inputValue(),
    '用一个假设场景讨论共同制定团队规则',
  );
  await page.getByRole('button', { name: '安排一次活动', exact: true }).click();
  await page
    .getByText('已安排活动；仍遵守时段、预算与每日上限。', { exact: true })
    .waitFor();
  assert.equal(queuedTopic, '用一个假设场景讨论共同制定团队规则');
  await page
    .getByRole('button', { name: '撤销此角色的登录', exact: true })
    .click();
  await page.getByRole('button', { name: '确认撤销登录', exact: true }).click();
  await page.getByText('该角色的管理登录已撤销', { exact: true }).waitFor();
  assert.equal(data.members[0].active_sessions, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '.impeccable/review/desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '.impeccable/review/mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择当前结果' }).check();
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page
    .getByText('所选角色已启用；活动仍遵守预算和调度设置。', { exact: true })
    .waitFor();
  assert.equal(
    data.members.filter((m) => m.scenario === '校园交友' && m.enabled).length,
    10,
  );
  await page.getByRole('button', { name: '预算与调度', exact: true }).click();
  await page.getByLabel('每月预算（元）', { exact: true }).fill('200');
  await page
    .getByRole('button', { name: '保存预算与调度', exact: true })
    .click();
  await page.getByText('预算与调度设置已保存', { exact: true }).waitFor();
  assert.equal(data.campaign.monthly_budget_fen, 20000);
  await page.getByRole('button', { name: '全部暂停', exact: true }).click();
  await page
    .getByText('全部自动活动已暂停；已发出的模型请求仍可能计费。', {
      exact: true,
    })
    .waitFor();
  assert.equal(data.campaign.enabled, false);
  await page.getByRole('button', { name: '活动回执', exact: true }).click();
  await page.getByRole('heading', { name: '真实执行回执' }).waitFor();
  await page.getByRole('button', { name: '操作审计', exact: true }).click();
  await page.getByText('初始化角色库', { exact: true }).waitFor();
  await page.getByRole('button', { name: '角色管理', exact: true }).click();
  await page
    .getByRole('button', { name: '进入林予安账号', exact: true })
    .click();
  await page.waitForURL('**/dashboard');
  assert.equal(loginCount, 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('heading', { name: '托管角色控制', exact: true })
    .waitFor();
  await page
    .getByLabel('让这个角色讨论什么？', { exact: true })
    .fill('一个新的团队协作讨论');
  await page.getByRole('button', { name: '安排模型发帖', exact: true }).click();
  await page
    .getByText('讨论已排队，请在活动回执查看结果。', { exact: true })
    .waitFor();
  assert.equal(queuedTopic, '一个新的团队协作讨论');
  await page.screenshot({ path: '.impeccable/review/managed-role.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: '移动端导航' })
    .getByRole('button', { name: 'Agent', exact: true })
    .click();
  await page
    .getByRole('heading', { name: '托管角色控制', exact: true })
    .waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: '.impeccable/review/managed-role-mobile.png' });
  const topicBox = await page
    .getByLabel('让这个角色讨论什么？', { exact: true })
    .boundingBox();
  assert(
    topicBox && topicBox.x >= 0 && topicBox.x + topicBox.width <= 390,
    'mobile role form must fit the visible panel',
  );
  await page
    .locator('.sw-agent-rail')
    .getByRole('button', { name: '关闭个人 Agent', exact: true })
    .click();
  await page.getByRole('button', { name: '返回运营账号', exact: true }).click();
  await page.waitForURL('**/dashboard/managed');
  await page
    .getByRole('heading', { name: '社区角色管理', exact: true })
    .waitFor();
  assert.equal(returnedOperator, true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 100-row roster, filtering, edit failure recovery, batch activation, budget, pause, receipts, audit, login and mobile overflow. Synthetic fixtures only.',
  );
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Page:', await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await server.close();
}
