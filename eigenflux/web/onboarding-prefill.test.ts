import test from 'node:test';
import assert from 'node:assert/strict';
import { prefillPortrait } from './onboarding-prefill.ts';
const blank = () => ({
  fields: {
    name: '',
    bio: '',
    interests: '',
    role: '',
    values: '',
    recent: '',
  },
  visible: ['name', 'bio', 'interests'] as ('name' | 'bio' | 'interests')[],
  memories: [],
  revision: 0,
});
await test('legacy memory prefill survives empty modern placeholders', () => {
  const draft = {
    identity_card: {
      agent_name: '未命名',
      agent_description: '通用助手',
      human_description: '研究社会网络，偏好简洁表达',
    },
    network_goal: '完成当前研究',
    twin_profile: {
      basic_info: { interests: '认知科学', role: '学生' },
      episodes: [{ id: 'legacy', content: '完成一次研究实验' }],
      portrait: {
        fields: {
          name: '',
          bio: '',
          interests: '',
          role: '',
          values: '',
          recent: '',
        },
        memories: [],
      },
    },
  };
  const result = prefillPortrait(blank(), draft, 'Codex');
  assert.deepEqual(result.fields, {
    name: '',
    bio: '研究社会网络，偏好简洁表达',
    interests: '认知科学',
    role: '学生',
    values: '',
    recent: '',
    connections: '完成当前研究',
    avatar: '',
  });
  assert.equal(result.memories[0].content, '完成一次研究实验');
  assert.equal(result.memories[0].showOnHome, false);
});
await test('modern portrait wins field by field while memories stay private', () => {
  const fields = {
    name: '昵称',
    bio: '支持的简介',
    interests: '音乐',
    role: '设计师',
    values: '清晰表达',
    recent: '准备展览',
  };
  const result = prefillPortrait(
    blank(),
    {
      identity_card: { human_description: '旧介绍' },
      twin_profile: {
        portrait: {
          fields,
          memories: [{ id: 'm', content: '已知记忆', showOnHome: true }],
        },
      },
    },
    'Codex',
  );
  assert.deepEqual(result.fields, { ...fields, connections: '', avatar: '' });
  assert.equal(result.memories[0].showOnHome, false);
});
await test('saved human edits and deliberately cleared fields cannot be refilled', () => {
  const saved = { ...blank(), revision: 1 };
  assert.equal(
    prefillPortrait(
      saved,
      { twin_profile: { portrait: { fields: { bio: '覆盖本人' } } } },
      'Codex',
    ),
    saved,
  );
});
await test('absent memory never invents a personal biography', () => {
  const result = prefillPortrait(blank(), {}, 'Codex');
  assert.deepEqual(result.fields, {
    name: '',
    bio: '',
    interests: '',
    role: '',
    values: '',
    recent: '',
    avatar: '',
    connections: '',
  });
  assert.deepEqual(result.memories, []);
});
await test('custom Agent avatars survive review; unknown external URLs stay pending', () => {
  const draft = (avatar: string) => ({
    twin_profile: {
      portrait: { fields: { name: '朋友', interests: '音乐', avatar } },
    },
  });
  const custom = '/api/v2/public/avatars/' + 'a'.repeat(32);
  assert.equal(
    prefillPortrait(blank(), draft(custom), '').fields.avatar,
    custom,
  );
  assert.equal(
    prefillPortrait(blank(), draft('bloom'), '').fields.avatar,
    'bloom',
  );
  assert.equal(
    prefillPortrait(blank(), draft('https://example.com/pixel'), '').fields
      .avatar,
    '',
  );
  const saved = {
    ...blank(),
    fields: { ...blank().fields, avatar: 'orbit' },
    revision: 1,
  };
  assert.equal(
    prefillPortrait(saved, draft('bloom'), '').fields.avatar,
    'orbit',
  );
});

await test('Agent capability descriptions cannot fill a personal portrait; connection goals never fill recent events', () => {
  const p = prefillPortrait(
    blank(),
    {
      identity_card: { agent_description: '我会查资料和推进任务' },
      network_goal: '寻找可以一起慢慢聊书的人',
    },
    '林间',
  );
  assert.equal(p.fields.bio, '');
  assert.equal(p.fields.recent, '');
  assert.equal(p.fields.connections, '寻找可以一起慢慢聊书的人');
});

await test('merging old private preferences and roles preserves content without widening visibility', async () => {
  const { mergeLegacyPortrait } = await import('./portrait-merge.ts');
  const original = {
    ...blank(),
    fields: {
      ...blank().fields,
      bio: '伙伴简介',
      interests: '已有兴趣',
      values: '不愿公开的偏好',
      role: '私人身份',
    },
  };
  const merged = mergeLegacyPortrait(original);
  assert.equal(merged.fields.interests, '已有兴趣\n\n不愿公开的偏好');
  assert.equal(merged.fields.bio, '伙伴简介\n\n私人身份');
  assert(!merged.visible.includes('interests'));
  assert(!merged.visible.includes('bio'));
  assert.equal(original.fields.interests, '已有兴趣');
  assert.deepEqual(mergeLegacyPortrait(merged), merged);
  const edited = {
    ...merged,
    fields: { ...merged.fields, interests: '主人修改后的兴趣' },
  };
  assert.equal(
    mergeLegacyPortrait(edited).fields.interests,
    '主人修改后的兴趣',
  );
});
