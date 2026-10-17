import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH,
  headless: true,
});
await mkdir('.agentnet-audit/account-deletion', { recursive: true });
const errors = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    let state = 'not_started',
      deletes = 0,
      failPassword = true,
      loseResponse = false;
    await context.addInitScript(() =>
      sessionStorage.setItem('elsewhere:entry-seen:v1', 'yes'),
    );
    await page.route('**/api/v2/**', async (route) => {
      const path = new URL(route.request().url()).pathname.slice(
        '/api/v2/'.length,
      );
      const reply = (data) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ data }),
        });
      if (path === 'performance') return route.fulfill({ status: 204 });
      if (path === 'console/session')
        return reply({
          agent_id: '1',
          agent_name: '测试账号',
          owner_uid: '10001',
          owner_bound: true,
          email_bound: true,
          onboarding: { state: 'completed', revision: 1, current_step: 4 },
        });
      if (path === 'console/account/deletion-receipt')
        return reply({ receipt: 'fixture-receipt' });
      if (path === 'account-deletion/status') return reply({ status: state });
      if (path === 'console/account' && route.request().method() === 'DELETE') {
        deletes++;
        const body = route.request().postDataJSON();
        assert.equal(body.confirmation, '10001');
        assert.equal(body.receipt, 'fixture-receipt');
        if (failPassword)
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'DELETION_PASSWORD_INVALID',
                message: '当前密码不正确',
              },
            }),
          });
        state = 'pending';
        if (loseResponse) return route.abort('failed');
        return reply({ status: state, receipt: 'fixture-receipt' });
      }
      if (path === 'console/accounts') return reply({ accounts: [] });
      if (path === 'console/managed/access') return reply({ allowed: false });
      if (path.includes('portrait'))
        return reply({
          fields: { name: '测试账号' },
          memories: [],
          revision: 1,
        });
      if (path.includes('unread')) return reply({ unread: false, count: 0 });
      return reply({ items: [], conversations: [], next_cursor: '' });
    });
    await page.goto(origin + '/dashboard/settings');
    const open = page.getByRole('button', { name: '注销账号', exact: true });
    await open.waitFor();
    const logout = page.getByRole('button', { name: '退出登录', exact: true });
    assert.equal(
      await logout.locator('..').evaluate((el) => el.getAttribute('class')),
      'account-settings-actions',
    );
    await open.click();
    const dialog = page.locator('dialog[open]');
    const submit = dialog.getByRole('button', {
      name: '永久注销',
      exact: true,
    });
    assert.ok(await submit.isDisabled());
    await dialog.getByLabel('当前密码').fill('fixture-password');
    await dialog.getByLabel('输入 账号 10001 确认').fill('10000');
    assert.ok(await submit.isDisabled());
    await dialog.getByLabel('输入 账号 10001 确认').fill('10001');
    for (const theme of ['warm', 'night']) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.equal(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.screenshot({
        path:
          '.agentnet-audit/account-deletion/' + width + '-' + theme + '.png',
        fullPage: true,
      });
    }
    await submit.click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(
      await dialog.getByLabel('当前密码').inputValue(),
      'fixture-password',
    );
    assert.equal(deletes, 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await open.click();
    assert.equal(await dialog.getByLabel('当前密码').inputValue(), '');
    await dialog.getByLabel('当前密码').fill('fixture-password');
    await dialog.getByLabel('输入 账号 10001 确认').fill('10001');
    failPassword = false;
    loseResponse = true;
    await submit.click();
    await page
      .getByRole('heading', { name: '正在注销账号', exact: true })
      .waitFor();
    assert.equal(deletes, 2, 'lost response must not replay DELETE');
    await page.reload();
    await page
      .getByRole('heading', { name: '正在注销账号', exact: true })
      .waitFor();
    state = 'completed';
    await page
      .getByRole('heading', { name: '账号已注销', exact: true })
      .waitFor({ timeout: 10000 });
    assert.equal(deletes, 2);
    await page
      .getByRole('button', { name: '返回登录 / 注册', exact: true })
      .click();
    await page.waitForURL('**/dashboard');
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem('elsewhere:account-deletion:receipt'),
      ),
      null,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Account deletion UI: settings placement, confirmation, password failure, Escape, lost response, reload, completion; desktop/mobile and warm/night passed.',
  );
} finally {
  await browser.close();
  await server.close();
}
