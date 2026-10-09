import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const server = await createServer({
  configFile: resolve(root, 'eigenflux/web/vite.config.mjs'),
  server: {
    port: 4323,
    host: '127.0.0.1',
    proxy: { '^/api/': { target: process.env.AGENTNET_SOCIAL_BROWSER_CORE } },
  },
});
await server.listen();
const browser = await chromium.launch({
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const origin = 'http://127.0.0.1:4323';
const a = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
const peer = await browser.newContext();
await peer.addCookies([{ name: 'social_viewer', value: '2', url: origin }]);
const page = await a.newPage(),
  second = await b.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
second.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(origin + '/dashboard');
  // The manual-interest editor was removed from the social flow. Preference
  // persistence/concurrency remains covered by the existing backend tests.
  await page.getByRole('link', { name: '我的', exact: true }).first().click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  // Organization UI uses real handlers and DB; session identities remain fixtures.
  // Legacy organization UI is no longer exposed in settings.
  await page.goto(origin + '/dashboard/organizations');
  await page.getByLabel('团队名称').fill('浏览器验证团队');
  await page.getByRole('button', { name: '创建团队', exact: true }).click();
  await page
    .getByRole('heading', { name: '浏览器验证团队', exact: true })
    .waitFor();
  await page.getByLabel('邀请 Agent ID').fill('2');
  await page
    .getByRole('button', { name: '邀请或调整角色', exact: true })
    .click();
  await page.getByText(/伙伴 Agent · 2 · 编辑 · 待接受/).waitFor();
  const peerPage = await peer.newPage();
  await peerPage.goto(origin + '/dashboard/organizations');
  await peerPage.getByRole('button', { name: '接受邀请', exact: true }).click();
  await peerPage.getByText('你的角色：编辑 · 已加入').waitFor();
  await page.getByRole('button', { name: '撤销成员', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '刷新权限', exact: true }).click();
  await page.getByText(/伙伴 Agent · 2 · 编辑 · 已加入/).waitFor();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/members/2') &&
        r.request().method() === 'PUT' &&
        r.status() === 200,
    ),
    page.getByRole('button', { name: '撤销成员', exact: true }).click(),
  ]);
  const peerOrganizations = await (
    await peer.request.get(origin + '/api/v2/console/social/organizations')
  ).json();
  assert.deepEqual(peerOrganizations.data.items, []);
  await page.getByRole('link', { name: '发现', exact: true }).first().click();
  const seededDraft = await (
    await a.request.post(origin + '/api/v2/console/social/drafts', {
      data: {
        visibility: 'private',
        idempotency_key: 'browser-draft',
        document: {
          title: '真实数据库接口与浏览器联调验证',
          summary: '真实数据库接口与浏览器联调验证工作记录',
          body: '这份记录来自真实接口联调，验证图片上传、草稿保存和帖子访问范围，尚未验证公网部署。',
          source: '真实数据库接口与浏览器联调验证工作记录',
          evidence: '隔离数据库与浏览器检查',
          kind: 'result',
          tags: ['产品设计'],
          media: [],
          identity: 'agent',
          project_name: '',
        },
      },
    })
  ).json();
  assert.ok(seededDraft.data.id);
  await page.goto(origin + '/dashboard/drafts');
  await page
    .locator('.sw-draft-card')
    .filter({ hasText: '真实数据库接口与浏览器联调验证' })
    .click();
  await page
    .getByLabel('标题', { exact: true })
    .fill('图片附件按私有帖子范围控制访问');
  await page
    .getByLabel('摘要', { exact: true })
    .fill('在浏览器上传真实图片，保存后检查跨账号访问权限。');
  await page
    .getByLabel('正文', { exact: true })
    .fill(
      '这份记录来自真实接口联调，展示图片上传、草稿保存、服务端版本检查与授权流程。验证范围是本地浏览器和隔离数据库，尚未验证公网部署。',
    );
  await page
    .getByLabel('证据 / 结果 / 待验证点')
    .fill('通过跨浏览器读写与图片权限检查；公网部署未验证。');
  await page.getByLabel('标签（用逗号分隔，最多 8 个）').fill('产品设计');
  await page.getByLabel('发布身份').selectOption('project');
  await page.getByLabel('团队空间').selectOption({ label: '浏览器验证团队' });
  assert.equal(
    await page.getByLabel('项目名称').inputValue(),
    '浏览器验证团队',
  );
  const png = Buffer.from(process.env.AGENTNET_SOCIAL_TEST_IMAGE, 'base64');
  await page
    .getByLabel('上传工作图片')
    .setInputFiles({ name: 'work.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('附件 1 链接').waitFor();
  const mediaURL = await page.getByLabel('附件 1 链接').inputValue();
  assert.match(mediaURL, /^\/api\/v2\/console\/social\/media\/[0-9]+$/);
  assert.equal((await peer.request.get(origin + mediaURL)).status(), 404);
  const orphan = await (
    await a.request.post(origin + '/api/v2/console/social/media', {
      data: { data: png.toString('base64'), alt: '待清理截图', kind: 'image' },
    })
  ).json();
  await page.getByRole('button', { name: '管理未使用的上传' }).click();
  await page.getByRole('button', { name: '删除这张图片' }).first().click();
  assert.equal((await a.request.get(origin + orphan.data.url)).status(), 404);
  await page.route(
    '**/console/social/drafts/*',
    async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存，尚未发布。').waitFor();
  await page
    .getByLabel('正文', { exact: true })
    .fill(
      '这份记录来自真实接口联调，展示图片上传、草稿保存、服务端版本检查与授权流程。验证范围是本地浏览器和隔离数据库，尚未验证公网部署。丢失首次保存响应后补充了实际验证过程。',
    );
  await page.getByLabel('仅自己', { exact: true }).check();
  await page.getByRole('button', { name: '保存并预览', exact: true }).click();
  await page
    .getByRole('heading', { name: '确认这份内容的发布', exact: true })
    .waitFor();
  assert.equal(
    (
      await (
        await a.request.get(
          origin + '/api/v2/console/social/posts?scope=drafts',
        )
      ).json()
    ).data.items[0].revision,
    3,
  );
  await page.getByRole('button', { name: '返回修改', exact: true }).click();
  await page
    .getByLabel('摘要', { exact: true })
    .fill('保存响应丢失后再次读取服务端版本，并保留最终确认的公开范围。');
  await page.route(
    '**/console/social/drafts/*',
    async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存，尚未发布。').waitFor();
  await page.getByRole('button', { name: '保存并预览', exact: true }).click();
  await page
    .getByRole('heading', { name: '确认这份内容的发布', exact: true })
    .waitFor();
  assert.equal(
    (
      await (
        await a.request.get(
          origin + '/api/v2/console/social/posts?scope=drafts',
        )
      ).json()
    ).data.items[0].revision,
    4,
  );
  // Button name follows the production wording; match without relying on a demo label.
  const actualPublish = page.locator('.sw-dialog-footer .sw-primary');
  await actualPublish.waitFor();
  assert.ok(await actualPublish.isDisabled());
  const original = await a.request.get(origin + mediaURL);
  assert.equal(original.status(), 200);
  assert.equal(original.headers()['cache-control'], 'private, no-store');
  await page
    .getByText(
      '我已预览当前版本，确认内容可分享，并授权按所选身份与范围发布。',
      { exact: true },
    )
    .click();
  await page
    .getByText('我有权使用「浏览器验证团队」的项目署名。', { exact: true })
    .click();
  await actualPublish.click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const posts = await (
    await a.request.get(origin + '/api/v2/console/social/posts?scope=mine')
  ).json();
  assert.equal(posts.data.items.length, 1);
  assert.equal(posts.data.items[0].visibility, 'private');
  assert.ok(posts.data.items[0].document.organization_id);
  assert.equal((await peer.request.get(origin + mediaURL)).status(), 404);
  for (let i = 0; i < 4; i++) {
    const created = await a.request.post(
      origin + '/api/v2/console/social/drafts',
      {
        data: {
          document: {
            ...posts.data.items[0].document,
            title: `草稿列表验证内容 ${i}`,
            identity: 'human',
            organization_id: '',
            project_name: '',
            media: [],
          },
          visibility: 'private',
        },
      },
    );
    assert.equal(created.status(), 201);
  }
  await page.getByRole('link', { name: '草稿', exact: true }).click();
  await page.locator('.sw-draft-card').nth(3).waitFor();
  assert.equal(await page.locator('.sw-draft-card').count(), 4);
  await page.locator('.sw-draft-card').last().click();
  await page.getByRole('dialog').getByLabel('标题', { exact: true }).waitFor();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.goto(origin + '/dashboard/mine');
  await page.reload();
  await page
    .getByRole('button', {
      name: '图片附件按私有帖子范围控制访问',
      exact: true,
    })
    .waitFor();
  const images = await page
    .locator('img')
    .evaluateAll((images) =>
      images
        .filter((i) => i.src.includes('/social/media/'))
        .map((i) => i.complete && i.naturalWidth > 0),
    );
  assert.ok(
    images.length && images.every(Boolean),
    'hosted images loaded after refresh',
  );
  await page.goto(origin + '/dashboard/profile');
  await page.getByLabel('昵称', { exact: false }).fill('浏览器真实画像');
  await page.getByLabel('生活中的身份', { exact: true }).fill('私密测试身份');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByText('资料已保存。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '记一件事', exact: true }).click();
  await page
    .getByLabel('记忆内容', { exact: true })
    .fill('真实数据库中的私密事件记忆');
  await page.getByRole('button', { name: '保存这条记忆', exact: true }).click();
  await page.getByText('记忆已保存。', { exact: true }).waitFor();
  const person = (
    await (await peer.request.get(origin + '/api/v2/console/people/1')).json()
  ).data;
  assert.equal(person.fields.role, undefined);
  assert.equal(person.memories.length, 0);
  await page.goto(origin + '/dashboard/messages');
  await page.getByRole('button', { name: '发起群聊' }).click();
  await page.getByLabel('群聊名称', { exact: true }).fill('数据库联调群');
  await page.getByRole('checkbox', { name: '伙伴 Agent' }).check();
  await page.getByRole('button', { name: '创建群聊', exact: true }).click();
  await page
    .getByRole('heading', { name: '数据库联调群', exact: true })
    .waitFor();
  await page
    .getByRole('textbox', { name: '输入消息' })
    .fill('本人发送的群消息');
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes('/messages') &&
        r.status() === 201,
    ),
    page.getByRole('button', { name: '发送', exact: true }).click(),
  ]);
  await page.getByText('本人发送的群消息', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /数据库联调群/ }).click();
  await page.getByText('本人发送的群消息', { exact: true }).waitFor();
  const groupsResponse = await (
    await peer.request.get(origin + '/api/v2/console/groups')
  ).json();
  const newGroupId = groupsResponse.data.items.find(
    (g) => g.name === '数据库联调群',
  ).group_id;
  const incoming = await peer.request.post(
    origin + '/api/v2/console/groups/' + newGroupId + '/messages',
    {
      data: {
        content: '另一位成员的新消息',
        idempotency_key: 'browser-incoming-group-message',
      },
    },
  );
  assert.equal(incoming.status(), 201);
  await page
    .getByText('另一位成员的新消息', { exact: true })
    .waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '发布', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: /正文|想分享/ })
    .fill('本人直接发布的普通动态');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '发布', exact: true })
    .click();
  await page
    .getByText('本人直接发布的普通动态', { exact: true })
    .first()
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS live PostgreSQL browser flow: personal settings navigation, upload, saved-revision review, private publication, organization consent/attribution and attachment ACL',
  );
} catch (error) {
  console.log('DOM:', await page.locator('body').innerText());
  console.log(
    'Visible errors:',
    await page.locator('.sw-error').allTextContents(),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
