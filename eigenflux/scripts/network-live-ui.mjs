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
    strictPort: true,
    proxy: { '^/api/': { target: process.env.AGENTNET_SOCIAL_BROWSER_CORE } },
  },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const origin = 'http://127.0.0.1:4323';
try {
  await page.goto(origin + '/dashboard');
  await page.getByRole('heading', { name: '有些事，等你决定。' }).waitFor();
  assert.equal(await page.locator('.graph-node').count(), 3);
  assert.equal(await page.getByText('陌生人', { exact: true }).count(), 0);
  await page
    .getByRole('button', { name: '请求方，1 件待决定，0 条未读', exact: true })
    .click();
  await page.getByRole('button', { name: '同意联系', exact: true }).click();
  await page.getByText('已建立联系', { exact: true }).first().waitFor();
  await page.reload();
  await page
    .getByRole('button', { name: '请求方，0 件待决定，0 条未读', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: '已遇见，0 件待决定，2 条未读', exact: true })
    .click();
  await page.getByRole('button', { name: '收下', exact: true }).click();
  await page
    .getByRole('button', { name: '已遇见，0 件待决定，1 条未读', exact: true })
    .waitFor();
  await page.getByRole('link', { name: '我的 Agent', exact: true }).click();
  await page.getByLabel('昵称', { exact: true }).fill('真实保存的 Agent');
  await page.locator('.memory-section summary').click();
  await page.getByRole('button', { name: '添加记忆', exact: true }).click();
  await page
    .getByLabel('记忆 1', { exact: true })
    .fill('隔离数据库中的私密记忆');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '画像已保存' }).waitFor();
  await page.getByLabel('探索间隔', { exact: true }).selectOption('360');
  await page.getByLabel('报告间隔', { exact: true }).selectOption('72');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: '活动配置已保存' })
    .waitFor();
  await page.reload();
  await page.getByLabel('昵称', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('昵称', { exact: true }).inputValue(),
    '真实保存的 Agent',
  );
  assert.equal(
    await page.getByLabel('探索间隔', { exact: true }).inputValue(),
    '360',
  );
  assert.equal(
    await page.getByLabel('报告间隔', { exact: true }).inputValue(),
    '72',
  );
  const portrait = (
    await (
      await context.request.get(origin + '/api/v2/console/portrait')
    ).json()
  ).data;
  assert.equal(portrait.memories[0].content, '隔离数据库中的私密记忆');
  assert.equal(portrait.memories[0].showOnHome, false);
  // Another editor wins; this tab must keep its unsaved draft and show conflict.
  await page.getByLabel('昵称', { exact: true }).fill('这份输入应保留');
  const remote = await context.request.put(
    origin + '/api/v2/console/portrait',
    {
      data: {
        expected_revision: portrait.revision,
        fields: { name: '另一处的更新' },
      },
    },
  );
  assert.equal(remote.status(), 200);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(
    await page.getByLabel('昵称', { exact: true }).inputValue(),
    '这份输入应保留',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Network live browser passed: scoped nodes, request decision and read persistence, portrait/private memory, saved cadence, conflict preserves draft. Session identity is a fixture; handlers and PostgreSQL are real.',
  );
} catch (e) {
  console.log(await page.locator('body').innerText());
  throw e;
} finally {
  await browser.close();
  await server.close();
}
