// Run the unmodified Gorse binary against captured public posts, then exercise
// Elsewhere's real Go adapter against it. No requests write to the live platform.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { syncCatalog } from '../recommender/sync.mjs';
const root = resolve('.agentnet-audit/recommendation');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(root + '/real-gorse-');
const corpus =
  process.env.AGENTNET_RECOMMENDATION_CORPUS || root + '/corpus.json';
const posts = JSON.parse(await readFile(corpus, 'utf8'));
const key = randomBytes(24).toString('hex');
const config = (await readFile('eigenflux/recommender/gorse.toml', 'utf8'))
  .replaceAll('/var/lib/gorse', dir)
  .replaceAll('"0.0.0.0"', '"127.0.0.1"')
  // Shorten only the test schedule; the recommendation implementations and
  // production training schedule remain upstream defaults.
  .replace(
    '[recommend.collaborative]',
    '[recommend.collaborative]\nfit_period = "5s"',
  )
  .replace('[recommend.ranker]', '[recommend.ranker]\nfit_period = "5s"');
await writeFile(dir + '/gorse.toml', config);
await mkdir(dir + '/cache', { recursive: true });
const log = await open(dir + '/gorse.log', 'w');
const binary = process.env.AGENTNET_GORSE_BINARY || root + '/gorse-native';
const child = spawn(
  binary,
  ['--config', dir + '/gorse.toml', '--cache-path', dir + '/cache'],
  {
    env: {
      ...process.env,
      GORSE_SERVER_API_KEY: key,
      GORSE_MASTER_HTTP_PORT: '14389',
      GORSE_MASTER_PORT: '14386',
      GORSE_DASHBOARD_USER_NAME: 'audit',
      GORSE_DASHBOARD_PASSWORD: key,
    },
    stdio: ['ignore', log.fd, log.fd],
  },
);
const source = createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const start = Number(u.searchParams.get('cursor') || 0),
    items = posts.slice(start, start + 25);
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      data: {
        items,
        next_cursor: start + 25 < posts.length ? String(start + 25) : '',
      },
    }),
  );
});
await new Promise((r) => source.listen(0, '127.0.0.1', r));
const engine = 'http://127.0.0.1:14389';
const api = async (path, method = 'GET', body) => {
  const r = await fetch(engine + path, {
    method,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('Gorse HTTP ' + r.status);
  return r.json();
};
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null)
      throw new Error('Gorse exited; inspect ' + dir + '/gorse.log');
    try {
      await api('/api/items?n=1');
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready)
    throw new Error('Gorse startup timeout; inspect ' + dir + '/gorse.log');
  console.log('Gorse is running.');
  console.log(
    await syncCatalog({
      source: 'http://127.0.0.1:' + source.address().port,
      engine,
      key,
    }),
  );
  const user = 'agent:368750834374152192';
  await api('/api/user', 'POST', { UserId: user, Labels: [] });
  const feedback = posts.flatMap((p) =>
    ['like', 'save']
      .filter((k) => (k === 'like' ? p.liked : p.saved))
      .map((k) => ({
        FeedbackType: k,
        UserId: user,
        ItemId: 'post:' + p.id,
        Timestamp: new Date().toISOString(),
      })),
  );
  if (feedback.length) await api('/api/feedback', 'POST', feedback);
  // The first response can be latest fallback before the training loop runs.
  // Preserve that baseline, then wait for a completed loop over the real data.
  const startupRanked = await api(
    '/api/recommend/' + encodeURIComponent(user) + '?n=500',
  );
  let processed = false;
  for (let i = 0; i < 90; i++) {
    const lines = (await readFile(dir + '/gorse.log', 'utf8'))
      .trim()
      .split('\n');
    const events = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    if (
      events.filter((e) => e.msg === 'complete ranking recommendation')
        .length >= 2
    ) {
      processed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!processed)
    throw new Error('Gorse processing timeout; inspect ' + dir + '/gorse.log');
  let ranked = [];
  for (let i = 0; i < 90; i++) {
    ranked = await api('/api/recommend/' + encodeURIComponent(user) + '?n=500');
    if (ranked.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ranked.length)
    throw new Error(
      'Gorse has not produced candidates yet; inspect ' + dir + '/gorse.log',
    );
  await writeFile(
    root + '/gorse-raw.json',
    JSON.stringify(
      {
        source_version: 'v0.5.11',
        corpus_size: posts.length,
        real_feedback_count: feedback.length,
        startup_ranked: startupRanked,
        processing_log: dir + '/gorse.log',
        ranked,
      },
      null,
      2,
    ),
  );
  console.log(
    'Real engine returned',
    ranked.length,
    'candidates; real feedback events:',
    feedback.length,
  );
  const testsLog = await open(root + '/gorse-adapter-tests.log', 'w');
  let stopSync = false;
  const syncRounds = [];
  const concurrentSync =
    process.env.AGENTNET_TEST_GORSE_CONTENTION === '1'
      ? (async () => {
          while (!stopSync) {
            const started = Date.now();
            const result = await syncCatalog({
              source: 'http://127.0.0.1:' + source.address().port,
              engine,
              key,
            });
            if (result.updated !== 0)
              throw new Error('unchanged catalog was rewritten');
            syncRounds.push({ ...result, elapsed_ms: Date.now() - started });
            await new Promise((r) => setTimeout(r, 1000));
          }
        })()
      : Promise.resolve();
  // Attach a handler immediately; propagate failure after both tasks settle.
  const syncOutcome = concurrentSync.then(
    () => null,
    (error) => error,
  );
  const test = spawn(
    process.execPath,
    ['eigenflux/scripts/social-core-test.mjs'],
    {
      env: {
        ...process.env,
        AGENTNET_SOCIAL_TEST_PORT: '15487',
        AGENTNET_TEST_GORSE_URL: engine,
        AGENTNET_TEST_GORSE_KEY: key,
        AGENTNET_TEST_GORSE_CACHE:
          process.env.AGENTNET_TEST_GORSE_CONTENTION === '1'
            ? dir + '/cache.db'
            : '',
        AGENTNET_RECOMMENDATION_CORPUS: corpus,
        AGENTNET_RECOMMENDATION_REPORT: root + '/gorse-replay.json',
      },
      stdio: ['ignore', testsLog.fd, testsLog.fd],
    },
  );
  const code = await new Promise((ok, fail) => {
    test.once('error', fail);
    test.once('exit', ok);
  });
  stopSync = true;
  const syncError = await syncOutcome;
  await testsLog.close();
  if (syncError) throw syncError;
  if (syncRounds.length) {
    await writeFile(
      root + '/concurrent-sync.json',
      JSON.stringify(
        { corpus_size: posts.length, rounds: syncRounds },
        null,
        2,
      ),
    );
    console.log(
      'Concurrent unchanged catalog sync rounds:',
      syncRounds.length,
      '; item rewrites: 0',
    );
  }
  if (code !== 0)
    throw new Error(
      'Adapter regression failed: ' + root + '/gorse-adapter-tests.log',
    );
  if (process.env.AGENTNET_TEST_GORSE_CONTENTION === '1') {
    // Mutations below affect this isolated replay source only.
    const original = structuredClone(posts[0]);
    const added = { ...structuredClone(original), id: '1' };
    posts[0] = {
      ...original,
      document: {
        ...original.document,
        summary: 'Local synchronization regression',
      },
    };
    posts.push(added);
    const opts = {
      source: 'http://127.0.0.1:' + source.address().port,
      engine,
      key,
    };
    const edited = await syncCatalog(opts);
    if (edited.updated !== 2)
      throw new Error('new/edited items failed to synchronize');
    const stored = await api(
      '/api/item/' + encodeURIComponent('post:' + original.id),
    );
    if (!stored.Comment.includes('Local synchronization regression'))
      throw new Error('edited content not stored');
    posts[0] = original;
    posts.pop();
    const restored = await syncCatalog(opts);
    if (restored.updated !== 1 || restored.removed !== 1)
      throw new Error('restore/removal failed');
    console.log(
      'PASS real engine: new item, edited metadata, removal and no-op refresh',
    );
  }
  console.log(
    'PASS real Gorse → Elsewhere permission filtering → Agent candidate response',
  );
} finally {
  source.close();
  const stopped = new Promise((r) => child.once('exit', r));
  child.kill('SIGINT');
  await Promise.race([stopped, new Promise((r) => setTimeout(r, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await log.close();
}
