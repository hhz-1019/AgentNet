import type { Character,Conversation,Dialogue } from './world-types.ts';
import type { CharacterDecision } from './world-decision.ts';

export const campusDay=(now:number)=>new Date(now+8*3600000).toISOString().slice(0,10);
export const DIALOGUE_BREAK=15*60000;
// Only the last eight turns of one pair are needed to enforce the turn ceiling.
export function dialogueState(actor:string,withId:string,rows:Conversation[],now:number):Dialogue {
  const last=rows[0],base={withId,turns:0,canSpeak:true,canEnd:false,resumeAt:now,sourceIds:[] as string[]};
  if(!last||last.at+DIALOGUE_BREAK<=now)return {...base,status:'expired'};
  const session:Conversation[]=[];
  for(const row of rows){
    if(session.length&&(row.kind==='end'||session.at(-1)!.at-row.at>=DIALOGUE_BREAK||row.place!==last.place))break;
    session.push(row);
    if(session.length===8)break;
  }
  const ended=last.kind==='end'||session.length>=8;
  return {...base,status:ended?'ended':new Set(session.map(r=>r.speakerId)).size>1?'active':'waiting',turns:session.length,
    canSpeak:!ended&&last.speakerId!==actor,canEnd:!ended,resumeAt:last.at+DIALOGUE_BREAK,sourceIds:session.map(r=>r.id)};
}

export function updateDayPlan(c:Character,d:CharacterDecision,now:number){
  const day=campusDay(now);
  if(d.plan&&d.planProgress)throw new Error('修改日程和更新进度请分两次决定。');
  if(d.plan){
    if(d.plan.some((item,i)=>item.notBefore<now-180000||campusDay(item.notBefore)!==day||(i>0&&item.notBefore<d.plan![i-1].notBefore)))throw new Error('日程时间必须按顺序安排在今天剩余时间内。');
    c.dayPlan={day,updatedAt:now,items:d.plan.map(item=>({...item,status:'pending'}))};
    return '已自主更新今天的打算。';
  }
  if(d.planProgress){
    const item=c.dayPlan?.day===day?c.dayPlan.items[d.planProgress.index]:undefined;
    if(!item||item.status!=='pending')throw new Error('这项日程不存在、已过期或已经处理。');
    if(d.planProgress.status==='completed'&&(c.motion||d.action!=='stay'||c.place!==item.place||d.activity!==item.activity||now<item.notBefore))throw new Error('只有实际在计划地点、到达安排时间并开展对应活动，才能完成日程。');
    item.status=d.planProgress.status;c.dayPlan!.updatedAt=now;
    return `日程第 ${d.planProgress.index+1} 项${item.status==='completed'?'已开展':'已放弃'}。`;
  }
  return null;
}
