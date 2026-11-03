import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  deliveryFiles,
  materializeDelivery,
} from './collaboration-delivery.mjs';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><text>中文海报</text></svg>';
function envelope(text = svg) {
  const bytes = Buffer.from(text);
  return {
    kind: 'text',
    text: JSON.stringify({
      format: 'elsewhere-svg-delivery-v1',
      files: [
        {
          name: '../../escape.svg',
          encoding: 'gzip+base64',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          data: gzipSync(bytes).toString('base64'),
        },
      ],
    }),
  };
}
void test('bounded decoding verifies integrity and ignores remote paths', () => {
  const [file] = deliveryFiles(envelope());
  assert.equal(file.name, 'file-1.svg');
  assert.equal(file.bytes.toString(), svg);
  const bad = envelope();
  const parsed = JSON.parse(bad.text);
  parsed.files[0].sha256 = '0'.repeat(64);
  bad.text = JSON.stringify(parsed);
  assert.throws(() => deliveryFiles(bad), /integrity/);
  assert.throws(
    () => deliveryFiles(envelope('<svg><script>alert(1)</script></svg>')),
    /Unsafe/,
  );
  assert.throws(
    () =>
      deliveryFiles(
        envelope('<svg><image href="https://tracker.test/x"/></svg>'),
      ),
    /Unsafe/,
  );
});
void test('exact accepted version is materialized across pages and opens only once', async () => {
  const cliHome = await mkdtemp(join(tmpdir(), 'delivery-'));
  const project = {
    project_id: 'p',
    version: 8,
    state: 'completed',
    goal: '中文项目',
    tasks: {
      t: {
        task_id: 't',
        title: '海报',
        state: 'accepted_result',
        artifact_version: 2,
      },
    },
  };
  const client = {
    cliHome,
    endpoint: 'https://example.test',
    collaboration_context: async ({ cursor }) => ({
      project,
      artifacts: cursor
        ? [{ ...envelope(), task_id: 't', version: 2 }]
        : [
            {
              kind: 'text',
              text: 'WRONG OLD RESULT',
              task_id: 't',
              version: 1,
            },
          ],
      has_more: !cursor,
      next_cursor: 1,
    }),
  };
  let opened = 0;
  const options = {
    notify: true,
    opener: async (path) => {
      assert.match(await readFile(path, 'utf8'), /中文项目/);
      opened++;
    },
  };
  const first = await materializeDelivery(client, 'p', options);
  assert.equal(first.notification, 'opened');
  assert.equal(first.files.length, 1);
  assert.equal(await readFile(first.files[0].path, 'utf8'), svg);
  const second = await materializeDelivery(client, 'p', options);
  assert.equal(second.notification, 'already_opened');
  assert.equal(opened, 1);
  project.tasks.t.artifact_version = 3;
  await assert.rejects(materializeDelivery(client, 'p'), /missing/);
});
void test('opener failure is retryable; text is escaped; URL is never auto-fetched', async () => {
  const cliHome = await mkdtemp(join(tmpdir(), 'delivery-'));
  const project = {
    project_id: 'p',
    version: 1,
    goal: 'test',
    state: 'completed',
    tasks: {
      t: {
        task_id: 't',
        title: '结果',
        state: 'accepted_result',
        artifact_version: 1,
      },
    },
  };
  let artifact = {
    kind: 'text',
    text: '<script>bad()</script>',
    task_id: 't',
    version: 1,
  };
  const client = {
    cliHome,
    endpoint: 'https://example.test',
    collaboration_context: async () => ({ project, artifacts: [artifact] }),
  };
  const failed = await materializeDelivery(client, 'p', {
    notify: true,
    opener: async () => {
      throw Error('no GUI');
    },
  });
  assert.equal(failed.notification, 'open_failed');
  assert.match(await readFile(failed.page, 'utf8'), /&lt;script&gt;/);
  assert.equal(
    (
      await materializeDelivery(client, 'p', {
        notify: true,
        opener: async () => {},
      })
    ).notification,
    'opened',
  );
  artifact = { ...artifact, kind: 'https', uri: 'https://example.test/result' };
  const linked = await materializeDelivery(client, 'p');
  assert.equal(linked.files[0].verifiedDownload, false);
});
