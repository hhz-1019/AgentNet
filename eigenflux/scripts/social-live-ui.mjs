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
const interestLabel = '关注标签（逗号分隔，最多 8 个）';
const openInterests = async (p) => {
  await p.getByRole('button', { name: /^(设置关注|调整关注)$/ }).click();
};
try {
  await page.goto(origin + '/dashboard');
  await openInterests(page);
  await page.getByLabel(interestLabel).fill('React, Agent 工程');
  await page.getByRole('button', { name: '保存关注', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await second.goto(origin + '/dashboard');
  await openInterests(second);
  assert.equal(
    await second.getByLabel(interestLabel).inputValue(),
    'React, Agent 工程',
  );
  await second.getByLabel(interestLabel).fill('产品设计');
  // A second browser must not silently overwrite a concurrent preference update.
  await openInterests(page);
  await page.getByLabel(interestLabel).fill('研究自动化');
  await page.getByRole('button', { name: '保存关注', exact: true }).click();
  await Promise.all([
    second.waitForResponse(
      (r) =>
        r.url().includes('/social/preferences') &&
        r.request().method() === 'GET',
    ),
    second.evaluate(() => window.dispatchEvent(new Event('agentnet:refresh'))),
  ]);
  await second.getByRole('button', { name: '保存关注', exact: true }).click();
  await second.getByRole('alert').waitFor();
  assert.equal(await second.getByLabel(interestLabel).inputValue(), '产品设计');
  await second.getByRole('button', { name: '保存关注', exact: true }).click();
  await second.getByRole('dialog').waitFor({ state: 'hidden' });
  const pref = await (
    await a.request.get(origin + '/api/v2/console/social/preferences')
  ).json();
  assert.deepEqual(pref.data.tags, ['产品设计']);
  // Organization UI uses real handlers and DB; session identities remain fixtures.
  await page.getByRole('link', { name: '团队与权限', exact: true }).click();
  await page.getByLabel('团队名称').fill('浏览器验证团队');
  await page.getByRole('button', { name: '创建团队', exact: true }).click();
  await page
    .getByRole('heading', { name: '浏览器验证团队', exact: true })
    .waitFor();
  await page.getByLabel('邀请 Agent ID').fill('2');
  await page
    .getByRole('button', { name: '邀请或调整角色', exact: true })
    .click();
  await page.getByText(/Peer Agent · 2 · 编辑 · 待接受/).waitFor();
  const peerPage = await peer.newPage();
  await peerPage.goto(origin + '/dashboard/organizations');
  await peerPage.getByRole('button', { name: '接受邀请', exact: true }).click();
  await peerPage.getByText('你的角色：编辑 · 已加入').waitFor();
  await page.getByRole('button', { name: '撤销成员', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '刷新权限', exact: true }).click();
  await page.getByText(/Peer Agent · 2 · 编辑 · 已加入/).waitFor();
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
  await page.getByRole('button', { name: '分享工作', exact: true }).click();
  await page
    .getByLabel('这次工作的来源')
    .fill('真实数据库接口与浏览器联调验证工作记录');
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
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
  const orphan = await (await a.request.post(origin + '/api/v2/console/social/media', {
    data: { data: png.toString('base64'), alt: '待清理截图', kind: 'image' },
  })).json();
  await page.getByRole('button', { name: '管理未使用的上传' }).click();
  await page.getByRole('button', { name: '删除这张图片' }).first().click();
  assert.equal((await a.request.get(origin + orphan.data.url)).status(), 404);
  await page.route('**/console/social/drafts', async (route) => {
    await route.fetch();
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.waitForFunction(() => !document.querySelector('.sw-editor')?.closest('fieldset')?.disabled);
  await page.getByLabel('正文', { exact: true }).fill(
    '这份记录来自真实接口联调，展示图片上传、草稿保存、服务端版本检查与授权流程。验证范围是本地浏览器和隔离数据库，尚未验证公网部署。丢失首次保存响应后补充了实际验证过程。',
  );
  await page.getByLabel('仅自己', { exact: true }).check();
  await page.getByRole('button', { name: '保存并预览', exact: true }).click();
  assert.equal((await (await a.request.get(origin + '/api/v2/console/social/posts?scope=drafts')).json()).data.items[0].revision, 2);
  await page.getByRole('button', { name: '返回修改', exact: true }).click();
  await page.getByLabel('摘要', { exact: true }).fill('保存响应丢失后再次读取服务端版本，并保留最终确认的公开范围。');
  await page.route('**/console/social/drafts/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存，尚未发布。').waitFor();
  await page.getByRole('button', { name: '保存并预览', exact: true }).click();
  assert.equal((await (await a.request.get(origin + '/api/v2/console/social/posts?scope=drafts')).json()).data.items[0].revision, 3);
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
    const created = await a.request.post(origin + '/api/v2/console/social/drafts', {
      data: {
        document: { ...posts.data.items[0].document, title: `草稿列表验证内容 ${i}`, identity: 'human', organization_id: '', project_name: '', media: [] },
        visibility: 'private',
      },
    });
    assert.equal(created.status(), 201);
  }
  await page.getByRole('link', { name: '待确认草稿' }).click();
  await page.locator('.sw-draft-card').nth(3).waitFor();
  assert.equal(await page.locator('.sw-draft-card').count(), 4);
  await page.locator('.sw-draft-card').last().click();
  await page.getByRole('dialog').getByLabel('标题', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
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
  assert.deepEqual(errors, []);
  console.log(
    'PASS live PostgreSQL browser flow: cross-device preferences, explicit conflict retry, upload, saved-revision review, private publication, organization consent/attribution and attachment ACL',
  );
} catch (error) {
  console.log(
    'Visible errors:',
    await page.locator('.sw-error').allTextContents(),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
