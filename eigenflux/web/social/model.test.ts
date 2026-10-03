import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matches,
  parseTags,
  preflight,
  validate,
  type WorkDocument,
  type WorkPost,
} from './model.ts';
const doc: WorkDocument = {
  title: '一次具体工作的复盘',
  summary: '这是一份可以接着做的工作成果说明。',
  body: '我们记录了任务的背景、具体做法、结果与复现步骤，同时明确哪些结论仍然需要继续验证。',
  kind: 'result',
  tags: ['React', 'Agent 工程'],
  source: '开发任务记录',
  evidence: '复现步骤与已验证的边界',
  identity: 'human',
  project_name: '',
  media: [],
};
const post: WorkPost = {
  id: '9223372036854775000',
  agent_id: '9223372036854775001',
  author_name: 'Agent',
  state: 'published',
  revision: 1,
  visibility: 'public',
  document: doc,
  created_at: 1,
  published_at: 1,
  likes: 0,
  saves: 0,
  comments: 0,
  liked: false,
  saved: false,
};
void test('search and multi-tag filters form an intersection', () => {
  assert.ok(
    matches(post, {
      scope: 'all',
      kind: 'result',
      q: '复盘',
      tags: ['React', 'Agent 工程'],
    }),
  );
  assert.equal(
    matches(post, {
      scope: 'all',
      kind: 'all',
      q: '',
      tags: ['React', '不存在'],
    }),
    false,
  );
  assert.equal(
    matches(post, { scope: 'all', kind: 'question', q: '', tags: [] }),
    false,
  );
});
void test('tags preserve useful labels and remove exact duplicates', () =>
  assert.deepEqual(parseTags(' #React，Agent 工程,React\n'), [
    'React',
    'Agent 工程',
  ]));
void test('credential preflight blocks secrets; private information requires manual review', () => {
  assert.ok(
    preflight({ ...doc, body: doc.body + ' api_key=abcdefghijk12345' }).blocked
      .length,
  );
  assert.ok(
    preflight({ ...doc, body: doc.body + ' https://192.168.1.1/test' }).warnings
      .length,
  );
  assert.equal(preflight(doc).blocked.length, 0);
});
void test('quality requirements accept concrete work and reject empty provenance', () => {
  assert.deepEqual(validate(doc), []);
  assert.ok(
    validate({ ...doc, source: '', evidence: '', body: '空泛总结' }).length >=
      3,
  );
});
void test('project attribution and unsafe attachment links are checked', () => {
  assert.ok(validate({ ...doc, identity: 'project', project_name: '' }).length);
  for (const url of [
    'javascript:alert(1)',
    'http://example.com/x',
    'https://user:pass@example.com/x',
    '/social/../private',
  ])
    assert.ok(
      validate({ ...doc, media: [{ url, alt: 'image', kind: 'image' }] })
        .length,
    );
});
