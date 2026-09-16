'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WorldEvent } from '@/lib/world-types';
type Entry={id:string;at:number;kind:string;text:string};
export function CampusHistory({events}:{events:WorldEvent[]}){
  const [query,setQuery]=useState(''),[results,setResults]=useState<Entry[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const items=results??events.filter(e=>e.kind!=='human'&&e.kind!=='reply').reverse();
  return <><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/world/recall?query='+encodeURIComponent(query),{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('暂时无法检索，请稍后重试。');const data=await r.json() as {memories:Entry[]};setResults(data.memories);}catch(e){setError(e instanceof Error?e.message:'暂时无法检索。');}finally{setBusy(false);}}}>
    <label htmlFor="campus-history-query">找回以前的经历</label><div className="companion-pair"><Input id="campus-history-query" value={query} onChange={e=>setQuery(e.target.value)} maxLength={120} placeholder="输入地点、名字或话题"/><Button type="submit" variant="outline" disabled={busy}>{busy?'查找中…':'查找'}</Button></div>
    <p className="companion-muted">检索你自己的全部经历和亲历交谈，最多显示 12 条匹配记录。</p>
    {results&&<Button type="button" variant="ghost" onClick={()=>{setResults(null);setQuery('');}}>返回最近经历</Button>}
    {error&&<p className="companion-error" role="alert">{error}</p>}
  </form><div className="companion-life" aria-live="polite">{!items.length&&<p className="companion-empty">{results?'还没有匹配记录，试试其他关键词。':'还没有新的校园经历。'}</p>}{items.map(e=><article key={e.id}><div><time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time><span>{e.kind==='memory'?'主观记忆':e.kind==='conversation'?'亲历交谈':e.kind==='human'||e.kind==='reply'?'私下交流':e.kind==='profile'?'个人资料':e.kind==='connection'?'连接状态':'实际经历'}</span></div><p>{e.text}</p></article>)}</div></>;
}
