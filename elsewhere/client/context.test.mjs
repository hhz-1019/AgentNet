import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retrieveContext } from './context.mjs';
import { AgentNetRuntime } from './runtime.mjs';
import { workRecord } from './work.mjs';
void test('connected context retrieval ranks the named Chinese project, excludes secrets and does not attach outside files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentnet-context-'));
  const dir = join(home, 'context');
  await mkdir(dir);
  try {
    await writeFile(join(home, 'outside.png'), 'private');
    await writeFile(join(dir, 'a.md'), '# 阳台\n番茄今天开花了。');
    await writeFile(
      join(dir, 'social.md'),
      '# 社会模拟\n社会模拟验证已进行第一轮。\n![外部](../outside.png)',
    );
    await writeFile(join(dir, 'key.txt'), '社会模拟 password=abcdefghijklmnop');
    try {
      await symlink(join(home, 'outside.png'), join(dir, 'linked.md'));
    } catch (error) {
      // Windows without Developer Mode cannot create a file symlink. The
      // outside-image and secret-exclusion checks still run on that host.
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    }
    const records = await retrieveContext(dir, '整理我的社会模拟工作并分享');
    assert.equal(records.length, 1);
    assert.ok(records[0].source.includes('social.md'));
    assert.equal(records[0].status, 'context');
    assert.equal(records[0].shareable, false);
    assert.equal(workRecord(records[0]).skipped, true);
    assert.deepEqual(records[0].media, []);
    assert.deepEqual(await retrieveContext(dir, '量子计算'), []);
    assert.deepEqual(await retrieveContext(dir, ''), []);
    assert.deepEqual(await retrieveContext(undefined, '分享工作'), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

for (const selection of ['context', 'mixed', 'curated', 'private-mixed']) {
  void test(`runtime preserves publication boundaries for ${selection} records`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'agentnet-context-boundary-'));
    const contextDirectory = join(home, 'context');
    const workDirectory = join(home, 'work');
    const published = [],
      uploaded = [],
      completions = [];
    const curated = {
      work_id: 'verified',
      status: 'completed',
      shareable: true,
      title: '社会模拟验证记录',
      source: '已批准分享的验证报告',
      result: '已完成第一轮社会模拟验证，具体结果以本次验证记录为准。',
      evidence: '本地测试通过',
      limitations: '尚未验证其他场景',
      tags: ['社会模拟'],
    };
    const publish = selection !== 'private-mixed';
    const command = {
      command_id: '991',
      command_type: 'human_instruction',
      payload: {
        instruction: '整理社会模拟',
        publish,
        allow_draft: true,
        visibility: 'public',
      },
    };
    const worker = new AgentNetRuntime({
      home,
      endpoint: 'https://example.com',
      contextDirectory,
      workDirectory,
      allowDrafts: true,
      client: {
        get_context: async () => ({ context_revision: 1 }),
        heartbeat: async () => ({}),
        pending_commands: async () => ({ commands: [command] }),
        claim_command: async () => ({
          ...command,
          claim_token: 'proof',
          claim_epoch: 1,
          claim_until: Date.now() + 120000,
        }),
        get_work_posts: async () => ({ items: [] }),
        upload_image: async (image) => {
          uploaded.push(image);
          return { url: 'https://example.com/image.png', kind: 'image' };
        },
        share_work: async (report) => {
          published.push(report);
          return { id: '992', state: 'published' };
        },
        complete_command: async (result) => {
          completions.push(result);
          return { status: result.status };
        },
      },
      model: {
        model: 'test',
        json: async (_prompt, input) => {
          assert.equal(
            input.records.find((r) => r.work_id.startsWith('context:'))
              .shareable,
            false,
          );
          return {
            reply: '已完成分享。', // A model claim is not a publication receipt.
            work_ids:
              selection === 'curated'
                ? ['verified']
                : selection === 'context'
                  ? ['context:notes.md']
                  : ['verified', 'context:notes.md'],
          };
        },
      },
    });
    try {
      await mkdir(contextDirectory);
      await mkdir(workDirectory);
      await writeFile(
        join(contextDirectory, 'notes.md'),
        '# 社会模拟\n计划下周验证，尚未开始。\n![草图](draft.png)',
      );
      await writeFile(join(contextDirectory, 'draft.png'), 'private image');
      await writeFile(
        join(workDirectory, 'verified.json'),
        JSON.stringify(curated),
      );
      await worker.open();
      await worker.tick();
      assert.equal(completions.length, 1);
      assert.equal(uploaded.length, 0);
      if (selection === 'curated') {
        assert.equal(published.length, 1);
        assert.equal(published[0].work_id, 'verified');
        assert.equal(completions[0].result.post_id, '992');
      } else {
        assert.equal(published.length, 0);
        assert.equal(completions[0].status, 'failed');
        assert.equal(completions[0].result.reason, 'context_not_shareable');
        assert.match(completions[0].result.reply, /没有生成帖子或发布/);
        assert.equal(completions[0].result.work_report, undefined);
        assert.ok(!JSON.stringify(completions).includes('计划下周验证'));
        assert.ok(!JSON.stringify(completions).includes('draft.png'));
      }
    } finally {
      await worker.close();
      await rm(home, { recursive: true, force: true });
    }
  });
}
