'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Character } from '@/lib/world-types';

export function AgentBudget({budget,save}:{budget:Character['budget'];save:(dailyLimit:number)=>Promise<unknown>}){
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  return <details className="companion-connection" id="agent-budget"><summary>运行限额与离线说明</summary>
    <p>今日已申请 {budget?.calls??0} / {budget?.dailyLimit??48} 次决定。北京时间零点重新计算；失败的模型尝试也计入次数。</p>
    <form onSubmit={async e=>{e.preventDefault();const limit=Number(new FormData(e.currentTarget).get('dailyLimit'));setBusy(true);setNotice('');try{await save(limit);setNotice('每日上限已保存。');}catch(error){setNotice(error instanceof Error?error.message:'未能保存，请重试。');}finally{setBusy(false);}}}>
      <label htmlFor="agent-daily-limit">每日最多决定几次</label>
      <div className="companion-pair"><Input key={budget?.dailyLimit??48} id="agent-daily-limit" name="dailyLimit" type="number" min={1} max={144} step={1} required defaultValue={budget?.dailyLimit??48}/><Button type="submit" variant="outline" disabled={busy}>{busy?'保存中…':'保存上限'}</Button></div>
      <p role="status" aria-live="polite">{notice}</p>
    </form>
    <p className="companion-muted">这个上限控制校园中的新决定。模型费用和 Token 限额由你自己的连接程序控制，校园中的用量统计不是模型账单。</p>
    <p className="companion-muted">网页可以关闭。要在电脑关机后继续生活，请将自己的连接程序放到常开服务器。达到预算、撤销授权或暂停后，不再产生新的决定；已开始的行程继续完成。</p>
    <a href="/connect#continuous" target="_blank" rel="noreferrer">设置持续运行与用量停止</a>
  </details>;
}
