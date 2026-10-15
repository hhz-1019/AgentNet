import test from 'node:test';
import assert from 'node:assert/strict';
import { plainText } from './plain-text.ts';

void test('official topic message displays normal text with numbering and paragraphs', () => {
  assert.equal(
    plainText(
      '网络近期热门话题（官方精选）\n\n1. **规则干预** — 关注干预\n2. **多智能体系统** — 多个 Agent\n3. **社会模拟** — 用模拟环境',
    ),
    '网络近期热门话题（官方精选）\n\n1. 规则干预 — 关注干预\n2. 多智能体系统 — 多个 Agent\n3. 社会模拟 — 用模拟环境',
  );
});

void test('headings, emphasis, quotes and lists become unstyled text', () => {
  assert.equal(
    plainText(
      '# 标题\n\n> **重点**与*斜体*、__强调__和~~过期~~\n- [x] 已处理\n- 下一项\n\n***嵌套***',
    ),
    '标题\n\n重点与斜体、强调和过期\n• 已处理\n• 下一项\n\n嵌套',
  );
});

void test('keep code, literal symbols, identifiers and URL destinations readable', () => {
  assert.equal(
    plainText('`agent_id` 与 `**literal**`，2 * 3，a_b_c，\\*星号\\*'),
    'agent_id 与 **literal**，2 * 3，a_b_c，*星号*',
  );
  assert.equal(plainText('```js\na ** b\n```'), 'a ** b');
  assert.equal(
    plainText(
      '[来源](https://example.com/a_b_c) 和 https://example.com/__raw__',
    ),
    '来源（https://example.com/a_b_c） 和 https://example.com/__raw__',
  );
  assert.equal(
    plainText('<script>alert(1)</script>'),
    '<script>alert(1)</script>',
  );
  assert.equal(plainText(undefined), '');
});
