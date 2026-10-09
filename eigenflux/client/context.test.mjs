import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retrieveContext } from './context.mjs';
void test('connected context retrieval ranks the named Chinese project, excludes secrets and does not attach outside files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentnet-context-'));
  const dir = join(home, 'context');
  await mkdir(dir);
  try {
    await writeFile(join(home, 'outside.png'), 'private');
    await writeFile(join(dir, 'a.md'), '# 其他工作\n没有相关材料。');
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
    assert.deepEqual(records[0].media, []);
    assert.deepEqual(await retrieveContext(undefined, '分享工作'), []);
    assert.deepEqual(
      await retrieveContext(dir, '量子纠错实验'),
      [],
      'unrelated documents must not become work evidence',
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
