import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const profiles = JSON.parse(
  await readFile(
    'core/api/consolev2/celebrity_catalog.json',
    'utf8',
  ),
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let rejectWrite = false,
    rejectRead = false;
  const mutations = [];
  const state = {
    source_key: profiles[0].key,
    agent_id: '900001',
    enabled: false,
    agent_enabled: false,
    checked_at: 0,
    status: 'pending',
    item_count: 0,
    open_jobs: 0,
    background: '',
    background_checked_at: 0,
    deleted_at: 0,
  };
  await page.route('**/api/v2/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const send = (data) => route.fulfill({ json: { data } });
    if (path.endsWith('/session'))
      return send({
        agent_id: '1',
        agent_name: '运营测试',
        short_id: 'TEST',
        owner_uid: 'operator',
        owner_bound: true,
        onboarding: { state: 'completed', current_step: 5, revision: 1 },
      });
    if (path.endsWith('/managed/access'))
      return send({ allowed: true, sponsor_number: '10001', delegated: false });
    if (path.endsWith('/managed'))
      return send({
        sponsor_number: '10001',
        campaign: null,
        spent_fen: 0,
        members: [],
        runs: [],
        audit: [],
        worker_configured: false,
        model_configured: false,
      });
    if (path.endsWith('/public-agents') && method === 'GET') {
      if (rejectRead)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'TEMP', message: 'read failure' } },
        });
      return send({
        profiles,
        boards: [],
        states: [state],
        worker_configured: false,
      });
    }
    if (path.includes('/public-agents/') && method !== 'GET') {
      mutations.push(route.request().postDataJSON());
      if (rejectWrite)
        return route.fulfill({
          status: 503,
          json: { error: { message: 'write failure' } },
        });
      const body = route.request().postDataJSON();
      if ('enabled' in body) state.enabled = body.enabled;
      if ('activity_enabled' in body)
        state.agent_enabled = body.activity_enabled;
      return send({ saved: true });
    }
    return send({});
  });
  await page.goto('http://127.0.0.1:4321/dashboard/managed');
  await page.getByRole('button', { name: '名人管理', exact: true }).click();
  await page.getByLabel('搜索', { exact: true }).fill('马斯克');
  await page.getByRole('button', { name: /马斯克/ }).click();
  assert(await page.getByText('尚未获取动态', { exact: true }).isVisible());
  await page.getByRole('button', { name: '开启同步', exact: true }).click();
  await page.getByRole('button', { name: '暂停同步', exact: true }).waitFor();
  assert.equal(state.enabled, true);
  await page.getByRole('button', { name: '开启交流', exact: true }).click();
  await page.getByRole('button', { name: '暂停交流', exact: true }).waitFor();
  assert.equal(state.agent_enabled, true);
  rejectWrite = true;
  await page.getByRole('button', { name: '暂停交流', exact: true }).click();
  await page.locator('.public-agents [role=alert]').waitFor();
  assert.equal(
    await page.getByLabel('搜索', { exact: true }).inputValue(),
    '马斯克',
  );
  assert.equal(state.agent_enabled, true);
  rejectRead = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event('agentnet:refresh')),
  );
  assert(
    await page.getByRole('heading', { name: '马斯克 · Agent' }).isVisible(),
  );
  assert.deepEqual(errors, []);
  assert.equal(mutations.length, 3);
  console.log(
    'Admin public agents: fifth tab, source/activity writes, write failure input retention, background read retention passed (synthetic API fixtures)',
  );
} finally {
  await browser.close();
}
