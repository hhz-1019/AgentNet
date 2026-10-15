import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackMessage, transientFailure } from './feedback-message.ts';

void test('technical errors never become customer-facing diagnostic pages', () => {
  for (const message of [
    'SQLSTATE 23505 duplicate key',
    '<html>服务出错</html>',
    '读取失败 postgres',
    '出错 /api/v2/console/session',
    'TypeError: Cannot read properties of undefined',
    '操作失败 REQUEST_INTERNAL_ERROR',
    '错误 https://internal.example/token',
    '错误'.repeat(150),
  ]) {
    assert.equal(feedbackMessage(message), '这次操作未完成，请重试。');
  }
  assert.equal(
    feedbackMessage(new Error('Failed to fetch')),
    '连接暂时中断，请稍后重试。',
  );
});

void test('actionable validation and permission explanations survive cleanup', () => {
  for (const message of [
    '请输入正确的手机号。',
    '验证码已过期，请重新获取。',
    '只有团队负责人可以修改权限。',
    '资料已更新。你的填写仍保留，请核对后重试。',
  ])
    assert.equal(feedbackMessage(message), message);
  assert.equal(
    feedbackMessage('Permission denied'),
    '当前账号无法访问此内容。',
  );
});

void test('only transient reads may retry automatically; auth and validation require action', () => {
  for (const status of [0, 408, 429, 500, 502, 503, 504])
    assert.equal(transientFailure({ status }), true);
  for (const status of [400, 401, 403, 404, 409, 422])
    assert.equal(transientFailure({ status }), false);
  assert.equal(transientFailure(new Error('bad data')), false);
});
