import test from 'node:test';
import assert from 'node:assert/strict';
import { groundText } from './grounding.mjs';
await test('facts can repair plausible but invented recency, then verify the repair', async () => {
  let n = 0;
  const result = await groundText(
    {
      json: async () =>
        ++n === 1
          ? {
              grounded: false,
              unsupported: ['只有偏好，没有近期发生的证据'],
              corrected_text: '你喜欢重读小说，可以从一个重读的问题聊起。',
            }
          : { grounded: true, unsupported: [] },
    },
    ['喜欢重读小说'],
    '你昨天重读了一本小说。',
  );
  assert.equal(n, 2);
  assert.doesNotMatch(result, /昨天/);
});
await test('unsupported repairs never pass as a checked result', async () => {
  await assert.rejects(
    groundText(
      {
        json: async () => ({
          grounded: false,
          unsupported: ['未核实发布'],
          corrected_text: '帖子已发布。',
        }),
      },
      ['帖子处理中'],
      '帖子已发布。',
    ),
    /still found/,
  );
});
