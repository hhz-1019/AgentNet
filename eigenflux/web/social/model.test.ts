import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  publicGraphPosts,
  relatedPeers,
  shareReceipt,
} from './work-network-model.ts';
import {
  matches,
  qualityCheck,
  parseTags,
  interestTagsFromCard,
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
void test('work graph excludes private and friend posts, matches real capability tags and excludes self', () => {
  const privatePost = { ...post, id: '2', visibility: 'private' as const };
  const friendPost = { ...post, id: '3', visibility: 'friends' as const };
  const draft = { ...post, id: '4', state: 'draft' as const };
  assert.deepEqual(
    publicGraphPosts([privatePost, friendPost, draft, post], ['React']),
    [post],
  );
  const peer = {
    agent_id: '7',
    short_id: 'P',
    agent_name: '测试 Agent',
    agent_description: '',
    capabilities: ['react'],
    is_friend: false,
    friend_request_pending: false,
    show_add_friend: false,
    rule_key: 'test',
  };
  assert.deepEqual(
    relatedPeers(
      post,
      [
        peer,
        { ...peer, agent_id: post.agent_id },
        { ...peer, agent_id: 'owner' },
        { ...peer, agent_id: '8', capabilities: ['React Native'] },
      ],
      'owner',
    ).map((p) => p.peer.agent_id),
    ['7'],
  );
});
void test('sharing completion requires explicit execution and an exact valid post ID; demos never report publication', () => {
  const command = {
    id: '9',
    instruction: '分享论文',
    status: 'completed',
    result: {},
    created_at: 1,
  };
  assert.equal(shareReceipt(command).postId, '');
  assert.equal(
    shareReceipt({
      ...command,
      result: { execution: 'model_analysis', post_id: post.id },
    }).postId,
    '',
  );
  assert.equal(
    shareReceipt({
      ...command,
      status: 'claimed',
      result: { execution: 'shared', post_id: post.id },
    }).postId,
    '',
  );
  for (const post_id of [0, '0', '-1', '1e3', '../private', ''])
    assert.equal(
      shareReceipt({ ...command, result: { execution: 'shared', post_id } })
        .postId,
      '',
    );
  const published = {
    ...command,
    result: { execution: 'shared', post_id: post.id },
  };
  assert.equal(shareReceipt(published).postId, post.id);
  assert.equal(shareReceipt(published, true).postId, '');
  assert.equal(shareReceipt({ ...command, status: 'failed' }).terminal, true);
  assert.equal(shareReceipt({ ...command, status: 'pending' }).terminal, false);
});
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

void test('hosted image references and actionable quality guidance', () => {
  assert.deepEqual(
    validate({
      ...doc,
      media: [
        {
          url: '/api/v2/console/social/media/9223372036854775001',
          alt: '工作截图',
          kind: 'image',
        },
      ],
    }),
    [],
  );
  assert.ok(
    validate({
      ...doc,
      media: [
        {
          url: '/api/v2/console/social/media/1?public=true',
          alt: '工作截图',
          kind: 'image',
        },
      ],
    }).length,
  );
  const suggestions = qualityCheck({
    ...doc,
    title: '震撼的成果发布',
    kind: 'question',
  });
  assert.ok(suggestions.some((x) => x.key === 'specificity'));
  assert.ok(suggestions.some((x) => x.key === 'question'));
});
void test('card interests stay within recommendation API tag limits', () => {
  assert.deepEqual(
    interestTagsFromCard({
      offering: ['Agent 工程，产品设计', '过长描述'.repeat(10)],
      seeking: ['React; Agent 工程'],
    }),
    ['Agent 工程', '产品设计', 'React'],
  );
  assert.equal(
    interestTagsFromCard({
      offering: Array.from({ length: 12 }, (_, i) => `话题${i}`),
    }).length,
    8,
  );
});
void test('Chinese sharing intent grants publishing only for an actual sharing request', async () => {
  const { requestsSharing } = await import('./model.ts');
  for (const text of [
    '把论文工作分享一下',
    '请整理社会模拟项目并发布',
    '帮我发个帖子',
    '分享一下这个工作',
  ])
    assert.equal(requestsSharing(text), true, text);
  for (const text of [
    '不要发布，先给我看看草稿',
    '帮我发现相关工作',
    '查找分享论文的方法',
    '暂不公开这个项目',
  ])
    assert.equal(requestsSharing(text), false, text);
});
void test('old English deployment descriptions are displayed in Chinese without inventing translations', async () => {
  const { chineseDescription } = await import('../chinese.ts');
  assert.equal(
    chineseDescription(
      'Real local test instruction processed',
      '未提供中文版本',
    ),
    '已处理真实的本地测试指令',
  );
  assert.equal(
    chineseDescription('Acceptance Atlas 1790370074255', '我的 Agent'),
    '验收测试 Agent 1790370074255',
  );
  assert.equal(
    chineseDescription(
      'An unknown long English description',
      '尚未提供中文介绍',
    ),
    '尚未提供中文介绍',
  );
  assert.equal(
    chineseDescription('使用 React 构建的工作台', ''),
    '使用 React 构建的工作台',
  );
});
