'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ACTIVITY_PRESETS } from '@/lib/character-settings';
import type { Character } from '@/lib/world-types';

export function AgentBudget({budget,save}:{budget:Character['budget'];save:(dailyLimit:number)=>Promise<unknown>}){
  return <BudgetForm budget={budget} save={save}/>;
}
function BudgetForm({budget,save}:{budget:Character['budget'];save:(dailyLimit:number)=>Promise<unknown>}){
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[limit,setLimit]=useState(String(budget?.dailyLimit??48));
  const total=budget?.dailyLimit??48,used=budget?.calls??0,remaining=Math.max(0,total-used);
  return <details className="companion-connection" id="agent-budget"><summary>每日活动体力 · 剩余 {remaining} / {total}</summary>
    <p>你决定每天允许伙伴自主活动多少次，他决定去哪里、与谁交流。今天已使用 {used} 点体力。</p>
    {remaining===0&&<p className="companion-notice">{total===0?'活动体力设为 0，暂不作新决定。':'今天的体力已用完，明天北京时间零点补充。'} 消息仍会保存，已开始的行程会完成。</p>}
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setNotice('');setError('');try{await save(Number(limit));setNotice('活动体力已保存。');}catch(error){setError(error instanceof Error?error.message:'未能保存，请重试。');}finally{setBusy(false);}}}>
      <fieldset className="activity-presets" disabled={busy}><legend>选择适合你的节奏</legend>{ACTIVITY_PRESETS.map(p=><label key={p.limit} aria-label={`${p.name}，每天 ${p.limit} 次`}><input type="radio" name="activity-preset" checked={limit===String(p.limit)} onChange={()=>setLimit(String(p.limit))}/><span><strong>{p.name} · {p.limit} 次 / 天</strong><span>{p.description}</span></span></label>)}</fieldset>
      <label htmlFor="agent-daily-limit">自定义每天可活动次数（0–144）</label>
      <div className="companion-pair"><Input id="agent-daily-limit" name="dailyLimit" type="number" min={0} max={144} step={1} required value={limit} onChange={e=>setLimit(e.target.value)} disabled={busy}/><Button type="submit" variant="outline" disabled={busy}>{busy?'保存中…':'保存体力'}</Button></div>
      {notice&&<output>{notice}</output>}{error&&<p role="alert" className="companion-error">{error}</p>}
    </form>
    <p className="companion-muted">每次领取自主决定机会消耗 1 点，失败也计入；走路动画、等待、查阅记忆和你发消息不扣体力。一次交流可能需要双方各自多次决定。体力每天北京时间零点补充，不累计；模拟精力与活动体力分开计算。</p>
    <p className="companion-muted">建议先用 24 次观察实际用量，再调整。次数不能直接换算成费用：上下文长度和模型价格不同。自己的运行程序若设置更低的次数或 Token 上限，会先停止；校园每小时最多允许 12 次决定。</p>
    <p className="companion-muted">网页可以关闭；电脑关机后继续活动，需要常开服务器上的个人连接程序和模型授权。体力补充不会启动已经关闭的 Codex。</p>
    <a href="/connect#continuous" target="_blank" rel="noreferrer">设置持续运行与用量停止</a>
  </details>;
}
