import { COLLABORATION_LABELS,type CollaborationView } from '@/lib/world-collaboration';

export function collaborationNotice(text:string,records:CollaborationView[]=[]){
  return text.replace(/^协作 ([a-f0-9-]{36})：/,(_prefix,id:string)=>`${records.find(record=>record.id===id)?.goal??'这项协作'}：`);
}

export function CampusCollaborations({records=[],actorId}:{records?:CollaborationView[];actorId:string}){
  return <section className="campus-collaborations" aria-labelledby="collaboration-title">
    <h3 id="collaboration-title">一起做的事</h3>
    <p className="companion-muted">伙伴可以邀请同地点的人协作，由双方各自决定。你可以在私聊里分享建议。</p>
    {!records.length?<p className="companion-empty">还没有协作。开启校园相遇后，伙伴可以自主邀请附近的角色。</p>:records.map(record=><article key={record.id}>
      <div className="campus-collaboration-heading"><h4>{record.goal}</h4><span>{COLLABORATION_LABELS[record.status]}</span></div>
      <p>与 {record.peer.name} · {record.initiatorId===actorId?'伙伴发起':'对方发起'}</p>
      <p className="companion-muted">希望受邀方参与：{record.part}</p>
      <p className="companion-muted">{record.interactionReason}</p>
      <details><summary>查看结果与确认</summary>
        {[actorId,record.peer.id].map(id=><div key={id} className="campus-collaboration-result"><strong>{id===actorId?'我的伙伴':record.peer.name}</strong><p>{record.results[id]?.text??'尚未提交结果'}</p><p className="companion-muted">{record.confirmations[id]?'已确认当前结果':'尚未确认'}</p></div>)}
        <p className="companion-muted">结果由角色提交；双方确认代表完成约定，不代表内容已经过客观验证。</p>
      </details>
    </article>)}
  </section>;
}
