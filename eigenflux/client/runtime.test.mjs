import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompatibleModel } from './model.mjs';
import { AgentNetRuntime } from './runtime.mjs';
const record = {
  work_id: 'curated-task',
  status: 'completed',
  shareable: true,
  title: '真实完成的开发工作记录',
  source: '允许分享的开发任务',
  result: '按实际测试结果整理实现过程和验证范围。',
  evidence: '实际验证步骤和结果',
  limitations: '未运行公网服务。',
  tags: ['Agent 工程'],
};
async function fixture(fn) {
  const home = await mkdtemp(join(tmpdir(), 'agentnet-runtime-'));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
function adapter(overrides = {}) {
  const state = { generations: 0, completions: [], claims: 0 };
  const command = {
    command_id: '9007199254740993',
    command_type: 'human_instruction',
    payload: { instruction: '请整理这份工作记录的私有草稿', allow_draft: true },
  };
  const client = {
    get_context: async () => ({ context_revision: 1 }),
    heartbeat: async () => ({}),
    pending_commands: async () => ({ commands: [command] }),
    claim_command: async () => {
      state.claims++;
      return {
        ...command,
        claim_token: 'proof',
        claim_epoch: 1,
        claim_until: Date.now() + 120000,
      };
    },
    get_work_posts: async () => ({ items: [] }),
    complete_command: async (c) => {
      state.completions.push(structuredClone(c));
      return { status: c.status };
    },
    ...overrides,
  };
  const model = {
    model: 'protocol-test',
    json: async () => {
      state.generations++;
      return {
        reply: '根据已有记录整理，仍需主人确认。',
        work_id: 'curated-task',
      };
    },
  };
  return { client, model, state };
}
void test('compatible model uses actual HTTP chat protocol, rejects leaks, truncation and redirects', async () => {
  let response = {
      choices: [
        {
          message: { content: '{"reply":"模型协议验证"}' },
          finish_reason: 'stop',
        },
      ],
    },
    seen;
  let redirect = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen = {
      path: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(body),
    };
    if (redirect) {
      res.writeHead(302, { Location: '/v1/redirected' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = new CompatibleModel({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      model: 'test',
      apiKey: 'local-test-key',
    });
    assert.equal(
      (await model.json('fact-only', { text: 'work' })).reply,
      '模型协议验证',
    );
    assert.equal(seen.path, '/v1/chat/completions');
    assert.equal(seen.auth, 'Bearer local-test-key');
    assert.equal(seen.body.stream, false);
    await assert.rejects(
      model.json('fact-only', { text: 'password=abcdefghijklmnop' }),
      /credentials/,
    );
    response = {
      choices: [
        {
          message: { content: '{"reply":"partial"}' },
          finish_reason: 'length',
        },
      ],
    };
    await assert.rejects(model.json('x', {}), /complete JSON/);
    response = {
      choices: [
        { message: { content: '{"reply":"api_key=abcdefghijklmnop"}' } },
      ],
    };
    await assert.rejects(model.json('x', {}), /credentials/);
    response = {
      choices: [
        {
          message: {
            content: JSON.stringify({ reply: 'x'.repeat(1024 * 1024 + 1) }),
          },
        },
      ],
    };
    await assert.rejects(model.json('x', {}), /1 MiB/);
    redirect = true;
    await assert.rejects(model.json('x', {}));
    assert.throws(
      () =>
        new CompatibleModel({
          baseURL: 'http://example.com/v1',
          model: 'x',
          apiKey: 'key',
        }),
      /HTTPS/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
void test('durable completion retries retain exact claim and result without running the model twice', async () =>
  fixture(async (home) => {
    await mkdir(join(home, 'records'));
    await writeFile(join(home, 'records', 'task.json'), JSON.stringify(record));
    const f = adapter();
    let attempts = 0;
    f.client.complete_command = async (c) => {
      f.state.completions.push(structuredClone(c));
      if (++attempts === 1) throw new Error('connection lost after commit');
      return { status: 'completed' };
    };
    const worker = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
      allowDrafts: true,
      workDirectory: join(home, 'records'),
    });
    await worker.open();
    await assert.rejects(worker.tick(), /connection lost/);
    await worker.close();
    const restored = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
      allowDrafts: true,
      workDirectory: join(home, 'records'),
    });
    await restored.open();
    await restored.tick();
    await restored.close();
    assert.equal(f.state.generations, 1);
    assert.equal(f.state.claims, 1);
    assert.deepEqual(f.state.completions[0], f.state.completions[1]);
    assert.equal(
      f.state.completions[0].result.work_report.source,
      record.source,
    );
    if (process.platform !== 'win32')
      assert.equal(
        (await stat(join(home, 'agentnet-runtime', 'journal.json'))).mode &
          0o777,
        0o600,
      );
  }));
void test('unavailable or unapproved work cannot become a completed shareable result', async () =>
  fixture(async (home) => {
    const f = adapter();
    const worker = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await worker.run({ once: true });
    assert.equal(f.state.completions[0].status, 'failed');
    assert.equal(f.state.completions[0].result.work_report, undefined);
  }));
void test('restart recovers an interrupted execution as failure; same Home rejects simultaneous workers', async () =>
  fixture(async (home) => {
    const f = adapter();
    const a = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await a.open();
    const b = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await assert.rejects(b.open(), /lock exists/);
    a.journal.jobs['9007199254740993'] = {
      phase: 'executing',
      completion: {
        command_id: '9007199254740993',
        claim_token: 'proof',
        claim_epoch: 1,
        status: 'failed',
        result: {},
      },
    };
    await a.save();
    await a.close();
    await b.open();
    await b.tick();
    await b.close();
    assert.equal(f.state.generations, 0);
    assert.equal(f.state.completions[0].status, 'failed');
  }));
void test('fenced completion is reclaimed as a failure without reexecuting', async () =>
  fixture(async (home) => {
    const f = adapter({
      complete_command: async () => {
        throw new Error('CLAIM_FENCED');
      },
    });
    f.model.json = async () => ({ reply: '真实分析回复', work_id: null });
    const worker = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await worker.open();
    await assert.rejects(worker.tick(), /CLAIM_FENCED/);
    await assert.rejects(worker.tick(), /CLAIM_FENCED/);
    await worker.close();
    assert.equal(f.state.claims, 2);
    assert.equal(
      JSON.parse(
        await readFile(join(home, 'agentnet-runtime', 'journal.json'), 'utf8'),
      ).jobs['9007199254740993'].phase,
      'fenced',
    );
  }));
void test('invalid owner instruction is failed so the next instruction can progress', async () =>
  fixture(async (home) => {
    const invalid = {
      command_id: '1',
      command_type: 'human_instruction',
      payload: {},
    };
    const valid = {
      command_id: '2',
      command_type: 'human_instruction',
      payload: { instruction: 'hello' },
    };
    const pending = [invalid, valid];
    const f = adapter({
      pending_commands: async () => ({ commands: pending }),
      claim_command: async ({ command_id }) => {
        f.state.claims++;
        return {
          ...pending.find((c) => c.command_id === command_id),
          claim_token: 'proof',
          claim_epoch: 1,
          claim_until: Date.now() + 120000,
        };
      },
      complete_command: async (completion) => {
        f.state.completions.push(completion);
        pending.splice(
          pending.findIndex((c) => c.command_id === completion.command_id),
          1,
        );
        return { status: completion.status };
      },
    });
    f.model.json = async () => ({ reply: '分析结果', work_id: null });
    const worker = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await worker.open();
    await worker.tick();
    await worker.tick();
    await worker.close();
    assert.deepEqual(
      f.state.completions.map((x) => x.status),
      ['failed', 'completed'],
    );
    assert.equal(f.state.claims, 2);
  }));
void test('draft submission failure remains durable and retries without repeating command completion', async () =>
  fixture(async (home) => {
    const f = adapter();
    let draftAttempts = 0;
    f.client.complete_command = async (completion) => {
      f.state.completions.push(completion);
      return { status: 'completed', social_draft_error: 'offline' };
    };
    f.client.record_work = async () => {
      draftAttempts++;
      if (draftAttempts === 1) throw new Error('offline');
      return { id: 'draft-1' };
    };
    f.client.pending_commands = async () => ({ commands: [] });
    const worker = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await worker.open();
    worker.journal.jobs['1'] = {
      phase: 'ready',
      completion: {
        command_id: '1',
        claim_token: 'proof',
        claim_epoch: 1,
        status: 'completed',
        result: { work_report: record },
      },
    };
    await worker.save();
    await worker.tick();
    assert.equal(worker.journal.jobs['1'].phase, 'draft_pending');
    await worker.close();
    const restored = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await restored.open();
    await restored.tick();
    assert.equal(draftAttempts, 1);
    assert.equal(restored.journal.jobs['1'].phase, 'draft_pending');
    await restored.tick();
    await restored.close();
    assert.equal(draftAttempts, 2);
    assert.equal(f.state.completions.length, 1);
    assert.equal(
      JSON.parse(
        await readFile(join(home, 'agentnet-runtime', 'journal.json'), 'utf8'),
      ).jobs['1'].phase,
      'done',
    );
  }));
void test('unsupported commands are not claimed, aborted runtime makes no new claim', async () =>
  fixture(async (home) => {
    const f = adapter({
      pending_commands: async () => ({
        commands: [{ command_id: '1', command_type: 'private_message' }],
      }),
    });
    const worker = new AgentNetRuntime({
      ...f,
      home,
      endpoint: 'https://example.com',
    });
    await worker.open();
    await worker.tick();
    await worker.tick({ signal: AbortSignal.abort() });
    await worker.close();
    assert.equal(f.state.claims, 0);
  }));
void test('console sharing retrieves project context and images, then retries a lost share receipt without running the model again', async () =>
  fixture(async (home) => {
    const directory = join(home, 'context');
    await mkdir(directory);
    await writeFile(
      join(directory, '社会模拟.md'),
      '# 社会模拟验证\n已完成两个孤独感干预方案的对照，尚未验证长期效果。\n![干预比较](chart.png)',
    );
    await writeFile(join(directory, 'chart.png'), Buffer.from('fixture-image'));
    let shares = 0,
      uploads = 0;
    const { client, model, state } = adapter({
      pending_commands: async () => ({
        commands: [
          {
            command_id: '700',
            command_type: 'human_instruction',
            payload: {
              instruction: '分享社会模拟工作',
              publish: true,
              visibility: 'friends',
            },
          },
        ],
      }),
      claim_command: async () => ({
        command_id: '700',
        claim_token: 'proof',
        claim_epoch: 1,
        claim_until: Date.now() + 120000,
        payload: { publish: true, visibility: 'friends' },
      }),
      upload_image: async ({ local_path }) => {
        assert.equal(local_path, join(directory, 'chart.png'));
        uploads++;
        return {
          url: '/api/v2/console/social/media/71',
          alt: '干预比较',
          kind: 'image',
        };
      },
      share_work: async (report) => {
        shares++;
        assert.equal(report.visibility, 'friends');
        assert.equal(report.command_id, '700');
        assert.equal(report.media[0].url, '/api/v2/console/social/media/71');
        if (shares === 1) throw new Error('lost share response');
        return { id: '72', state: 'published' };
      },
    });
    model.json = async (prompt, input) => {
      state.generations++;
      assert.ok(prompt.includes('简体中文'));
      assert.ok(input.records[0].result.includes('长期效果'));
      return {
        reply: '正在整理社会模拟工作。',
        work_ids: [input.records[0].work_id],
      };
    };
    let worker = new AgentNetRuntime({
      client,
      model,
      home,
      endpoint: 'local',
      contextDirectory: directory,
    });
    await worker.open();
    await assert.rejects(worker.tick(), /lost share response/);
    await worker.close();
    worker = new AgentNetRuntime({
      client,
      model,
      home,
      endpoint: 'local',
      contextDirectory: directory,
    });
    await worker.open();
    try {
      await worker.tick();
      assert.equal(shares, 2);
      assert.equal(uploads, 1);
      assert.equal(state.generations, 1);
      assert.equal(state.completions[0].result.post_id, '72');
      assert.equal(state.completions[0].result.execution, 'shared');
      assert.equal(state.completions[0].result.work_report, undefined);
    } finally {
      await worker.close();
    }
  }));
void test('share request without connected supporting context is not published', async () =>
  fixture(async (home) => {
    let published = false;
    const { client, model, state } = adapter({
      claim_command: async () => ({
        command_id: '9007199254740993',
        claim_token: 'proof',
        claim_epoch: 1,
        claim_until: Date.now() + 120000,
        payload: { publish: true, visibility: 'public' },
      }),
      share_work: async () => {
        published = true;
      },
    });
    model.json = async () => ({ reply: '没有相关工作记录。', work_ids: [] });
    const worker = new AgentNetRuntime({
      client,
      model,
      home,
      endpoint: 'local',
    });
    await worker.open();
    try {
      await worker.tick();
      assert.equal(published, false);
      assert.ok(state.completions[0].result.reply.includes('没有发布'));
    } finally {
      await worker.close();
    }
  }));
