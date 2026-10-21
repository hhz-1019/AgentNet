import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const output = '.agentnet-audit/entry-acceptance';
await mkdir(output, { recursive: true });
const server = await preview({
  configFile: 'eigenflux/web/vite.config.mjs',
  preview: { host: '127.0.0.1', port: 0 },
});
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.AGENTNET_CHROMIUM_PATH || undefined,
});
const results = [];
try {
  for (const test of [
    { name: 'fast', delay: 100 },
    { name: 'normal', delay: 3000, screenshots: true },
    { name: 'slow-mobile', delay: 5000, mobile: true, cpu: 4 },
    { name: 'late-ready', delay: 7400 },
    { name: 'delayed-image', delay: 100, image: true },
    { name: 'resize', delay: 3000, resize: true },
    { name: 'failed', delay: 1500, failed: true },
    { name: 'timeout', pending: true },
    { name: 'skip', pending: true, skip: true },
    { name: 'reduced-motion', delay: 100, reduced: true },
  ]) {
    const context = await browser.newContext({
      viewport: test.mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      reducedMotion: test.reduced ? 'reduce' : 'no-preference',
      recordVideo: { dir: output, size: { width: 960, height: 600 } },
    });
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    if (test.cpu)
      await (
        await context.newCDPSession(p)
      ).send('Emulation.setCPUThrottlingRate', { rate: test.cpu });
    await p.addInitScript(() => {
      window.entryFrames = [];
      const proto = CanvasRenderingContext2D.prototype;
      // These saved methods are invoked with the original canvas receiver below.
      const transform = Object.getOwnPropertyDescriptor(
        proto,
        'setTransform',
      ).value;
      const fill = Object.getOwnPropertyDescriptor(proto, 'fillText').value;
      const starts = new WeakMap();
      proto.setTransform = function (...args) {
        if (this.canvas.closest('.ew-brand-entry'))
          starts.set(this, performance.now());
        return transform.apply(this, args);
      };
      proto.fillText = function (...args) {
        const result = fill.apply(this, args);
        const node = this.canvas.closest('.ew-brand-entry');
        if (node && /^\d+%$/.test(args[0]))
          window.entryFrames.push({
            at: performance.now(),
            percent: Number.parseInt(args[0]),
            phase: node.dataset.entryPhase,
            covered: document
              .querySelector('.ew-entry-content')
              ?.hasAttribute('data-entry-covered'),
            paintMs:
              performance.now() - (starts.get(this) || performance.now()),
          });
        return result;
      };
    });
    if (test.image)
      await p.route('**/entry-test-image.svg', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await p.evaluate(() => performance.mark('fixture-image-delivered'));
        await route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="580"><rect width="460" height="580" fill="#738c7a"/><circle cx="230" cy="220" r="100" fill="#e7d9b8"/></svg>',
        });
      });
    await p.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = { items: [], next_cursor: '' };
      if (path.endsWith('/session'))
        data = {
          agent_id: '101',
          agent_name: '测试',
          owner_uid: 'test',
          owner_bound: true,
          onboarding: { state: 'completed', current_step: 5, revision: 1 },
        };
      if (path.endsWith('/portrait'))
        data = {
          fields: { name: '测试' },
          visible: ['name'],
          memories: [],
          revision: 1,
        };
      if (path.endsWith('/accounts')) data = { accounts: [] };
      if (path.endsWith('/access')) data = { allowed: false };
      if (path.endsWith('/avatars')) data = { avatars: {}, previews: {} };
      if (path.endsWith('/activity/stream'))
        return route.fulfill({
          contentType: 'text/event-stream',
          body: ': test\n\n',
        });
      if (path.endsWith('/social/posts')) {
        if (test.pending) {
          await new Promise((resolve) => context.once('close', resolve));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, test.delay));
        if (test.failed)
          return route.fulfill({
            status: 503,
            json: { error: { message: 'fixture unavailable' } },
          });
        if (test.image)
          data = {
            items: [
              {
                id: '91',
                agent_id: '101',
                author_name: '测试',
                author_avatar: { avatar: '' },
                state: 'published',
                visibility: 'public',
                revision: 1,
                created_at: 1,
                published_at: 1,
                likes: 0,
                saves: 0,
                comments: 0,
                liked: false,
                saved: false,
                document: {
                  title: '首屏图片验收',
                  summary: '',
                  body: '测试内容',
                  kind: 'social',
                  tags: [],
                  identity: 'agent',
                  project_name: '',
                  media: [
                    {
                      kind: 'image',
                      url: '/entry-test-image.svg',
                      alt: '图片测试',
                      width: 460,
                      height: 580,
                      color: '#738c7a',
                    },
                  ],
                },
              },
            ],
            next_cursor: '',
          };
      }
      await route.fulfill({ json: { data } });
    });
    await p.goto(origin + 'dashboard', { waitUntil: 'domcontentloaded' });
    if (!test.reduced) await p.locator('.ew-brand-entry').waitFor();
    if (test.skip) await p.getByRole('button', { name: '跳过动画' }).click();
    if (test.resize) {
      await p.waitForTimeout(1000);
      await p.setViewportSize({ width: 900, height: 700 });
    }
    if (test.screenshots) {
      await p.locator('.ew-brand-entry[data-entry-phase="morph"]').waitFor();
      await p.screenshot({ path: output + '/01-morph.png' });
      await p.waitForFunction(() =>
        window.entryFrames.some((f) => f.percent === 100),
      );
      await p.screenshot({ path: output + '/02-complete.png' });
      await p.locator('.ew-brand-entry[data-entry-phase="reveal"]').waitFor();
      await p.waitForTimeout(350);
      await p.screenshot({ path: output + '/03-reveal.png' });
    }
    await p
      .locator('.ew-brand-entry')
      .waitFor({ state: 'detached', timeout: 12000 });
    assert.deepEqual(
      errors,
      [],
      test.name + ': browser exception before entry completed',
    );
    if (!(await p.locator('.ew-entry-content').count())) {
      await p.screenshot({ path: output + '/' + test.name + '-failure.png' });
      throw new Error(
        test.name +
          ': entry content disappeared: ' +
          (await p.locator('body').innerText()),
      );
    }
    const capture = await p.evaluate(() => ({
      frames: window.entryFrames,
      ready: performance.getEntriesByName('elsewhere:entry-data-ready')[0]
        ?.startTime,
      finished: performance.getEntriesByName('elsewhere:entry-interactive')[0]
        ?.startTime,
      image: performance.getEntriesByName('fixture-image-delivered')[0]
        ?.startTime,
      inert: document.querySelector('.ew-entry-content').inert,
      overflow: document.documentElement.style.overflow,
    }));
    assert.equal(capture.inert, false, test.name + ': content remained inert');
    assert.notEqual(
      capture.overflow,
      'hidden',
      test.name + ': scroll remained locked',
    );
    assert.deepEqual(errors, [], test.name + ': browser exception');
    const first100 = capture.frames.find((f) => f.percent === 100);
    const firstReveal = capture.frames.find((f) => f.phase === 'reveal');
    let holdMs;
    if (test.failed || test.pending || test.reduced) {
      assert.equal(first100, undefined, test.name + ': false completion');
      assert.equal(
        firstReveal,
        undefined,
        test.name + ': revealed as a successful load',
      );
    } else {
      assert.ok(first100, test.name + ': never painted 100%');
      assert.ok(firstReveal, test.name + ': no reveal');
      assert.ok(
        first100.at >= capture.ready,
        test.name + ': completed before actual data',
      );
      if (test.image)
        assert.ok(
          first100.at >= capture.image,
          test.name + ': completed before visible image',
        );
      holdMs = firstReveal.at - first100.at;
      assert.ok(holdMs >= 150, test.name + ': 100% was not visibly held');
      assert.ok(
        capture.finished - firstReveal.at >= 1000,
        test.name + ': reveal was cut short',
      );
      for (let i = 1; i < capture.frames.length; i++)
        assert.ok(
          capture.frames[i].percent >= capture.frames[i - 1].percent,
          test.name + ': percentage regressed',
        );
      assert.ok(
        capture.frames
          .filter((f) => f.phase === 'reveal')
          .every((f) => f.percent === 100),
        test.name + ': incomplete percentage during reveal',
      );
      assert.ok(
        capture.frames
          .filter((f) => f.phase !== 'reveal')
          .every((f) => f.covered),
        test.name + ': content exposed before reveal',
      );
      const at66 = capture.frames.filter((f) => f.percent === 66);
      if (at66.length > 1)
        assert.ok(
          at66.at(-1).at - at66[0].at < 200,
          test.name + ': visible progress stalled at 66%',
        );
    }
    const paint = capture.frames.map((f) => f.paintMs).sort((a, b) => a - b);
    results.push({
      case: test.name,
      frames: capture.frames.length,
      hold100Ms: holdMs,
      readyMs: capture.ready,
      interactiveMs: capture.finished,
      paintP95Ms: paint[Math.floor(paint.length * 0.95)],
    });
    await writeFile(
      `${output}/${test.name}-frames.json`,
      JSON.stringify(capture, null, 2),
    );
    const video = p.video();
    await context.close();
    if (video) await video.saveAs(`${output}/${test.name}.webm`);
    console.log('PASS', test.name, JSON.stringify(results.at(-1)));
  }
  await writeFile(output + '/results.json', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
