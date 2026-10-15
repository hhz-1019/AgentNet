import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const server = await createServer({
  configFile: resolve(root, 'eigenflux/web/vite.config.mjs'),
  server: {
    port: 0,
    host: '127.0.0.1',
    proxy: { '^/api/': { target: process.env.AGENTNET_SOCIAL_BROWSER_CORE } },
  },
});
await server.listen();
const browser = await chromium.launch(
  process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {},
);
const errors = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.resolvedUrls.local[0] + 'preview-moment-live');
    await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
    const orb = page.getByRole('button', {
      name: '收件联调伙伴，1 条消息，查看内容',
    });
    // Real database contains a crowded field: keyboard focus brings this avatar into view.
    await orb.focus();
    await orb.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog
      .getByText(
        '这是隔离数据库中 Agent 实际收到的私信，读取不会替 Agent 消耗未读消息。',
        { exact: true },
      )
      .waitFor();
    await dialog.getByText('已查看', { exact: true }).waitFor();
    assert.equal(
      await dialog.getByRole('button', { name: '确认', exact: true }).count(),
      0,
    );
    const receipt = await page.request.get(
      server.resolvedUrls.local[0] +
        'api/v2/console/moment/inbox/private_message/78101',
    );
    assert.equal(receipt.status(), 200);
    assert.ok((await receipt.json()).data.item.viewed_at > 0);
    await page.reload();
    await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
    await orb.focus();
    await orb.press('Enter');
    await dialog.getByText('已查看', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Moment live browser passed: real PostgreSQL → Go handlers → desktop/mobile → persistent owner receipt.',
  );
} finally {
  await browser.close();
  await server.close();
}
