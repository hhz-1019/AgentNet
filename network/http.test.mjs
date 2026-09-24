import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

await test('real HTTP: production assets, validation, concurrent persistence and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentnet-http-'));
  const port = 49000 + Math.floor(Math.random() * 10000);
  const url = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--production'],
      {
        env: {
          ...process.env,
          PORT: String(port),
          AGENTNET_DATA_DIR: directory,
        },
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    let logs = '';
    child.stderr.on('data', (c) => (logs += c));
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${url}/api/network`)).ok) return;
      } catch {}
      if (child.exitCode !== null) throw Error(logs);
      await delay(100);
    }
    throw Error(`Server did not start: ${logs}`);
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
      });
    }
  };
  const post = async (action, payload, extra = {}) =>
    fetch(`${url}/api/network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify({ action, payload }),
    });
  try {
    await start();
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('AgentNet'));
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    assert.equal((await fetch(url + asset)).status, 200);
    const initial = await (await fetch(`${url}/api/network`)).json();
    assert.equal(initial.agents.length, 12);
    assert.equal(
      (
        await post('publish', {
          title: '',
          body: 'x',
          topic: 'AI 与研究',
          type: '需求',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          'profile',
          { name: 'x', bio: 'x' },
          { Origin: 'https://unrelated.example' },
        )
      ).status,
      403,
    );
    const invalid = await fetch(`${url}/api/network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(invalid.status, 400);
    const requests = await Promise.all(
      [0, 1, 2].map((i) =>
        post('publish', {
          title: `网络持久化检查 ${i}`,
          body: '寻找研究论文与实验评测伙伴',
          topic: 'AI 与研究',
          type: '需求',
        }),
      ),
    );
    assert.ok(requests.every((r) => r.status === 200));
    const snapshot = await (await fetch(`${url}/api/network`)).json();
    assert.equal(snapshot.broadcasts.length, initial.broadcasts.length + 3);
    assert.equal(
      new Set(snapshot.broadcasts.map((s) => s.id)).size,
      snapshot.broadcasts.length,
    );
    const agentId = snapshot.broadcasts[0].matched[0].agentId;
    assert.equal(
      (await post('chat', { agentId, text: '完整保留中文内容与会话上下文。' }))
        .status,
      200,
    );
    const persisted = await (await fetch(`${url}/api/network`)).json();
    await stop();
    await start();
    assert.deepEqual(
      await (await fetch(`${url}/api/network`)).json(),
      persisted,
    );
  } finally {
    await stop();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
