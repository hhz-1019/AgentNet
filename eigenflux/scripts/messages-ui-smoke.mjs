import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  configFile: 'eigenflux/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch(
  process.env.AGENTNET_CHROMIUM_PATH
    ? { executablePath: process.env.AGENTNET_CHROMIUM_PATH }
    : {},
);
try {
  for (const empty of [null, []]) {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const longName =
      '知遥与它陪伴的生活方式研究者 · ElsewhereCreativeResearchCompanion'.repeat(
        3,
      );
    const errors = [];
    const sends = [];
    const groupSends = [];
    let sent = false;
    let incoming = false;
    let read = false;
    let failNext = false;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = { items: empty, next_cursor: '' };
      if (path.endsWith('/session'))
        data = {
          agent_id: '101',
          agent_name: '本地验收账号',
          owner_uid: '10001',
          owner_bound: true,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        };
      if (path.endsWith('/portrait'))
        data = {
          fields: { name: '本地验收账号' },
          visible: ['name'],
          memories: [],
          revision: 1,
        };
      if (path.endsWith('/accounts')) data = { accounts: [] };
      if (path.endsWith('/access')) data = { allowed: false };
      if (path.endsWith('/unread')) data = { unread: false };
      if (path.endsWith('/avatars')) data = { avatars: {}, previews: {} };
      if (path.endsWith('/card'))
        data = { card: { agent_id: '202', agent_name: longName } };
      if (path.endsWith('/pm/conversations'))
        data = {
          conversations: sent
            ? [{ conv_id: '900', peer_agent_id: '202', updated_at: 1 }]
            : empty,
          agent_contexts: {
            202: { identity_assertion: { display_name: longName } },
          },
          next_cursor: '',
        };
      if (path.endsWith('/pm/send')) {
        sends.push(route.request().postDataJSON());
        if (failNext) {
          failNext = false;
          return route.fulfill({
            status: 503,
            json: { error: { message: '本地模拟失败，请重试。' } },
          });
        }
        sent = true;
        data = { conv_id: '900' };
      }
      if (path.endsWith('/conversations/900/messages'))
        data = {
          messages: incoming
            ? [
                {
                  msg_id: '901',
                  sender_agent_id: '202',
                  receiver_agent_id: '101',
                  content: '收到你的来信，我们可以继续讨论记录方法。',
                  created_at: 1,
                  is_read: read,
                },
              ]
            : empty,
          next_cursor: '',
        };
      if (path.endsWith('/conversations/900/read')) {
        assert.equal(route.request().postDataJSON().through_message_id, '901');
        read = true;
        data = {};
      }
      if (path.endsWith('/groups/707/messages')) {
        if (route.request().method() === 'POST')
          groupSends.push(route.request().postDataJSON());
        data = { messages: empty, next_cursor: '' };
      }
      if (path.endsWith('/activity/stream'))
        return route.fulfill({
          contentType: 'text/event-stream',
          body: ': test\n\n',
        });
      return route.fulfill({ json: { data } });
    });
    await page.goto(origin + 'dashboard/messages?peer=202');
    await page.getByLabel('输入消息', { exact: true }).waitFor();
    const chatHeading = page.locator('.ew-live-heading');
    const privateHeaderHeight = (await chatHeading.boundingBox()).height;
    assert.equal(privateHeaderHeight, 96, 'chat header keeps a stable height');
    const name = chatHeading.locator('.agent-name-link');
    assert.equal(await name.getAttribute('title'), longName);
    assert.deepEqual(
      await name.evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.whiteSpace, s.textOverflow, s.fontSize];
      }),
      ['nowrap', 'ellipsis', '22px'],
    );
    const composer = await page
      .locator('.sn-message-composer')
      .evaluate((node) => {
        const input = node.querySelector('textarea');
        return {
          height: node.getBoundingClientRect().height,
          text: parseFloat(getComputedStyle(input).fontSize),
          placeholder: parseFloat(
            getComputedStyle(input, '::placeholder').fontSize,
          ),
        };
      });
    assert.ok(composer.text >= 16, 'message input remains readable');
    assert.equal(
      composer.placeholder,
      composer.text,
      'placeholder is not an oversized heading',
    );
    assert.ok(
      composer.height < 160,
      'composer leaves room for conversation history',
    );
    assert.equal(
      await page.getByText('页面暂时无法显示', { exact: true }).count(),
      0,
    );
    await page
      .getByLabel('输入消息', { exact: true })
      .fill('你好，这是本地首条私信验收。');
    const historyLoaded = page.waitForResponse((response) =>
      response.url().includes('/conversations/900/messages'),
    );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await historyLoaded;
    assert.equal(sends.length, 1);
    assert.equal(sends[0].receiver_id, '202');
    assert.equal(sends[0].conv_id, undefined);
    assert.ok(sends[0].idempotency_key);
    await page.getByRole('log', { name: '消息历史' }).waitFor();
    incoming = true;
    await page.reload();
    await page
      .getByText('收到你的来信，我们可以继续讨论记录方法。', { exact: true })
      .waitFor();
    assert.equal(read, true, 'incoming message receives a read receipt');
    failNext = true;
    await page
      .getByLabel('输入消息', { exact: true })
      .fill('继续讨论时，我们先保留哪些条件？');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('本地模拟失败，请重试。', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('输入消息', { exact: true }).inputValue(),
      '继续讨论时，我们先保留哪些条件？',
    );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('已发送。', { exact: true }).waitFor();
    assert.equal(sends.length, 3);
    assert.equal(sends[1].conv_id, '900');
    assert.equal(
      sends[1].idempotency_key,
      sends[2].idempotency_key,
      'retry reuses the operation key',
    );
    assert.deepEqual(
      errors,
      [],
      'empty conversation/group/history lists must not crash',
    );
    await mkdir('.agentnet-audit', { recursive: true });
    await page.screenshot({
      path: `.agentnet-audit/messages-empty-${empty === null ? 'null' : 'array'}.png`,
    });
    // Moment links may carry a group/conv destination. A stray peer parameter
    // must not redirect their composer into a private message.
    await page.goto(origin + 'dashboard/messages?group=707&peer=202');
    await page.getByRole('heading', { name: '群聊', exact: true }).waitFor();
    assert.equal(
      (await page.locator('.ew-live-heading').boundingBox()).height,
      privateHeaderHeight,
      'short/group names do not move the conversation body',
    );
    await page
      .getByLabel('输入消息', { exact: true })
      .fill('这是本地群聊入口验收。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('已发送。', { exact: true }).waitFor();
    assert.equal(groupSends.length, 1);
    assert.equal(sends.length, 3, 'group link must not send a private message');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'PASS: empty inbox, first send, existing thread, incoming message/read receipt, failed-send draft and idempotent retry',
  );
} finally {
  await browser.close();
  await server.close();
}
