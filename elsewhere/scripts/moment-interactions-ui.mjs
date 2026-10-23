import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  configFile: 'elsewhere/web/vite.config.mjs',
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch(
  process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {},
);
const errors = [];
try {
  for (const [width, theme] of [
    [1440, 'warm'],
    [1440, 'night'],
    [390, 'cool'],
    [320, 'warm'],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      hasTouch: width < 600,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (theme) => localStorage.setItem('elsewhere-appearance', theme),
      theme,
    );
    await page.goto(server.resolvedUrls.local[0] + 'preview#crossing');
    await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
    const orb = page.getByRole('button', {
      name: '林间的 Agent，4 条交互，1 项事项，查看内容',
      exact: true,
    });
    await orb.focus();
    await orb.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('heading', { name: '一起整理周末的散步路线？' })
      .waitFor();
    assert.equal(
      await dialog.locator('.mb-report-stats,.mb-report-timeline').count(),
      0,
    );
    await dialog
      .getByRole('region', { name: '需要你决定' })
      .getByText('林间分享了两家旧书店，想先交换各自收藏的地点。', {
        exact: true,
      })
      .waitFor();
    const chart = dialog.getByRole('region', { name: '往来分布' });
    await chart
      .getByRole('button', {
        name: '私信：我方 1 条，对方 1 条，查看最近记录',
        exact: true,
      })
      .waitFor();
    await chart
      .getByRole('button', {
        name: '评论：我方 1 条，对方 0 条，查看最近记录',
        exact: true,
      })
      .waitFor();
    await chart
      .getByRole('button', {
        name: '帖子：我方 0 条，对方 1 条，查看最近记录',
        exact: true,
      })
      .waitFor();
    assert.equal(
      await chart.locator('.mb-report-connection strong').innerText(),
      '4',
    );
    const alignment = await dialog.evaluate((el) => {
      const button = el
        .querySelector('.mb-report-bar button')
        .getBoundingClientRect();
      const label = el
        .querySelector('.mb-report-bar button span')
        .getBoundingClientRect();
      const report = el.querySelector('.mb-report').getBoundingClientRect();
      const document = el
        .querySelector('.mb-report-document')
        .getBoundingClientRect();
      return {
        labelOffset: label.x + label.width / 2 - button.x - button.width / 2,
        gutterDifference:
          document.x - report.x - (report.right - document.right),
        overflow: el.querySelector('.mb-report').scrollWidth > report.width + 1,
      };
    });
    assert.ok(Math.abs(alignment.labelOffset) < 1, JSON.stringify(alignment));
    assert.ok(
      Math.abs(alignment.gutterDifference) < 1,
      JSON.stringify(alignment),
    );
    assert.equal(alignment.overflow, false);
    assert.ok(
      await dialog
        .locator('.mb-report-focus h3')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 22),
    );
    await page.screenshot({
      path: `.agentnet-audit/moment-report-${width}-${theme}.png`,
    });
    const bounds = async (locator) =>
      locator.evaluateAll((els) =>
        els.map((el) => {
          const { x, y, width, height } = el.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
    const navButtons = dialog.locator('.mb-report-bar button');
    const initialBounds = await bounds(navButtons);
    const initialDialog = await dialog.boundingBox();
    await dialog.getByRole('button', { name: '先搁置', exact: true }).click();
    await dialog.getByRole('region', { name: '已搁置', exact: true }).waitFor();
    assert.equal(
      await dialog
        .getByRole('region', { name: '需要你决定', exact: true })
        .count(),
      0,
    );
    await dialog.getByRole('button', { name: '重新考虑', exact: true }).click();
    await dialog
      .getByRole('region', { name: '需要你决定', exact: true })
      .waitFor();
    await dialog.getByRole('button', { name: '继续了解', exact: true }).click();
    await dialog.getByRole('button', { name: '确认', exact: true }).waitFor();
    assert.deepEqual(await bounds(navButtons), initialBounds);
    assert.deepEqual(await dialog.boundingBox(), initialDialog);
    await dialog.getByRole('button', { name: '交互报告', exact: true }).click();
    await dialog.getByText('查看依据', { exact: true }).click();
    await dialog
      .getByRole('button', {
        name: '查看评论：把周末留一点给无目的的散步',
        exact: true,
      })
      .click();
    await dialog
      .getByRole('region', { name: '交互正文' })
      .getByText('喜欢这种没有明确目的地的散步。那家旧书店在哪里？', {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(await bounds(navButtons), initialBounds);
    await dialog.getByRole('button', { name: '查看帖子', exact: true }).click();
    await page.locator('.ew-note-detail').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('post'), '106');
    await page.keyboard.press('Escape');
    await page.goto(server.resolvedUrls.local[0] + 'preview#settings');
    const activity = page.getByRole('link', { name: '活动记录', exact: true });
    await activity.waitFor();
    const geometry = await activity.evaluate((el) => {
      const text = el.querySelector('strong').getBoundingClientRect(),
        arrow = el.querySelector('svg:last-child').getBoundingClientRect();
      return {
        gap: arrow.x - text.right,
        size: arrow.width,
        bg: getComputedStyle(el).backgroundColor,
      };
    });
    assert.ok(
      geometry.gap >= 8 && geometry.gap <= 24,
      JSON.stringify(geometry),
    );
    assert.ok(geometry.size >= 21);
    assert.notEqual(geometry.bg, 'rgba(0, 0, 0, 0)');
    await page.screenshot({
      path: `.agentnet-audit/content-grouping-${width}-${theme}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    for (const [route, selector] of [
      ['explore', '.sn-tabs button'],
      ['messages', '.sn-message-filters button'],
      ['messages', '.sw-message-sections a'],
      ['me', '.sn-tabs a'],
    ]) {
      await page.goto(server.resolvedUrls.local[0] + 'preview#' + route);
      const controls = page.locator(selector);
      await controls.first().waitFor();
      // Compare selection states after the requested serif font has settled.
      await page.evaluate(() => document.fonts.ready);
      const initial = await bounds(controls);
      for (let i = 0; i < initial.length; i++) {
        await controls.nth(i).click();
        const current = await bounds(controls);
        assert.equal(current.length, initial.length);
        for (let j = 0; j < current.length; j++)
          for (const key of ['x', 'y', 'width', 'height'])
            assert.ok(
              Math.abs(current[j][key] - initial[j][key]) < 1,
              route + ' tabs shifted: ' + JSON.stringify({ initial, current }),
            );
      }
    }
    await page.goto(server.resolvedUrls.local[0] + 'preview/login');
    await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '发布', exact: true }).click();
    const loginTabs = page.locator('.auth-login-methods button');
    await loginTabs.first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const loginBefore = await bounds(loginTabs);
    for (const i of [1, 0]) {
      await loginTabs.nth(i).click();
      const after = await bounds(loginTabs);
      for (let j = 0; j < after.length; j++)
        for (const key of ['x', 'y', 'width', 'height'])
          assert.ok(
            Math.abs(after[j][key] - loginBefore[j][key]) < 1,
            'login tabs shifted: ' + JSON.stringify({ loginBefore, after }),
          );
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: visual report, accurate channel counts/directions, centered navigation and symmetric gutters, inline defer/reopen/approval, post/comment sources, fixed tab geometry across Moment/discovery/messages/profile, three themes, desktop/mobile grouping and activity link alignment.',
  );
} finally {
  await browser.close();
  await server.close();
}
