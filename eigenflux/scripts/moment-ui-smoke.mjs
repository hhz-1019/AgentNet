import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch(
  process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {},
);
const errors = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: width < 600,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    let failure = true,
      empty = false,
      conflict = false;
    let received = false,
      inboxFailure = false,
      detailFailure = false;
    let seen = false;
    const message = {
      id: '91',
      kind: 'private_message',
      agent_id: '2',
      agent_name: '收件伙伴',
      title: '收到私信',
      body: '这是 Agent 实际收到的消息。',
      received_at: Date.now(),
      truncated: false,
      conversation_id: '71',
    };
    const item = {
      attention_id: '1',
      title: '核对这份草稿',
      body: '需要确认的内容。'.repeat(400),
      recommendation: '只保存草稿，不发送。',
      category: 'other_decision',
      status: 'open',
      response_status: 'none',
      item_revision: 1,
      created_at: Date.now(),
      expires_at: Date.now() + 3600000,
      actions: [
        {
          action_key: 'yes',
          kind: 'custom',
          flag: '保存草稿',
          appearance: 'primary',
        },
      ],
      related_agent: { agent_id: '1', name: '你的 Agent' },
      context_ref: {
        moment: {
          priority: 80,
          scopes: { yes: '仅保存草稿，不发送消息。' },
          executor_id: 'test_host',
        },
      },
    };
    const writes = [];
    await page.route('**/api/v2/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/console/moment/inbox'))
        return route.fulfill(
          inboxFailure
            ? { status: 503, json: { error: { message: '收件服务失败' } } }
            : {
                json: {
                  data: {
                    items: received
                      ? [{ ...message, viewed_at: seen ? Date.now() : null }]
                      : [],
                    next_cursor: '',
                    server_time: Date.now(),
                  },
                },
              },
        );
      if (path.includes('/console/moment/inbox/')) {
        if (detailFailure)
          return route.fulfill({
            status: 404,
            json: { error: { message: '这条交互已不可访问' } },
          });
        if (path.endsWith('/view')) {
          assert.equal(route.request().method(), 'POST');
          seen = true;
        }
        return route.fulfill({
          json: {
            data: { item: { ...message, viewed_at: seen ? Date.now() : null } },
          },
        });
      }
      if (path.endsWith('/console/moment'))
        return route.fulfill(
          failure
            ? { status: 503, json: { error: { message: '事项暂时不可用' } } }
            : {
                json: {
                  data: {
                    items: empty ? [] : [item],
                    next_cursor: '',
                    server_time: Date.now(),
                  },
                },
              },
        );
      if (path.includes('/avatars'))
        return route.fulfill({ json: { data: { avatars: {} } } });
      const body = route.request().postDataJSON();
      writes.push(body);
      assert.equal(body.expected_item_revision, item.item_revision);
      if (conflict) {
        conflict = false;
        item.item_revision++;
        return route.fulfill({
          status: 409,
          json: { error: { code: 'REVISION_CONFLICT', message: '事项已更新' } },
        });
      }
      item.item_revision++;
      if (path.endsWith('/respond')) {
        assert.equal(body.action_key, 'yes');
        assert.ok(body.idempotency_key);
        assert.equal(
          body.chat_executor,
          undefined,
          'ordinary browser cannot impersonate a chat executor',
        );
        item.status = 'pending';
        item.selected_action_key = body.action_key;
        item.command = {
          command_id: 'c1',
          status: 'pending',
          condition: body.condition,
          authorization_scope: item.context_ref.moment.scopes.yes,
          selected_at: Date.now(),
        };
        return route.fulfill({ json: { data: { command_id: 'c1' } } });
      }
      if (body.action === 'revoke') {
        item.status = 'dismissed';
        item.command.status = 'failed';
        item.command.revoked_at = Date.now();
      } else {
        item.status = body.action === 'reopen' ? 'open' : 'dismissed';
        item.selected_action_key = undefined;
      }
      return route.fulfill({ json: { data: {} } });
    });
    await page.goto(origin + 'preview-moment-live');
    await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '暂时没有加载出来' }).waitFor();
    failure = false;
    await page.getByRole('button', { name: '再试一次', exact: true }).click();
    const orb = page.getByRole('button', {
      name: '你的 Agent，1 项事项，查看事项',
    });
    await orb.waitFor();
    const field = await page.locator('.mb-field').boundingBox();
    assert.ok(field.height > 500 && field.width > 300);
    await orb.click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: '查看完整事项', exact: true })
      .first()
      .click();
    await dialog.getByRole('button', { name: '搁置', exact: true }).click();
    await dialog.getByText('暂时搁置', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '重新考虑' }).click();
    await dialog.getByRole('button', { name: '保存草稿' }).click();
    await dialog.getByLabel('附加条件').fill('不公开发布');
    conflict = true;
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await dialog
      .getByText(
        '事项或授权上下文已变化。补充条件已保留，请核对最新内容后重新选择。',
      )
      .waitFor();
    await dialog.getByRole('button', { name: '保存草稿' }).click();
    assert.equal(
      await dialog.getByLabel('附加条件').inputValue(),
      '不公开发布',
    );
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await dialog.getByText('确认已保存 · 等待执行', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '撤回决定' }).click();
    await dialog.getByText('已撤回', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '重新考虑' }).click();
    await dialog.getByRole('button', { name: '保存草稿' }).click();
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await dialog.getByText('确认已保存 · 等待执行', { exact: true }).waitFor();
    item.command.status = 'completed';
    item.command.result = { summary: '草稿已保存（隔离测试回执）。' };
    await page.evaluate(() =>
      window.dispatchEvent(new Event('agentnet:refresh')),
    );
    await dialog
      .getByText('Agent 已执行 · 收到结果', { exact: true })
      .waitFor();
    await dialog.getByText('草稿已保存（隔离测试回执）。').waitFor();
    assert.equal(
      await dialog.getByRole('button', { name: '撤回决定' }).count(),
      0,
    );
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 901);
    await mkdir('.agentnet-audit', { recursive: true });
    await page.screenshot({
      path: `.agentnet-audit/moment-result-${width}.png`,
    });
    await page.keyboard.press('Escape');
    empty = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event('agentnet:refresh')),
    );
    await page.getByRole('heading', { name: '此刻，还没有新的交互' }).waitFor();
    assert.equal(
      await page.locator('.mb-orb').count(),
      0,
      'empty production data is never replaced with demo items',
    );
    failure = true;
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/console/moment') && r.status() === 503,
      ),
      page.evaluate(() => window.dispatchEvent(new Event('agentnet:refresh'))),
    ]);
    await page.getByRole('heading', { name: '此刻，还没有新的交互' }).waitFor();
    assert.equal(
      await page.getByRole('alert').count(),
      0,
      'background failure preserves the last verified state',
    );
    assert.equal(
      await page.locator('.mb-orb').count(),
      0,
      'background failure must not invent items',
    );
    assert.deepEqual(
      writes.map((w) => w.action || w.action_key),
      ['defer', 'reopen', 'yes', 'yes', 'revoke', 'reopen', 'yes'],
    );
    failure = false;
    received = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event('agentnet:refresh')),
    );
    const receivedOrb = page.getByRole('button', {
      name: '收件伙伴，1 条交互，查看内容',
    });
    await receivedOrb.waitFor();
    assert.equal(
      await page.locator('.mb-empty').count(),
      0,
      'received messages remain visible with zero approvals',
    );
    await receivedOrb.click();
    await dialog.getByText('查看依据', { exact: true }).click();
    await dialog.locator('.mb-brief-sources button').first().click();
    await dialog
      .getByRole('region', { name: '交互正文' })
      .getByText(message.body, { exact: true })
      .waitFor();
    await dialog.getByText('已查看', { exact: true }).waitFor();
    assert.equal(
      await dialog.getByRole('button', { name: '确认', exact: true }).count(),
      0,
      'ordinary messages do not grant execution authority',
    );
    await page.screenshot({
      path: '.agentnet-audit/moment-inbox-' + width + '.png',
    });
    await page.keyboard.press('Escape');
    detailFailure = true;
    await receivedOrb.click();
    await dialog.getByText('查看依据', { exact: true }).click();
    await dialog.locator('.mb-brief-sources button').first().click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(
      await dialog
        .getByRole('region', { name: '交互正文' })
        .getByText(message.body, { exact: true })
        .count(),
      0,
      'revoked access cannot reuse list preview as full content',
    );
    detailFailure = false;
    await dialog.getByRole('button', { name: '重试读取' }).click();
    await dialog
      .getByRole('region', { name: '交互正文' })
      .getByText(message.body, { exact: true })
      .waitFor();
    await page.keyboard.press('Escape');
    inboxFailure = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event('agentnet:refresh')),
    );
    await page.getByRole('button', { name: '重新读取交互' }).waitFor();
    assert.equal(await page.locator('.mb-empty').count(), 0);
    inboxFailure = false;
    received = false;
    await page.getByRole('button', { name: '重新读取交互' }).click();
    await page.getByRole('heading', { name: '此刻，还没有新的交互' }).waitFor();
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Moment UI passed: error recovery, grouping, defer/reopen, version conflict, conditions, confirmation, revocation, receipt and empty state at desktop/mobile sizes.',
  );
} finally {
  await browser.close();
  await server.close();
}
