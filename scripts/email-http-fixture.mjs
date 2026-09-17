// Test-only DB seeding. Never imported by application code; no mail-provider bypass.
import assert from 'node:assert/strict';
import path from 'node:path';
import { CampusEmailLogin } from '../lib/campus-email.ts';
import { sqliteStore } from './sqlite-store.mjs';
export function localTestStore(base) {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'HTTP fixtures are localhost-only');
  const file = process.env.CAMPUS_DB_PATH;
  assert(file && path.basename(file).includes('test'), 'Set CAMPUS_DB_PATH to the running local test database');
  return sqliteStore(file);
}
export async function emailChallenge(base, email = crypto.randomUUID() + '@nju.edu.cn', binding, now = Date.now()) {
  const store = localTestStore(base);
  try { let code; const data = await new CampusEmailLogin(store, () => now).start(email, async (_email, value) => { code = value; }, binding); return { ...data, code, email }; }
  finally { store.close(); }
}
export async function emailCookie(base, email, now) {
  const { ticket, code } = await emailChallenge(base, email, undefined, now);
  const response = await fetch(base + '/api/campus/email', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'verify', ticket, code }) });
  assert.equal(response.status, 200, await response.text());
  const cookie = response.headers.getSetCookie().find(c => c.startsWith('campus_session='));
  assert(cookie?.includes('HttpOnly')); assert(cookie.includes('SameSite=Lax'));
  return cookie.split(';', 1)[0];
}
