// Actual React UI with explicit authentication/API fixtures. PostgreSQL behavior
// is covered independently by TestTwinOwnerIsolationAndQuotas.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { hostProfilePreview as richProfilePreview } from '../web/host-profile-preview.ts';
import { mkdir, readFile } from 'node:fs/promises';
const dir = '.agentnet-audit/twin-ui';
await mkdir(dir, { recursive: true });
const server = await createServer({
  configFile: 'elsewhere/web/vite.config.mjs',
  server: { port: 4324, host: '127.0.0.1', strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
  headless: true,
});
async function checkPreferenceLayout(page, width, context) {
  await page.getByText('活动与图片偏好', { exact: true }).click();
  for (const text of ['每轮综合反馈', '使用已授权的历史交流图片']) {
    const geometry = await page
      .getByRole('checkbox', { name: text, exact: true })
      .evaluate((input) => {
        const span = input.closest('label').querySelector('span');
        const box = input.getBoundingClientRect();
        const words = span.getBoundingClientRect();
        return {
          width: box.width,
          gap: words.left - box.right,
          textHeight: words.height,
          lineHeight: parseFloat(getComputedStyle(span).lineHeight),
          right: words.right,
        };
      });
    assert.equal(
      geometry.width,
      18,
      context + ': checkbox must not inherit full-width input styles',
    );
    assert.ok(
      geometry.gap >= 11 && geometry.gap <= 13,
      context + ': text stays beside checkbox',
    );
    assert.ok(
      geometry.textHeight <= geometry.lineHeight * 2.1,
      context + ': preference text must not become vertical',
    );
    assert.ok(
      geometry.right <= width,
      context + ': preference stays inside viewport',
    );
  }
  await page
    .getByRole('checkbox', { name: '使用已授权的历史交流图片', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/preferences-${context}-${width}.png` });
}
try {
  for (const width of [1440, 390]) {
    const ownerName = width === 390 ? '' : '预填昵称';
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let registered = false,
      ownerVerified = true,
      privateReads = 0,
      personalRevision = 0,
      policyRevision = 0;
    let state = { state: 'in_progress', current_step: 2, revision: 1 };
    const decision = {
      attention_id: '77',
      title: '周六聊书，要约时间吗？',
      body: '阿舟提议周六聊书，等待你决定。',
      surface: 'participation',
      status: 'open',
      created_at: 1700000000000,
      item_revision: 1,
      actions: [{ action_key: 'yes', flag: '同意周六' }],
    };
    let draft = {
      identity_card: {
        agent_name: '林间',
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
        portrait: {
          fields: {
            name: ownerName,
            bio: '',
            interests: '记忆中的研究兴趣',
            role: '',
            values: '重视可验证的结果',
            recent: '',
          },
          memories: [],
        },
        name: ownerName,
        basic_info: { role: '学生' },
        persona: { traits: {}, speaking_style: '简洁' },
        episodes: [],
        knowledge: [],
        relationships: [],
        current_goal: '找到研究伙伴',
      },
    };
    let profile = {
      fields: {
        name: '',
        bio: '',
        interests: '',
        role: '',
        values: '',
        recent: '',
      },
      visible: ['name', 'bio', 'interests'],
      memories: [],
    };
    let companion = {
      agent_name: '林间',
      owner_name: ownerName,
      connection_goal: '找到研究伙伴',
      start_hour: 8,
      end_hour: 24,
      report_every_round: true,
      history_images: true,
      name_locked: false,
      revision: 0,
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
      if (path === 'performance') return route.fulfill({ status: 204 });
      const body = method === 'GET' ? undefined : request.postDataJSON();
      if (path.startsWith('public/avatars/')) {
        await route.fulfill({
          contentType: 'image/png',
          body: await readFile(
            'elsewhere/web/public/preview-assets/linjian.png',
          ),
        });
        return;
      }
      let data;
      if (path === 'console/session')
        data = {
          agent_id: '1',
          short_id: 'TEST',
          agent_name: 'Codex',
          owner_uid: registered ? '731482905' : '',
          owner_bound: registered && ownerVerified,
          runtime_name: 'Codex',
          runtime_version: '',
          bio: '',
          email: '',
          email_bound: false,
          device_name: '',
          onboarding: state,
        };
      else if (path === 'console/handoffs/exchange') {
        assert.equal(body.ticket, 'efcn_' + 'a'.repeat(64));
        data = { requires_login: false, account_switch: false };
      } else if (path === 'auth/uid/login')
        data = {
          agents: [{ agent_id: '1', display_name: companion.agent_name }],
        };
      else if (path === 'auth/uid/claim') {
        ownerVerified = true;
        data = { uid: '731482905', agent_id: '1' };
      } else if (path === 'auth/phone/challenges')
        data = { challenge_id: 'fixture-challenge', retry_after: 60 };
      else if (path === 'auth/uid/register') {
        assert.equal(body.agreement_version, '2026-10-16');
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
      } else if (path === 'console/registration/progress') {
        assert.deepEqual(Object.keys(body), ['event']);
        data = { recorded: true };
      } else if (path === 'console/companion') {
        if (method === 'PUT') {
          assert.equal(body.revision, companion.revision);
          companion = {
            ...body,
            revision: companion.revision + 1,
            name_locked: true,
          };
          data = companion;
        } else
          data = {
            settings: companion,
            behavior_version: 'host-context-2026-10-16',
            check_interval_hours: 2,
            rename_needed: false,
          };
      } else if (path === 'console/portrait/avatar') {
        assert(body.data.length > 0);
        data = { avatar: '/api/v2/public/avatars/' + 'a'.repeat(32) };
      } else if (path === 'console/portrait/export') {
        assert.equal(method, 'GET');
        assert.equal(ownerVerified, true);
        data = {
          schema: 'elsewhere.legacy-profile.v1',
          portrait_memories: [{ id: 'legacy-1', content: '旧资料仍保留' }],
        };
      } else if (path === 'console/portrait') {
        privateReads++;
        if (method === 'PUT') {
          assert.equal(body.expected_revision, personalRevision);
          profile.fields = { ...profile.fields, ...body.fields };
          profile.visible = body.visible;
          assert.equal(body.deletes, undefined);
          assert.equal(body.upserts, undefined);
          assert.equal(body.fields.connections, undefined);
          data = { revision: ++personalRevision };
        } else
          data = {
            ...profile,
            fields: {
              ...profile.fields,
              connections: companion.connection_goal,
            },
            revision: personalRevision,
            next_cursor: '',
            total: profile.memories.length,
          };
      } else if (path === 'console/portrait/confirm') {
        assert.equal(body.revision, personalRevision);
        assert.equal(body.agreed, true);
        state = { ...state, state: 'completed' };
        data = { completed: true };
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
      } else if (path === 'console/attention-items/77') {
        data = decision;
      } else if (path === 'console/attention-items/77/respond') {
        assert.equal(body.action_key, 'yes');
        decision.status = 'pending';
        data = { accepted: true };
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
    await page.goto(
      'http://127.0.0.1:4324/dashboard/register#connect=efcn_' + 'a'.repeat(64),
    );
    await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
    // Start from an unowned handoff session; the first page is registration.
    // App's session fixture has an unclaimed owner but an incomplete identity.
    await page.getByLabel('手机号', { exact: false }).fill('13800138000');
    await page.getByRole('button', { name: '获取验证码' }).click();
    await page
      .getByText('验证码已发送，5 分钟内有效', { exact: true })
      .waitFor();
    await page.getByLabel('短信验证码', { exact: false }).fill('123456');
    await page
      .getByLabel('账号密码', { exact: false })
      .fill('fixture-password-123');
    await page
      .getByLabel('确认密码', { exact: true })
      .fill('fixture-password-123');
    await page.getByRole('button', { name: '创建账号' }).click();
    assert.equal(registered, false);
    await page.getByRole('checkbox').check();
    await page.screenshot({
      path: `${dir}/registration-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '创建账号' }).click();
    await page
      .getByRole('heading', { name: '确认资料', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Agent 的名字', { exact: true }).inputValue(),
      '林间',
    );
    for (const [label, value] of Object.entries({
      自我介绍: '关注开放合作',
      兴趣与长期关注: '记忆中的研究兴趣',
      我能分享的: '',
      想认识的人: '找到研究伙伴',
    }))
      assert.equal(
        await page.getByLabel(label, { exact: true }).inputValue(),
        value,
      );
    assert.equal(await page.getByLabel('接入应用').count(), 0);
    assert.equal(
      await page.getByLabel('生活中的身份', { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByLabel('在意的事与观点', { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByText('恢复密钥', { exact: false }).count(), 0);
    await page.getByLabel('Agent 的名字', { exact: true }).fill('修改后的昵称');
    const editedBio = '这段资料正在由主人编辑，请保留。';
    await page.getByLabel('自我介绍', { exact: true }).fill(editedBio);
    // The owner completes the required field omitted by this legacy Agent draft.
    await page
      .getByLabel('我能分享的', { exact: true })
      .fill('可以交流研究方法');
    const preparedAvatar = '/api/v2/public/avatars/' + 'b'.repeat(32);
    draft.twin_profile.portrait.fields.avatar = preparedAvatar;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(
      (avatar) =>
        document.querySelector('img[alt="Agent 头像"]')?.getAttribute('src') ===
        avatar,
      preparedAvatar,
    );
    assert.equal(
      await page.getByLabel('自我介绍', { exact: true }).inputValue(),
      editedBio,
    );
    assert.equal(
      await page.getByLabel('Agent 的名字', { exact: true }).inputValue(),
      '修改后的昵称',
    );
    await page
      .getByLabel('上传 Agent 头像', { exact: true })
      .setInputFiles('elsewhere/web/public/preview-assets/linjian.png');
    await page
      .getByText('头像已准备，保存资料后生效。', { exact: true })
      .waitFor();
    // A later Agent draft cannot replace the avatar the owner has selected.
    draft.twin_profile.portrait.fields.avatar =
      '/api/v2/public/avatars/' + 'c'.repeat(32);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(
      await page
        .getByAltText('Agent 头像', { exact: true })
        .getAttribute('src'),
      '/api/v2/public/avatars/' + 'a'.repeat(32),
    );
    await checkPreferenceLayout(page, width, 'onboarding');
    await page.getByRole('checkbox', { name: /我同意/ }).check();
    await page.screenshot({
      path: `${dir}/profile-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .getByRole('button', { name: '确认资料，进入 elsewhere' })
      .click();
    await page.locator('.sw-workspace').waitFor();
    assert.equal(state.state, 'completed');
    assert.equal(companion.agent_name, '修改后的昵称');
    assert.equal(profile.fields.name, ownerName);
    assert.equal(
      profile.fields.avatar,
      '/api/v2/public/avatars/' + 'a'.repeat(32),
    );
    assert.equal(await page.locator('.ew-avatar-option').count(), 0);
    assert.equal(
      await page.getByLabel('Agent 的名字', { exact: true }).count(),
      0,
    ); // already navigated to network
    await page.goto('http://127.0.0.1:4324/dashboard/me');
    await page.getByRole('button', { name: '关于我', exact: true }).click();
    const about = page.locator('.ew-identity-more[aria-hidden="false"]');
    await about.getByText('记忆中的研究兴趣', { exact: true }).waitFor();
    await about.getByText('找到研究伙伴', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.getByLabel('Agent 的名字', { exact: true }).waitFor();
    await checkPreferenceLayout(page, width, 'profile');
    await page
      .getByLabel('Agent 的名字', { exact: true })
      .fill('设置中修改的昵称');
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await page.getByText('资料已保存。', { exact: true }).waitFor();
    await page.reload();
    await page.getByLabel('Agent 的名字', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Agent 的名字', { exact: true }).inputValue(),
      '设置中修改的昵称',
    );
    assert.equal(await page.getByText('记一件事', { exact: true }).count(), 0);
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出旧资料', exact: true }).click();
    const download = await downloadReady;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported.portrait_memories, [
      { id: 'legacy-1', content: '旧资料仍保留' },
    ]);
    await page.goto('http://127.0.0.1:4324/dashboard/security');
    await page.getByLabel('每日发帖上限', { exact: false }).fill('1');
    await page
      .getByRole('button', { name: '保存活动额度', exact: true })
      .click();
    await page.getByText('已保存', { exact: false }).first().waitFor();
    assert.equal(policy.daily_posts, 1);
    // A completed Agent and a runtime-only browser session are not owner login.
    ownerVerified = false;
    const readsBeforeLogin = privateReads;
    await page.goto('http://127.0.0.1:4324/dashboard/profile');
    await page
      .getByRole('heading', { name: '登录 elsewhere', exact: true })
      .waitFor();
    assert.equal(privateReads, readsBeforeLogin);
    assert.equal(await page.getByLabel('Agent 的名字').count(), 0);
    assert.equal(await page.getByText(/认领|UID|一次性链接/).count(), 0);
    await page.getByLabel('账号', { exact: true }).fill('731482905');
    await page
      .getByLabel('账号密码', { exact: true })
      .fill('fixture-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByLabel('Agent 的名字', { exact: true }).waitFor();
    assert.equal(ownerVerified, true);
    assert.equal(
      await page.getByLabel('Agent 的名字').inputValue(),
      '设置中修改的昵称',
    );
    ownerVerified = false;
    await page.goto('http://127.0.0.1:4324/dashboard/attention?item=77');
    await page
      .getByRole('heading', { name: '登录 elsewhere', exact: true })
      .waitFor();
    await page.getByLabel('账号', { exact: true }).fill('731482905');
    await page
      .getByLabel('账号密码', { exact: true })
      .fill('fixture-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page
      .getByRole('heading', { name: '周六聊书，要约时间吗？', exact: true })
      .waitFor();
    assert.equal(new URL(page.url()).searchParams.get('item'), '77');
    await page.getByRole('button', { name: '同意周六', exact: true }).click();
    await page.getByText('已决定，等待 Agent 执行', { exact: true }).waitFor();
    // Round-trip the minimal network profile through registration UI.
    ownerVerified = true;
    personalRevision = 0;
    state = { state: 'in_progress', current_step: 2, revision: 1 };
    profile = {
      fields: {
        name: '',
        bio: '',
        interests: '',
        role: '',
        values: '',
        recent: '',
        connections: '',
      },
      visible: ['name', 'bio', 'interests'],
      memories: [],
    };
    // Start a separate rich-profile fixture; do not carry the preceding
    // legacy-profile scenario's role into its biography.
    draft.twin_profile.basic_info = {};
    draft.twin_profile.portrait = {
      prefill_version: 'host-context-2026-10-16',
      fields: structuredClone(richProfilePreview.fields),
      memories: structuredClone(richProfilePreview.memories),
    };
    companion = {
      ...companion,
      agent_name: '知遥',
      connection_goal: richProfilePreview.fields.connections,
      revision: 0,
    };
    await page.goto('http://127.0.0.1:4324/dashboard');
    await page.getByLabel('Agent 的名字', { exact: true }).waitFor();
    for (const [label, key] of [
      ['自我介绍', 'bio'],
      ['兴趣与长期关注', 'interests'],
      ['我能分享的', 'offers'],
      ['想认识的人', 'connections'],
    ]) {
      assert.equal(
        await page.getByLabel(label, { exact: true }).inputValue(),
        richProfilePreview.fields[key],
      );
      assert.equal(
        await page.getByLabel(label, { exact: true }).getAttribute('maxlength'),
        String(
          { bio: 600, interests: 800, offers: 800, connections: 1000 }[key],
        ),
      );
    }
    // In this second registration the owner chooses an image before the Agent
    // finishes. A late draft must not replace that deliberate choice.
    await page
      .getByLabel('上传 Agent 头像', { exact: true })
      .setInputFiles('elsewhere/web/public/preview-assets/linjian.png');
    await page
      .getByText('头像已准备，保存资料后生效。', { exact: true })
      .waitFor();
    draft.twin_profile.portrait.fields.avatar =
      '/api/v2/public/avatars/' + 'd'.repeat(32);
    const lateRead = page.waitForResponse((response) =>
      response.url().includes('/agents/me/onboarding-draft'),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await lateRead;
    await page.waitForTimeout(100);
    assert.equal(
      await page
        .getByAltText('Agent 头像', { exact: true })
        .getAttribute('src'),
      '/api/v2/public/avatars/' + 'a'.repeat(32),
    );
    await page.getByRole('checkbox', { name: /我同意/ }).check();
    await page
      .getByRole('button', { name: '确认资料，进入 elsewhere' })
      .click();
    await page.getByRole('button', { name: '发布', exact: true }).waitFor();
    assert.equal(profile.memories.length, 0);
    assert.deepEqual(
      profile.memories.map((m) => ({ id: m.id, content: m.content })),
      richProfilePreview.memories.map((m) => ({
        id: m.id,
        content: m.content,
      })),
    );
    for (const key of ['bio', 'interests', 'offers'])
      assert.equal(profile.fields[key], richProfilePreview.fields[key]);
    assert.equal(
      companion.connection_goal,
      richProfilePreview.fields.connections,
    );
    await page.goto('http://127.0.0.1:4324/dashboard/profile');
    await page.getByLabel('想认识的人', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('我能分享的', { exact: true }).inputValue(),
      richProfilePreview.fields.offers,
    );
    assert.equal(
      await page.getByLabel('想认识的人', { exact: true }).inputValue(),
      richProfilePreview.fields.connections,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'Registration/portrait confirmation/profile persistence/activity settings UI passed at 1440px and 390px. API/auth are explicit fixtures.',
  );
} finally {
  await browser.close();
  await server.close();
}
