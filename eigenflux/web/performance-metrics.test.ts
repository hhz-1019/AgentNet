import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performanceRoute } from './performance-metrics.ts';
void test('performance telemetry groups routes without disclosing personal paths', () => {
  assert.equal(performanceRoute('/dashboard/person/123456'), 'person');
  assert.equal(
    performanceRoute('/dashboard', '#messages/secret-conversation'),
    'messages',
  );
  assert.equal(
    performanceRoute('/onboarding/profile?phone=private'),
    'onboarding',
  );
});
