'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CampusEmailLogin({ bind = false, onDone }: { bind?: boolean; onDone: () => Promise<unknown> }) {
  const id = useId();
  const codeInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(''), [code, setCode] = useState('');
  const [ticket, setTicket] = useState(''), [cooldown, setCooldown] = useState(0);
  const [ready, setReady] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/campus/email', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('状态读取失败');
      const data = await response.json() as { ready?: boolean }; setReady(data.ready === true);
    }).catch(() => { if (!controller.signal.aborted) setError('暂时无法连接校园，请刷新后重试。'); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => { if (ticket) codeInput.current?.focus(); }, [ticket]);
  async function submit(verify: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/campus/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verify ? { op: 'verify', ticket, code, bind } : { op: 'send', email, bind }), signal: AbortSignal.timeout(20000),
      });
      const data = await response.json() as { error?: string; ticket: string; retryAfter: number };
      if (!response.ok) throw new Error(data.error ?? '暂时无法完成，请重试。');
      if (verify) { setTicket(''); setCode(''); await onDone(); }
      else { setTicket(data.ticket); setCode(''); setCooldown(data.retryAfter); }
    } catch (e) { setError(e instanceof Error ? e.message : '暂时无法完成，请重试。'); }
    finally { setBusy(false); }
  }
  return <section className="campus-email-login" aria-labelledby={id + '-title'}>
    <p className="companion-account">{bind ? '为旧角色绑定账号' : '你的校园账号'}</p>
    <h3 id={id + '-title'}>{bind ? '绑定邮箱，留住这段校园日常' : '用校园邮箱，回到自己的世界'}</h3>
    <p className="companion-muted">{bind ? '保留当前角色、私聊和经历。绑定后用邮箱登录，旧恢复密钥将失效。' : '首次登录自动注册。换设备也能继续同一个角色的经历。'}</p>
    <form className="campus-email-form" onSubmit={e => { e.preventDefault(); void submit(!!ticket); }}>
      <label htmlFor={id + '-email'}>校园邮箱</label>
      <Input id={id + '-email'} type="email" autoComplete="email" inputMode="email" placeholder="学号@smail.nju.edu.cn" value={email} onChange={e => setEmail(e.target.value)} readOnly={!!ticket} disabled={busy} required maxLength={254} aria-describedby={id + '-domains'}/>
      <p id={id + '-domains'} className="companion-muted">支持 @smail.nju.edu.cn 和 @nju.edu.cn</p>
      {ticket && <><output className="companion-muted">验证码已发送至 {email.trim()}，10 分钟内有效。未收到请检查垃圾邮件。</output><label htmlFor={id + '-code'}>邮件中的六位验证码</label><Input ref={codeInput} id={id + '-code'} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required disabled={busy}/></>}
      {ready === false && <output className="campus-email-status">{bind ? '邮箱绑定正在准备中，管理员尚未开通邮件服务。你的旧角色仍可继续使用。' : '邮箱登录正在准备中，管理员尚未开通邮件服务。你仍可以浏览校园；已有角色可通过下方旧版入口进入。'}</output>}
      {ready === null && !error && <output className="companion-muted">正在检查邮件服务…</output>}
      {error && <p className="companion-error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || ready !== true || !email.trim() || (!!ticket && code.length !== 6) || (!ticket && cooldown > 0)}><Mail size={16}/>{busy ? '正在处理…' : ticket ? (bind ? '验证并绑定当前角色' : '验证并登录') : cooldown ? `${cooldown} 秒后可重新发送` : '发送验证码'}</Button>
      {ticket && <div className="companion-management"><Button type="button" variant="ghost" disabled={busy || cooldown > 0} onClick={() => void submit(false)}>{cooldown ? `${cooldown} 秒后可重发` : '重新发送验证码'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setTicket(''); setCode(''); setError(''); }}>更换邮箱</Button></div>}
    </form>
    <p className="companion-muted">{bind ? '邮箱不会公开给其他角色，也不会提供给接入的 Agent。' : '只验证邮箱归属，无需校园邮箱密码。此账号属于 CodexNet，非学校统一身份认证。'}</p>
  </section>;
}
