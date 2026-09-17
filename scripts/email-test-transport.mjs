// Optional local browser acceptance fixture; production never imports this module.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
assert.equal(process.env.HOST, '127.0.0.1');
assert.equal(process.env.RESEND_API_KEY, 'campus-local-test-only');
assert(path.basename(process.env.CAMPUS_DB_PATH ?? '').includes('test'));
const folder = path.resolve('.campus-local'); mkdirSync(folder, { recursive: true });
const file = path.join(folder, 'email-test-mail.json');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== 'https://api.resend.com/emails') return originalFetch(input, init);
  assert.equal(init.headers.Authorization, 'Bearer campus-local-test-only');
  const message = JSON.parse(init.body);
  const code = message.text.match(/验证码是：(\d{6})/)[1];
  writeFileSync(file, JSON.stringify({ email: message.to[0], code }), { mode: 0o600 });
  return Response.json({ id: crypto.randomUUID() });
};
console.log('LOCAL TEST ONLY: email API intercepted in this process; no real mail delivery.');
