// Actual React UI with explicit authentication/API fixtures. PostgreSQL behavior
// is covered independently by TestTwinOwnerIsolationAndQuotas.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const dir = '.agentnet-audit/twin-ui';
await mkdir(dir, { recursive: true });
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 4324, host: '127.0.0.1', strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let registered = false,
      personalRevision = 1,
      policyRevision = 0;
    let state = { state: 'in_progress', current_step: 2, revision: 1 };
    let draft = {
      identity_card: {
        agent_name: 'Codex',
        agent_description: '协助工程与研究',
        human_description: '关注开放合作',
        working_languages: ['zh'],
        offering: [],
        seeking: [],
      },
      network_goal: '找到研究伙伴',
      intent_actions: [],
      security_boundary: {},
      twin_profile: {
        name: '预填昵称',
        basic_info: { role: '学生' },
        persona: { traits: {}, speaking_style: '简洁' },
        episodes: [],
        knowledge: [],
        relationships: [],
        current_goal: '找到研究伙伴',
      },
    };
    let profile = {
      name: '',
      basic_info: {},
      persona: { traits: {} },
      episodes: [],
      knowledge: [],
      relationships: [],
      current_goal: '',
    };
    let policy = {
      daily_posts: 3,
      daily_searches: 20,
      daily_feedback: 10,
      revision: 0,
    };
    await page.route('**/api/v2/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname.replace('/api/v2/', ''),
        method = request.method();
      const body = method === 'GET' ? undefined : request.postDataJSON();
      let data;
      if (path === 'console/session')
        data = {
          agent_id: '1',
          short_id: 'TEST',
          agent_name: 'Codex',
          owner_uid: registered ? '731482905' : '',
          owner_bound: registered,
          runtime_name: 'Codex',
          runtime_version: '',
          bio: '',
          email: '',
          email_bound: false,
          device_name: '',
          onboarding: state,
        };
      else if (path === 'auth/phone/challenges')
        data = { challenge_id: 'fixture-challenge', retry_after: 60 };
      else if (path === 'auth/uid/register') {
        assert.equal(body.agreement_version, '2026-10-09');
        assert.equal(body.uid, undefined);
        registered = true;
        data = { uid: '731482905', recovery_key: 'fixture-only-key' };
      } else if (path === 'agents/me/onboarding-draft')
        data = {
          onboarding: state,
          draft: { revision: state.revision, data: draft },
        };
      else if (path === 'console/onboarding-draft') {
        assert.equal(body.expected_revision, state.revision);
        state = { ...state, revision: state.revision + 1 };
        draft = body.draft;
        data = { revision: state.revision };
      } else if (path === 'agents/me/onboarding-draft/confirm') {
        assert.equal(body.expected_onboarding_revision, state.revision);
        state = {
          ...state,
          revision: state.revision + 1,
          current_step:
            body.step === state.current_step && body.step < 5
              ? body.step + 1
              : state.current_step,
          state: body.step === 5 ? 'completed' : 'in_progress',
        };
        data = state;
      } else if (path === 'console/twin') {
        if (method === 'PUT') {
          assert.equal(body.expected_revision, personalRevision);
          assert.equal(body.profile.persona.speaking_style, '简洁');
          profile = body.profile;
          data = { revision: ++personalRevision };
        } else
          data = {
            revision: personalRevision,
            profile,
            agreement_accepted: true,
          };
      } else if (path === 'console/twin/policy') {
        if (method === 'PUT') {
          assert.equal(body.revision, policyRevision);
          policy = { ...body, revision: ++policyRevision };
        }
        data = policy;
      } else
        data = {
          posts: [],
          items: [],
          tags: [],
          revision: 0,
          has_more: false,
          next_cursor: '',
          accounts: [],
          card: { offering: [], seeking: [] },
          organizations: [],
          commands: [],
          preferences: {},
          principals: [],
          official_pm_optout: false,
          control_context: {
            network_goal: { text: '找到研究伙伴' },
            security_boundary: {},
            intent_actions: [],
          },
        };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      });
    });
    await page.goto('http://127.0.0.1:4324/dashboard');
    // Start from an unowned handoff session; the first page is registration.
    // App's session fixture has an unclaimed owner but an incomplete identity.
    await page.getByLabel('手机号', { exact: false }).fill('13800138000');
    await page.getByRole('button', { name: '获取验证码' }).click();
    await page.getByText('验证码已发送，5 分钟内有效', {exact:true}).waitFor();
    await page.getByLabel('短信验证码', { exact: false }).fill('123456');
    await page
      .getByLabel('账号密码', { exact: false })
      .fill('fixture-password-123');
    await page.getByRole('button', { name: '创建账号并认领 Agent' }).click();
    assert.equal(registered, false);
    await page.getByRole('checkbox').check();
    await page.screenshot({
      path: `${dir}/registration-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '创建账号并认领 Agent' }).click();
    await page.getByRole('heading', { name: '确认你的基础资料' }).waitFor();
    assert.equal(
      await page.getByLabel('你的昵称', { exact: false }).inputValue(),
      '预填昵称',
    );
    assert.equal(
      await page.getByLabel('Agent 宿主', { exact: false }).isDisabled(),
      true,
    );
    await page.getByLabel('你的昵称', { exact: false }).fill('修改后的昵称');
    await page.screenshot({
      path: `${dir}/profile-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.getByRole('button', { name: '保存资料，设置活动' }).click();
    await page
      .getByRole('heading', { name: '管理 Agent 的每日活动' })
      .waitFor();
    assert.equal(profile.name, '修改后的昵称');
    await page.getByLabel('每日发帖上限', { exact: false }).fill('2');
    await page.getByLabel('每日搜索／发现上限', { exact: false }).fill('12');
    await page.getByLabel('每日反馈上限', { exact: false }).fill('6');
    await page.reload();
    await page
      .getByRole('heading', { name: '管理 Agent 的每日活动' })
      .waitFor();
    await page.getByLabel('每日发帖上限', { exact: false }).fill('2');
    await page.getByLabel('每日搜索／发现上限', { exact: false }).fill('12');
    await page.getByLabel('每日反馈上限', { exact: false }).fill('6');
    await page.screenshot({
      path: `${dir}/activity-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '完成设置，进入主页' }).click();
    await page.locator('.sw-workspace').waitFor();
    assert.equal(state.state, 'completed');
    assert.equal(policy.daily_posts, 2);
    assert.equal(policy.daily_searches, 12);
    assert.equal(policy.daily_feedback, 6);
    await page.goto('http://127.0.0.1:4324/dashboard/settings');
    await page
      .getByRole('heading', { name: '个人资料与 Agent 活动' })
      .waitFor();
    assert.equal(
      await page.getByLabel('你的昵称', { exact: false }).inputValue(),
      '修改后的昵称',
    );
    await page
      .getByLabel('你的昵称', { exact: false })
      .fill('设置中修改的昵称');
    await page
      .getByRole('button', { name: '保存个人资料', exact: true })
      .click();
    await page.getByLabel('每日发帖上限', { exact: false }).fill('1');
    await page
      .getByRole('button', { name: '保存活动额度', exact: true })
      .click();
    await page.reload();
    await page
      .getByRole('heading', { name: '个人资料与 Agent 活动' })
      .waitFor();
    await page.getByLabel('你的昵称', { exact: false }).waitFor();
    assert.equal(
      await page.getByLabel('你的昵称', { exact: false }).inputValue(),
      '设置中修改的昵称',
    );
    assert.equal(
      await page.getByLabel('每日发帖上限', { exact: false }).inputValue(),
      '1',
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'Twin registration/profile/activity/resume UI passed at 1440px and 390px. API/auth are explicit fixtures.',
  );
} finally {
  await browser.close();
  await server.close();
}
