import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  configFile: 'elsewhere/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const requests = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    let data = { items: [], next_cursor: '' };
    if (url.pathname.endsWith('/session'))
      data = {
        agent_id: '101',
        agent_name: 'Local test',
        owner_uid: '10001',
        owner_bound: true,
        onboarding: { state: 'completed', current_step: 5, revision: 1 },
      };
    if (url.pathname.endsWith('/portrait'))
      data = {
        fields: { name: 'Local test' },
        visible: ['name'],
        memories: [],
        revision: 1,
        next_cursor: url.search ? '' : '12',
      };
    if (url.pathname.endsWith('/accounts')) data = { accounts: [] };
    if (url.pathname.endsWith('/access')) data = { allowed: false };
    if (url.pathname.endsWith('/unread')) data = { unread: true };
    if (url.pathname.endsWith('/avatars')) data = { avatars: {}, previews: {} };
    if (url.pathname.endsWith('/activity/stream'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: ': test\n\n',
      });
    await route.fulfill({ json: { data } });
  });
  await page.goto(origin + 'dashboard');
  await page.locator('.sw-feed-grid').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('.ew-unread-dot'));
  const sessions = () => requests.filter((p) => p.endsWith('/session')).length;
  const portraits = () => requests.filter((p) => p.includes('/portrait'));
  assert.equal(sessions(), 1);
  assert.deepEqual(portraits(), ['/api/v2/console/portrait']);
  assert.ok(
    !requests.some(
      (p) => p.includes('/pm/conversations') || p.includes('/groups'),
    ),
  );
  const priorPosts = requests.filter((p) => p.includes('/social/posts')).length;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('agentnet:refresh', { detail: 'activity' }),
    ),
  );
  await page.waitForTimeout(300);
  assert.ok(
    requests.filter((p) => p.includes('/social/posts')).length > priorPosts,
  );
  assert.equal(
    sessions(),
    1,
    'activity refresh must not reload authentication',
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event('agentnet:refresh')),
  );
  await page.waitForTimeout(300);
  assert.equal(sessions(), 2, 'explicit refresh still reloads authentication');

  // Preserve the designed resource gate and animation; transport optimizations
  // must not introduce an early timeout or shorten the opening sequence.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/brand/wordmark.svg', async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto(origin + 'dashboard', { waitUntil: 'domcontentloaded' });
  await page.locator('.ew-brand-entry').waitFor();
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('.ew-brand-entry').count(), 1);
  release();
  await page
    .locator('.ew-brand-entry')
    .waitFor({ state: 'detached', timeout: 12000 });
  assert.equal(
    await page.locator('.ew-entry-content').evaluate((el) => el.inert),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: one unread summary request; no sidebar memory pagination; activity preserves session; explicit session refresh; original entry resource gate preserved.',
  );
} finally {
  await browser.close();
  await server.close();
}
