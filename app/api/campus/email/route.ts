import { z } from 'zod';
import { body, respond, service, user } from '@/lib/world-http';
import { ownerCookie, sessionCookie } from '@/lib/campus-auth';
import { CAMPUS_EMAIL_DOMAINS, CampusEmailLogin, mailReady, sendCampusCode } from '@/lib/campus-email';
import { mailSettings } from '@/lib/world-runtime';
import { WorldError } from '@/lib/world-service';

export const dynamic = 'force-dynamic';
const command = z.discriminatedUnion('op', [
  z.object({ op: z.literal('send'), email: z.string().max(254), bind: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('verify'), ticket: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^\d{6}$/), bind: z.boolean().default(false) }).strict(),
]);
export async function GET() { return respond(async () => ({ ready: mailReady(mailSettings()), domains: CAMPUS_EMAIL_DOMAINS })); }
export async function POST(request: Request) {
  let token: string | undefined;
  const response = await respond(async () => {
    const c = command.parse(await body(request, true)), world = service(), login = new CampusEmailLogin(world.db);
    let binding;
    if (c.bind) {
      const account = await user(request, world);
      if (account.authMode === 'email') throw new WorldError(409, '当前角色已经绑定邮箱。');
      const row = await world.row(account.id);
      binding = { owner: account.id, keyHash: row.owner_key_hash };
    }
    if (c.op === 'send') {
      const settings = mailSettings();
      if (!mailReady(settings)) throw new WorldError(503, '校园邮箱登录正在准备中，请等待管理员开通邮件服务。');
      return login.start(c.email, (email, code, hash) => sendCampusCode(settings, email, code, hash), binding);
    }
    const result = await login.finish(c.ticket, c.code, binding);
    token = result.token;
    return { ok: true };
  });
  if (response.ok && token) {
    response.headers.append('Set-Cookie', sessionCookie(token, request));
    response.headers.append('Set-Cookie', ownerCookie('signed_out', request));
  }
  return response;
}
