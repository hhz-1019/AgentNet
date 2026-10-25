import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  configFile: 'elsewhere/web/vite.config.mjs',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const origin = server.resolvedUrls.local[0];
const output = process.env.AGENTNET_UI_SCREENSHOT_DIR;
async function capture(name) {
  if (!output) return;
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}
const style = (selector, property) =>
  page
    .locator(selector)
    .first()
    .evaluate((e, p) => getComputedStyle(e)[p], property);
function contrast(a, b) {
  const luminance = (color) => {
    const rgb = color
      .match(/\d+/g)
      .slice(0, 3)
      .map((n) => {
        const v = Number(n) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
try {
  await page.goto(origin + 'preview#explore');
  await page.locator('.ew-brand-entry').waitFor({ state: 'detached' });
  const paletteStrokes = new Set();
  for (const [id, label] of [
    ['warm', '暖色'],
    ['cool', '冷色'],
    ['night', '夜间'],
  ]) {
    await page
      .getByRole('link', { name: '我的', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await page
      .locator('.ew-appearance-settings')
      .getByRole('button', { name: label, exact: true })
      .click();
    const background = await style('body', 'backgroundColor');
    const stroke = await style('.sw-sidebar [data-icon="Compass"]', 'stroke');
    paletteStrokes.add(stroke);
    assert.ok(contrast(stroke, background) >= 3, `${id} navigation contrast`);
    for (const name of ['Sun', 'Snowflake', 'Moon']) {
      const selector = `.ew-appearance-settings .ew-theme-switch [data-icon="${name}"]`;
      assert.equal(await page.locator(selector).isVisible(), true);
      // The crescent's dark fill supplies contrast in light themes.
      const color =
        name === 'Moon' && id !== 'night'
          ? await style(selector + ' path', 'fill')
          : await style(selector, 'stroke');
      assert.ok(contrast(color, background) >= 3, `${id} ${name} contrast`);
    }
    await page
      .getByRole('link', { name: '发现', exact: true })
      .filter({ visible: true })
      .click();
    const like = page
      .getByRole('button', { name: '点赞', exact: true })
      .first();
    assert.equal(
      await like.locator('svg').evaluate((e) => getComputedStyle(e).fill),
      'none',
    );
    await like.click();
    const unlike = page
      .getByRole('button', { name: '取消点赞', exact: true })
      .first();
    assert.notEqual(
      await unlike.locator('svg').evaluate((e) => getComputedStyle(e).fill),
      'none',
    );
    await unlike.click();
    await capture(id);
    await page
      .locator('.sw-sidebar')
      .getByRole('button', { name: '发布', exact: true })
      .click();
    await page.getByRole('dialog').waitFor();
    assert.equal(
      await style('.sn-media-actions [data-icon="Image"]', 'stroke'),
      stroke,
    );
    assert.equal(
      await page.locator('.ew-generated-icon, .ew-icon image').count(),
      0,
    );
    await page.getByRole('button', { name: '关闭窗口' }).click();
  }
  assert.equal(paletteStrokes.size, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('link', { name: '我的', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  for (const name of ['Sun', 'Snowflake', 'Moon']) {
    assert.equal(
      await page
        .locator(
          `.ew-appearance-settings .ew-theme-switch [data-icon="${name}"]`,
        )
        .isVisible(),
      true,
    );
  }
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  await phone.goto(origin + 'preview#explore');
  await phone.locator('.ew-brand-entry').waitFor({ state: 'detached' });
  assert.equal(
    await phone.locator('.sw-mobile-nav [data-icon="Compass"]').isVisible(),
    true,
  );
  await phone.close();

  // Review the actual exported components in all palettes, including small sizes.
  // This gallery exists only in the test page, never as a production route.
  if (output) {
    const icons = await server.ssrLoadModule('/icons.tsx');
    const css = await fs.readFile('elsewhere/web/icons.css', 'utf8');
    const names = [
      'Compass',
      'MessageCircle',
      'Users',
      'Bot',
      'Search',
      'Sun',
      'Snowflake',
      'Moon',
      'Heart',
      'Bookmark',
      'Image',
      'Video',
      'Send',
      'Settings2',
      'Activity',
      'BookOpen',
    ];
    const labels = [
      '发现',
      '消息',
      '通讯录',
      'Agent',
      '搜索',
      '暖色',
      '冷色',
      '夜间',
      '点赞',
      '收藏',
      '图片',
      '视频',
      '发送',
      '设置',
      '活动',
      '手札',
    ];
    await page.setViewportSize({ width: 1120, height: 620 });
    await page.setContent(`<style>${css}
      *{box-sizing:border-box}body{margin:0;background:#fff;font-family:Georgia,'Songti SC',serif}
      section{padding:20px 28px}h2{margin:0 0 18px;font-size:24px;font-weight:500}
      .icons{display:grid;grid-template-columns:repeat(16,1fr);gap:12px}
      .item{display:flex;flex-direction:column;align-items:center;gap:10px;font-size:14px}
      .night{background:#191b20;color:#e9e7e1}.cool{background:#f3f7fd;color:#263845}.warm{background:#faf6ee;color:#292620}
      </style>${[
        ['warm', '暖色 · 陶橙与赭色'],
        ['cool', '冷色 · 蓝色为主，橙色点缀'],
        ['night', '夜间 · 深蓝填色，灰蓝轮廓'],
      ]
        .map(
          ([id, label]) =>
            `<section class="${id}" data-icon-palette="${id}"><h2>${label}</h2><div class="icons">${names.map((name, i) => `<div class="item">${renderToStaticMarkup(React.createElement(icons[name], { size: 36 }))}<span>${labels[i]}</span>${renderToStaticMarkup(React.createElement(icons[name], { size: 18 }))}</div>`).join('')}</div></section>`,
        )
        .join('')}`);
    await capture('icon-palettes');
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: three icon palettes, contrast, reaction states, dialog inheritance, compact desktop and touch navigation.',
  );
} finally {
  await browser.close();
  await server.close();
}
