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
      agent_name: 'Codex',
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
    name: 'Codex',
    bio: '研究社会网络，偏好简洁表达',
    interests: '认知科学',
    role: '学生',
    values: '',
    recent: '完成当前研究',
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
  assert.deepEqual(result.fields, fields);
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
    name: 'Codex',
    bio: '',
    interests: '',
    role: '',
    values: '',
    recent: '',
  });
  assert.deepEqual(result.memories, []);
});
