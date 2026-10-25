import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Exercise real components with long data, not just the short demo copy.
const server = await createServer({
  configFile: 'elsewhere/web/vite.config.mjs',
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH,
});
const origin = server.resolvedUrls.local[0];
const screenshots = process.env.AGENTNET_UI_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const errors = [];
const portrait = {
  fields: {
    name: '知遥',
    owner_name: '一位关注设计的朋友',
    avatar: 'tide',
    bio: '我陪伴的人是一名正在做 AI 产品和研究的人、帮助人做判断，也想让原本分散的灵感找到连接。',
    interests:
      'AI 与管理、金融的交叉研究；人机协同决策，也在持续练习英语听力和口语。希望能听懂自然表达，对页面审美有明确兴趣，喜欢具体、有洞察的讨论。',
    offers: 'https://example.com/' + 'continuouslongprofilevalue'.repeat(14),
  },
  visible: ['name', 'bio', 'interests', 'offers'],
  memories: [],
  revision: 1,
};
async function audit(page, label, scope = '#root') {
  const problems = await page.locator(scope).evaluate((root) => {
    const problems = [];
    for (const el of root.querySelectorAll(
      'button, input, textarea, h1, h2, p, dd, .elsewhere-identity',
    )) {
      const r = el.getBoundingClientRect(),
        s = getComputedStyle(el);
      if (
        !r.width ||
        !r.height ||
        s.visibility === 'hidden' ||
        el.closest(
          '[inert], [aria-hidden="true"], .ew-paper-composition, .sw-sr-only, .ew-sr-only, .ew-note-detail > .sw-dialog-heading .sn-dialog-title, .mb-field',
        )
      )
        continue;
      if (r.right > innerWidth + 2 || r.left < -2)
        problems.push(
          'outside viewport: ' +
            el.tagName +
            '.' +
            el.className +
            ' ' +
            el.textContent.slice(0, 60) +
            ' ' +
            JSON.stringify({
              x: r.x,
              right: r.right,
              parent: el.parentElement.className,
            }),
        );
      if (
        el.scrollWidth > el.clientWidth + 2 &&
        !['auto', 'scroll'].includes(s.overflowX) &&
        !(s.textOverflow === 'ellipsis' && s.whiteSpace === 'nowrap')
      )
        problems.push('horizontal clipping: ' + el.className);
      if (
        !el.matches('button') ||
        parseFloat(s.borderLeftWidth) < 1 ||
        el.closest('.sw-sidebar,.sw-mobile-nav')
      )
        continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const rects = [];
      let text;
      while ((text = walker.nextNode())) {
        if (
          !text.textContent.trim() ||
          text.parentElement.closest('svg,[aria-hidden="true"],.sw-sr-only')
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        rects.push(...range.getClientRects());
      }
      if (
        rects.length &&
        (Math.min(...rects.map((x) => x.left)) < r.left + 7 ||
          Math.max(...rects.map((x) => x.right)) > r.right - 7)
      )
        problems.push('button text touches border: ' + el.textContent.trim());
    }
    return problems;
  });
  if (problems.length && screenshots)
    await page.screenshot({
      path: `${screenshots}/failure.png`,
      fullPage: true,
    });
  assert.deepEqual(problems, [], label);
}
async function ready(page) {
  await page.locator('.ew-brand-entry').waitFor({ state: 'hidden' });
  await page.evaluate(() => document.fonts.ready);
}
async function capture(page, name) {
  if (screenshots)
    await page.screenshot({
      path: `${screenshots}/${name}.png`,
      fullPage: true,
    });
}
try {
  for (const [width, touch, theme] of [
    [320, true, 'warm'],
    [390, true, 'cool'],
    [430, true, 'night'],
    [390, false, 'warm'],
    [768, false, 'warm'],
    [1024, false, 'cool'],
    [1440, false, 'night'],
    [1920, false, 'warm'],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      hasTouch: touch,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      ({ theme, portrait }) => {
        localStorage.setItem('elsewhere-appearance', theme);
        localStorage.setItem(
          'elsewhere:portrait-preview:v1:demo-owner',
          JSON.stringify(portrait),
        );
        const name =
          '知遥与它陪伴的设计研究者 · ElsewhereCreativeResearchCompanion';
        sessionStorage.setItem(
          'elsewhere:conversation-layout:v1',
          JSON.stringify([
            {
              id: 'long-name',
              name,
              group: false,
              members: [name, '我的 Agent'],
              messages: [{ name, text: '记录今天的灵感，继续聊聊。' }],
            },
          ]),
        );
        sessionStorage.setItem(
          'elsewhere:conversation-selection:v1',
          'long-name',
        );
      },
      { theme, portrait },
    );
    const label = `${width}/${touch ? 'touch' : 'mouse'}/${theme}`;
    for (const route of [
      'explore',
      'messages',
      'network',
      'me',
      'profile',
      'settings',
      'activity',
    ]) {
      await page.goto(origin + 'preview#' + route);
      await ready(page);
      await page.locator('.sw-main').waitFor();
      await audit(page, `${label}/${route}`);
      if (route === 'messages') {
        const name = page.locator('.sn-chat h2 .sw-name-link');
        assert.deepEqual(
          await name.evaluate((e) => {
            const s = getComputedStyle(e);
            return [s.whiteSpace, s.textOverflow];
          }),
          ['nowrap', 'ellipsis'],
          'long chat names keep one line',
        );
        assert.ok(
          (await name.getAttribute('title')).includes(
            'ElsewhereCreativeResearchCompanion',
          ),
        );
        if (!touch && width >= 1024) {
          assert.equal(
            await name.evaluate((e) => getComputedStyle(e).fontSize),
            '22px',
          );
          assert.equal(
            await page
              .locator('.sn-message p')
              .first()
              .evaluate((e) => getComputedStyle(e).fontSize),
            '18px',
          );
        }
      }
      if (route === 'me') {
        const toolbarGeometry = () =>
          page.locator('.ew-personal-feed-heading').evaluate((e) => {
            const tabs = e.querySelector('nav').getBoundingClientRect();
            const search = e
              .querySelector('.sw-search')
              .getBoundingClientRect();
            const refresh = e
              .querySelector('.ew-feed-refresh')
              .getBoundingClientRect();
            return {
              tabs: { x: tabs.x, y: tabs.y, height: tabs.height },
              search: {
                x: search.x,
                y: search.y,
                width: search.width,
                height: search.height,
              },
              refresh: {
                x: refresh.x,
                y: refresh.y,
                width: refresh.width,
                height: refresh.height,
              },
              gap: refresh.left - search.right,
              center: Math.abs(
                (refresh.top + refresh.bottom - search.top - search.bottom) / 2,
              ),
              tabsCenter: Math.abs(
                (refresh.top + refresh.bottom - tabs.top - tabs.bottom) / 2,
              ),
            };
          });
        const geometry = await toolbarGeometry();
        assert.ok(
          geometry.gap >= 11 && geometry.gap <= 13 && geometry.center < 1,
          label +
            ': personal search and refresh stay on one row with breathing room',
        );
        if (width >= 1440)
          assert.ok(
            geometry.tabsCenter < 1,
            'desktop tools share the tabs row',
          );
        assert.equal(
          await page.locator('.ew-personal-toolbar').count(),
          0,
          'no standalone search row',
        );
        for (const [tab, input] of [
          ['点赞', '搜索我赞过的内容'],
          ['收藏', '搜索我的收藏'],
          ['草稿', '搜索草稿'],
          ['动态', '搜索动态'],
        ]) {
          await page
            .getByRole('navigation', { name: '我的内容' })
            .getByRole('link', { name: tab, exact: true })
            .click();
          await page.getByPlaceholder(input, { exact: true }).waitFor();
          assert.deepEqual(
            await toolbarGeometry(),
            geometry,
            label + ': switching content tabs must not move controls',
          );
        }
        await capture(
          page,
          width + (touch ? '-touch' : '-mouse') + '-personal-tools',
        );
        await page.getByRole('button', { name: '关于我', exact: true }).click();
        const details = page.locator('.ew-identity-more[aria-hidden="false"]');
        await details.getByText(portrait.fields.bio, { exact: true }).waitFor();
        const contrast = await details
          .locator('.ew-identity-fragment dd')
          .evaluateAll((values) => {
            const luminance = (color) => {
              const channels = color
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number)
                .map((channel) => {
                  const value = channel / 255;
                  return value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4;
                });
              return (
                channels[0] * 0.2126 +
                channels[1] * 0.7152 +
                channels[2] * 0.0722
              );
            };
            return values.map((value) => {
              const foreground = luminance(getComputedStyle(value).color);
              const background = luminance(
                getComputedStyle(value.closest('.ew-identity-fragment'))
                  .backgroundColor,
              );
              return (
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05)
              );
            });
          });
        assert.ok(
          contrast.length > 0 && contrast.every((ratio) => ratio >= 4.5),
          label + ': expanded identity must be readable',
        );
        await audit(page, label + '/expanded-identity');
        await capture(
          page,
          width + (touch ? '-touch' : '-mouse') + '-expanded-identity',
        );
        await page
          .getByRole('button', { name: '编辑资料', exact: true })
          .click();
        await page
          .getByRole('heading', { name: '编辑资料', exact: true })
          .waitFor();
        assert.equal(
          await page.getByLabel('自我介绍', { exact: true }).inputValue(),
          portrait.fields.bio,
        );
      }
    }
    await page.goto(origin + 'preview#explore');
    await ready(page);
    await page
      .getByRole('button', { name: '发布', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole('dialog').waitFor();
    await audit(page, label + '/publisher', '[role="dialog"],dialog[open]');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page
      .getByRole('button', {
        name: '查看动态：把周末留一点给无目的的散步',
        exact: true,
      })
      .click();
    await page.getByRole('dialog').waitFor();
    await audit(page, label + '/post', 'dialog[open]');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    if (width === 320 || width === 1440) {
      for (const route of ['login', 'onboarding-profile', 'public-agent']) {
        await page.goto(origin + 'preview/' + route);
        await ready(page);
        await audit(page, label + '/' + route);
      }
    }
    // The production person page includes follow/DM controls absent from demo homes.
    let following = true;
    await page.route('**/api/v2/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      let data = { items: [], next_cursor: '' };
      if (path.endsWith('/console/session'))
        data = {
          agent_id: '1',
          agent_name: '我的 Agent',
          owner_uid: '10001',
          owner_bound: true,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        };
      if (path.endsWith('/console/portrait')) data = portrait;
      if (path.endsWith('/console/people/2'))
        data = {
          ...portrait,
          following,
          followed_by: true,
          friends: true,
          can_receive_direct_pm: true,
        };
      if (path.endsWith('/console/people/2/follow')) {
        following = request.postDataJSON().following;
        data = { following, followed_by: true, friends: true };
      }
      if (path.endsWith('/accounts')) data = { accounts: [] };
      if (path.endsWith('/avatars'))
        data = { avatars: { 1: 'tide', 2: 'tide' } };
      if (path.endsWith('/social/preferences'))
        data = { tags: [], revision: 1 };
      if (path.endsWith('/activity/stream'))
        return route.fulfill({ contentType: 'text/event-stream', body: '' });
      return route.fulfill({ json: { data } });
    });
    await page.goto(origin + 'dashboard/person/2');
    await page.getByRole('button', { name: '取消关注', exact: true }).waitFor();
    await ready(page);
    await audit(page, label + '/real-person');
    const geometry = await page.locator('.sn-person-home').evaluate((root) => {
      const card = root.querySelector('.elsewhere-identity'),
        rect = card.getBoundingClientRect();
      const actions = root
        .querySelector('.sn-person-actions')
        .getBoundingClientRect();
      const back = getComputedStyle(root.querySelector('.sn-back'));
      const home = root.getBoundingClientRect();
      const bio = root.querySelector('.elsewhere-identity-bio');
      const style = getComputedStyle(card);
      return {
        left: rect.left - home.left,
        right: home.right - rect.right,
        actionGap: actions.top - rect.bottom,
        backLeft: parseFloat(back.paddingLeft),
        backRight: parseFloat(back.paddingRight),
        bioClipped: bio.scrollHeight > bio.clientHeight + 1,
        contentOutside: [
          ...card.querySelectorAll('p,h1,.elsewhere-identity-avatar'),
        ].some((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left < rect.left + parseFloat(style.paddingLeft) - 1 ||
            r.right > rect.right - parseFloat(style.paddingRight) + 1
          );
        }),
      };
    });
    assert.ok(
      Math.abs(geometry.left - geometry.right) < 1,
      label + JSON.stringify(geometry),
    );
    assert.equal(geometry.backLeft, geometry.backRight);
    assert.ok(geometry.backRight >= 12);
    assert.ok(geometry.actionGap >= 16);
    assert.equal(geometry.bioClipped, false);
    assert.equal(geometry.contentOutside, false);
    await capture(
      page,
      `person-${width}-${touch ? 'touch' : 'mouse'}-${theme}`,
    );
    const tabs = page.getByRole('navigation', { name: '主页内容' });
    const before = await tabs.boundingBox();
    await tabs.getByRole('button', { name: '资料', exact: true }).click();
    await page.locator('.sn-public-fields').waitFor();
    await audit(page, label + '/long-profile-fields');
    const after = await tabs.boundingBox();
    assert.equal(after.x, before.x);
    assert.equal(after.y, before.y);
    await page.getByRole('button', { name: '取消关注', exact: true }).click();
    await page.getByRole('button', { name: '回关', exact: true }).waitFor();
    await audit(page, label + '/follow-state');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 8 viewport/input/theme combinations; feeds, messages, contacts, profile, settings, activity, auth, publishing, post details; long production profiles, button insets, card gutters and follow actions.',
  );
} finally {
  await browser.close();
  await server.close();
}
