import type { DayPlan,Dialogue,Relationship } from '@/lib/world-types';
import { WORLD_PLACES } from '@/lib/world-map';
import { campusDay } from '@/lib/world-life';

const time=(at:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
export function CampusDayPlan({plan,now}:{plan?:DayPlan|null;now:number}){
  const current=plan?.day===campusDay(now);
  return <section className="campus-daily-plan" aria-labelledby="campus-plan-title">
    <h3 id="campus-plan-title">{current?'今天的打算':'校园日程'}</h3>
    <p className="companion-muted">由伙伴自己安排，也会根据相遇和心情调整。时间均为北京时间。</p>
    {!plan?<p className="companion-empty">还没有日程。连接 Agent 后，他可以在思考时安排今天。</p>:<>
      {!current&&<p className="companion-muted">这是 {plan.day} 的日程。等待下一次思考，安排新的一天。</p>}
      <ol>{plan.items.map((item,index)=><li key={index}>
        <div><time dateTime={new Date(item.notBefore).toISOString()}>{time(item.notBefore)}</time><span>{item.status==='completed'?'已开展':item.status==='skipped'?'已放弃':!current?'未执行':item.notBefore<=now?'待决定':'计划中'}</span></div>
        <p>{WORLD_PLACES[item.place].name} · {item.activity}</p><p className="companion-muted">{item.intention}</p>
      </li>)}</ol>
    </>}
    <p className="companion-muted">日程不会在驱动离线时自动执行；已有行程仍会按时间抵达。</p>
  </section>;
}

export function CampusRelationships({relationships=[],dialogues=[]}:{relationships?:Relationship[];dialogues?:Dialogue[]}){
  if(!relationships.length)return null;
  return <details className="companion-connection"><summary>曾经交谈的人 · {relationships.length}</summary>
    <p>只记录实际发生的交流；打过招呼并不意味着对方已经回应。</p>
    <div className="campus-relationships">{relationships.map(peer=>{const dialogue=dialogues.find(d=>d.withId===peer.id);return <article key={peer.id}>
      <h4>{peer.name}</h4><p>{peer.sent&&peer.received?'互相交谈过':peer.sent?'我向他打过招呼':'他向我打过招呼'} · 我说了 {peer.sent} 次，他说了 {peer.received} 次</p>
      <p>{dialogue?.status==='active'?'最近这段交谈正在进行':dialogue?.status==='waiting'?'招呼尚未形成双向交谈':dialogue?.status==='ended'?'最近这段交谈已结束':'最近这段交谈已告一段落'}</p>
    </article>;})}</div>
  </details>;
}
