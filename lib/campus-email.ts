import { tokenHash, WorldError } from './world-service.ts';

export const CAMPUS_EMAIL_DOMAINS = ['smail.nju.edu.cn', 'nju.edu.cn'];
export const SESSION_SECONDS = 30 * 86400;
export function secret() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function campusEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email) || !CAMPUS_EMAIL_DOMAINS.includes(email.split('@')[1]))
    throw new WorldError(400, '请填写完整的南大邮箱：@smail.nju.edu.cn 或 @nju.edu.cn。');
  return email;
}
export type MailSettings = { apiKey?: string; from?: string };
export function mailReady(settings: MailSettings) { return !!(settings.apiKey && settings.from); }
export async function sendCampusCode(settings: MailSettings, email: string, code: string, ticketHash: string) {
  if (!mailReady(settings)) throw new WorldError(503, '校园邮箱登录正在准备中，请等待管理员开通邮件服务。');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `campus-login/${ticketHash}` },
      body: JSON.stringify({ from: settings.from, to: [email], subject: 'CodexNet 校园邮箱验证码', text: `你的校园邮箱验证码是：${code}\n\n10 分钟内有效，只能使用一次。用于登录或绑定你的校园角色，请勿提供给他人或 Agent。\n如果不是你本人操作，请忽略此邮件。\n\nCodexNet 校园世界（独立项目，非学校统一身份认证）` }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('delivery');
  } catch { throw new WorldError(503, '验证码暂时发送失败，请稍后重试或联系管理员。'); }
}
type Challenge = { email: string; bind_owner: string | null; bind_key_hash: string | null; code_hash: string };
type Binding = { owner: string; keyHash: string | null };

export class CampusEmailLogin {
  readonly db: D1Database;
  private now: () => number;
  constructor(db: D1Database, now = () => Date.now()) { this.db = db; this.now = now; }
  private async limit(bucket: string, max: number, expires: number) {
    const result = await this.db.prepare('INSERT INTO campus_registration_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?').bind(bucket, expires, max).run();
    if (result.meta.changes !== 1) throw new WorldError(429, '验证码请求过于频繁，请稍后再试。');
  }
  async start(value: string, send: (email: string, code: string, ticketHash: string) => Promise<void>, binding?: Binding) {
    const email = campusEmail(value), now = this.now(), emailHash = await tokenHash(email);
    await this.db.batch([
      this.db.prepare('DELETE FROM campus_registration_limits WHERE expires_at<=?').bind(now),
      this.db.prepare('DELETE FROM campus_email_challenges WHERE expires_at<=?').bind(now),
      this.db.prepare('DELETE FROM campus_sessions WHERE expires_at<=?').bind(now),
    ]);
    // Timestamp-based cooldown cannot be bypassed by straddling a minute boundary.
    await this.limit('email-cooldown:' + emailHash, 1, now + 60000);
    await this.limit(`email-hour:${emailHash}:${Math.floor(now / 3600000)}`, 6, now + 3600000);
    await this.limit(`email-global:${Math.floor(now / 3600000)}`, 100, now + 3600000);
    const ticket = secret(), ticketHash = await tokenHash(ticket);
    // Rejection sampling avoids modulo bias in the six-digit code.
    let number: number; do { number = crypto.getRandomValues(new Uint32Array(1))[0]; } while (number >= 4294000000);
    const code = String(number % 1000000).padStart(6, '0'), expiresAt = now + 600000;
    // Only the browser has the ticket; a DB-only leak cannot brute-force a code hash.
    await this.db.prepare('INSERT INTO campus_email_challenges(ticket_hash,email,code_hash,bind_owner,bind_key_hash,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(ticketHash, email, await tokenHash(ticket + ':' + code), binding?.owner ?? null, binding?.keyHash ?? null, expiresAt).run();
    try { await send(email, code, ticketHash); }
    catch (error) { await this.db.prepare('DELETE FROM campus_email_challenges WHERE ticket_hash=?').bind(ticketHash).run(); throw error; }
    return { ticket, expiresAt, retryAfter: 60 };
  }
  async finish(ticket: string, code: string, binding?: Binding) {
    const fail = () => new WorldError(400, '验证码无效、已使用或已过期，请重新获取。');
    if (!/^[a-f0-9]{64}$/.test(ticket) || !/^\d{6}$/.test(code)) throw fail();
    const now = this.now(), ticketHash = await tokenHash(ticket);
    const challenge = await this.db.prepare('UPDATE campus_email_challenges SET attempts=attempts+1 WHERE ticket_hash=? AND expires_at>? AND attempts<5 AND consumed_by IS NULL RETURNING email,bind_owner,bind_key_hash,code_hash').bind(ticketHash, now).first<Challenge>();
    if (!challenge) throw fail();
    if (challenge.bind_owner && (binding?.owner !== challenge.bind_owner || binding.keyHash !== challenge.bind_key_hash))
      throw new WorldError(401, '绑定身份已变化，请回到原角色重新绑定邮箱。');
    if (await tokenHash(ticket + ':' + code) !== challenge.code_hash) throw fail();
    const token = secret(), hash = await tokenHash(token), owner = challenge.bind_owner ?? 'email:' + crypto.randomUUID();
    const proof = 'SELECT 1 FROM campus_email_challenges WHERE ticket_hash=? AND consumed_by=?';
    const bindingGuard = challenge.bind_owner ? ' AND EXISTS(SELECT 1 FROM campus_characters WHERE owner_id=? AND owner_key_hash IS ?)' : '';
    const consumeValues: (string | number | null)[] = [hash, ticketHash, now];
    if (challenge.bind_owner) consumeValues.push(challenge.bind_owner, challenge.bind_key_hash);
    await this.db.batch([
      this.db.prepare('UPDATE campus_email_challenges SET consumed_by=? WHERE ticket_hash=? AND consumed_by IS NULL AND expires_at>?' + bindingGuard).bind(...consumeValues),
      this.db.prepare(`INSERT INTO campus_accounts(owner_id,email,created_at) SELECT ?,?,? WHERE EXISTS(${proof}) ON CONFLICT DO NOTHING`).bind(owner, challenge.email, now, ticketHash, hash),
      this.db.prepare(`INSERT INTO campus_sessions(token_hash,owner_id,expires_at) SELECT ?,owner_id,? FROM campus_accounts WHERE email=? AND (? IS NULL OR owner_id=?) AND EXISTS(${proof})`).bind(hash, now + SESSION_SECONDS * 1000, challenge.email, challenge.bind_owner, owner, ticketHash, hash),
      // Revise the row so an in-flight legacy write cannot resurrect the recovery key.
      this.db.prepare('UPDATE campus_characters SET owner_key_hash=NULL,revision=revision+1 WHERE owner_id=? AND EXISTS(SELECT 1 FROM campus_sessions WHERE token_hash=? AND owner_id=?)').bind(owner, hash, owner),
    ]);
    const session = await this.session(token);
    if (!session) throw new WorldError(409, '邮箱或角色已经绑定其他账号，未合并或覆盖任何经历。请用已绑定邮箱登录。');
    return { token, account: session };
  }
  async session(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare('SELECT a.owner_id AS id,a.email AS account FROM campus_sessions s JOIN campus_accounts a ON a.owner_id=s.owner_id WHERE s.token_hash=? AND s.expires_at>?').bind(await tokenHash(token), this.now()).first<{ id: string; account: string }>();
  }
  async revoke(token: string) { await this.db.prepare('DELETE FROM campus_sessions WHERE token_hash=?').bind(await tokenHash(token)).run(); }
}
