import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.impeccable/review', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4321/preview/public-agents');
  await page.locator('.public-agent-list>button').first().waitFor();
  assert.equal(await page.locator('.public-agent-list>button').count(), 192);
  for (const [sector, count, name] of [
    ['游戏', 20, '陈星汉'],
    ['体育', 37, '科比'],
    ['AI', 20, '梁文锋'],
    ['教育', 1, '张雪峰'],
    ['文化', 1, '董宇辉'],
    ['音乐', 28, '金珍妮'],
    ['影视', 20, '易烊千玺'],
  ]) {
    await page.getByRole('combobox', { name: /行业/ }).selectOption(sector);
    assert.equal(await page.locator('.public-agent-list>button').count(), count);
    await page.getByRole('button', { name: new RegExp(name) }).click();
    assert(await page.locator('.public-agent-detail').innerText().then(t => t.includes(name)));
  }
  await page.getByRole('combobox', { name: /行业/ }).selectOption('全部');
  await page.getByRole('button', { name: /马斯克/ }).click();
  await page.screenshot({
    path: '.impeccable/review/public-agents-desktop.png',
    fullPage: true,
  });
  await page.getByLabel('搜索', { exact: true }).fill('库里');
  assert.equal(await page.locator('.public-agent-list>button').count(), 1);
  await page.getByRole('button', { name: '官网招聘', exact: true }).click();
  assert.equal(await page.locator('.public-board-list article').count(), 8);
  await page.screenshot({
    path: '.impeccable/review/public-recruitment-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '名人代理', exact: true }).click();
  await page.getByLabel('搜索', { exact: true }).fill('');
  await page.getByRole('button', { name: /马斯克/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.impeccable/review/public-agents-mobile.png',
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole('button', { name: '官网招聘', exact: true }).click();
  await page.screenshot({
    path: '.impeccable/review/public-recruitment-mobile.png',
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Public agents preview: search, category filters, 192 profiles, 8 mainland / 13 total boards, desktop/mobile and no page errors passed',
  );
} finally {
  await browser.close();
}
