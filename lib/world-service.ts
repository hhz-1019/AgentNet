import { Decision, type CharacterDecision } from './world-decision.ts';
import { WORLD_PLACES, routeLength, walkingRoute } from './world-map.ts';
import type { Character, WorldEvent } from './world-types.ts';

type Row={owner_id:string;id:string;state:string;revision:number;last_op:string;token_hash:string|null};
type NewEvent={kind:WorldEvent['kind'];text:string;at?:number;sources?:string[]};
export class WorldError extends Error { status:number;constructor(status:number,message:string){super(message);this.status=status;} }
export async function tokenHash(token:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function initialCharacter(id:string,name:string,profile:string,now:number):Character {
  return {id,name,profile,createdAt:now,place:'beida',motion:null,activity:'在北大楼前熟悉校园',intention:'先认识这座校园，再慢慢形成自己的日常。',energy:84,energyAt:now,nextWake:now,paused:false,lastReadSeq:0,lastHumanSeq:0,retryAt:0,heartbeatAt:0,driverName:'',driverError:'',connectedUntil:0,lease:null,lastDecisionId:'',usage:{hourStart:now,calls:0,inputTokens:0,outputTokens:0}};
}
export function advanceClock(c:Character,now:number,events:NewEvent[]){
  const elapsed=Math.max(0,now-c.energyAt),walking=c.motion?Math.max(0,Math.min(now,c.motion.endAt)-c.energyAt):0;
  c.energy=Math.max(0,Math.min(100,c.energy-walking/60000*1.5+(elapsed-walking)/60000*.5));c.energyAt=now;
  if(c.motion&&c.motion.endAt<=now){
    const motion=c.motion;c.place=motion.to;c.motion=null;c.activity=`刚到${WORLD_PLACES[c.place].name}`;c.nextWake=Math.min(c.nextWake,now);
    events.push({kind:'arrival',text:`抵达${WORLD_PLACES[c.place].name}。`,at:motion.endAt});
  }
}
export class WorldService {
  private driverHash:string|null=null;
  private db:D1Database;private clock:()=>number;
  constructor(db:D1Database,clock=()=>Date.now()){this.db=db;this.clock=clock;}
  async row(ownerId:string){const row=await this.db.prepare('SELECT * FROM campus_characters WHERE owner_id=?').bind(ownerId).first<Row>();if(!row)throw new WorldError(404,'你的角色还没有进入校园。');return row;}
  async history(actorId:string,limit=60){
    const rows=await this.db.prepare('SELECT id,seq,at,kind,text,sources FROM campus_events WHERE actor_id=? ORDER BY seq DESC,at DESC,id DESC LIMIT ?').bind(actorId,limit).all<WorldEvent&{sources:string}>();
    return rows.results.reverse().map(e=>({...e,sources:JSON.parse(e.sources) as string[]}));
  }
  async create(ownerId:string,name:string,profile:string){
    const id=crypto.randomUUID(),op=crypto.randomUUID(),now=this.clock(),character=initialCharacter(id,name,profile,now);
    await this.db.batch([
      this.db.prepare('INSERT INTO campus_characters (owner_id,id,state,revision,last_op) VALUES (?,?,?,1,?) ON CONFLICT(owner_id) DO NOTHING').bind(ownerId,id,JSON.stringify(character),op),
      this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(crypto.randomUUID(),now,'arrival','进入校园，来到北大楼前。','[]',ownerId,op),
    ]);
    return this.view(ownerId);
  }
  // D1 batches are atomic. Event inserts are conditional on this exact successful CAS,
  // so racing messages, driver responses and disconnects cannot leave orphan events.
  async change(ownerId:string,fn:(c:Character,events:NewEvent[],row:Row,now:number)=>void){
    for(let attempt=0;attempt<4;attempt++){
      const row=await this.row(ownerId),c:Character=JSON.parse(row.state),events:NewEvent[]=[],now=this.clock();
      if(this.driverHash&&row.token_hash!==this.driverHash)throw new WorldError(401,'这个连接已被撤销。');
      advanceClock(c,now,events);fn(c,events,row,now);
      const op=crypto.randomUUID(),seq=row.revision+1;
      const writes=[this.db.prepare('UPDATE campus_characters SET state=?,revision=?,last_op=?,token_hash=? WHERE owner_id=? AND revision=?').bind(JSON.stringify(c),seq,op,row.token_hash,ownerId,row.revision)];
      for(const e of events)writes.push(this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(crypto.randomUUID(),e.at??now,e.kind,e.text,JSON.stringify(e.sources??[]),ownerId,op));
      const result=await this.db.batch(writes);
      if(result[0].meta.changes===1)return c;
    }
    throw new WorldError(409,'校园正在同步，请稍后重试。');
  }
  async view(ownerId:string){
    let row=await this.row(ownerId),c:Character=JSON.parse(row.state);const now=this.clock();
    if(c.motion&&c.motion.endAt<=now){await this.change(ownerId,()=>{});row=await this.row(ownerId);c=JSON.parse(row.state);}
    advanceClock(c,now,[]);
    const {lease:_lease,lastDecisionId:_lastDecision,...character}=c;
    return {serverNow:now,character,events:await this.history(c.id),connected:!!row.token_hash&&c.heartbeatAt>now-65000&&c.connectedUntil>now};
  }
  async message(ownerId:string,text:string,requestId:string){
    const eventId=`human:${requestId}`;
    // The request UUID makes retries safe even when the HTTP response was lost.
    const prior=await this.db.prepare('SELECT actor_id FROM campus_events WHERE id=?').bind(eventId).first<{actor_id:string}>();
    const own=await this.row(ownerId);
    if(prior){if(prior.actor_id!==own.id)throw new WorldError(409,'消息编号冲突。');return;}
    for(let attempt=0;attempt<4;attempt++){
      const row=await this.row(ownerId),c:Character=JSON.parse(row.state),now=this.clock(),op=crypto.randomUUID(),seq=row.revision+1;
      c.lastHumanSeq=seq;
      const result=await this.db.batch([
        this.db.prepare('UPDATE campus_characters SET state=?,revision=?,last_op=? WHERE owner_id=? AND revision=? AND NOT EXISTS (SELECT 1 FROM campus_events WHERE id=?)').bind(JSON.stringify(c),seq,op,ownerId,row.revision,eventId),
        this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(eventId,now,'human',text,'[]',ownerId,op),
      ]);
      if(result[0].meta.changes===1)return;
      if(await this.db.prepare('SELECT id FROM campus_events WHERE id=? AND actor_id=?').bind(eventId,own.id).first())return;
    }
    throw new WorldError(409,'消息暂未送达，请重试。');
  }
  async pause(ownerId:string,paused:boolean){return this.change(ownerId,(c,e,_r,now)=>{c.paused=paused;c.lease=null;if(!paused)c.nextWake=now;e.push({kind:'connection',text:paused?'已暂停自主思考。已有行程会按计划完成。':'已恢复自主思考。'});});}
  async disconnect(ownerId:string){return this.change(ownerId,(c,e,r)=>{r.token_hash=null;c.lease=null;c.heartbeatAt=0;c.paused=true;e.push({kind:'connection',text:'已撤销 Codex 连接。角色经历与私聊仍保留。'});});}
  async pairing(token:string){
    const hash=await tokenHash(token),existing=await this.db.prepare('SELECT code,expires_at,claimed_by FROM campus_pairs WHERE token_hash=?').bind(hash).first<{code:string;expires_at:number;claimed_by:string|null}>();
    if(existing&&existing.expires_at>this.clock()&&!existing.claimed_by)return {code:existing.code,expiresAt:existing.expires_at};
    const code=crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase(),expiresAt=this.clock()+15*60000;
    await this.db.batch([
      this.db.prepare('DELETE FROM campus_pairs WHERE expires_at<? OR token_hash=?').bind(this.clock(),hash),
      this.db.prepare('INSERT INTO campus_pairs(code,token_hash,expires_at) VALUES(?,?,?)').bind(code,hash,expiresAt),
    ]);
    return {code,expiresAt};
  }
  async claim(ownerId:string,code:string){
    const row=await this.row(ownerId),now=this.clock(),op=crypto.randomUUID();
    const c:Character=JSON.parse(row.state);c.paused=false;c.lease=null;c.driverError='';c.driverName='本机 Codex';c.heartbeatAt=0;c.nextWake=now;
    const result=await this.db.batch([
      this.db.prepare('UPDATE campus_characters SET token_hash=(SELECT token_hash FROM campus_pairs WHERE code=?),state=?,revision=revision+1,last_op=? WHERE owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM campus_pairs WHERE code=? AND claimed_by IS NULL AND expires_at>?)').bind(code,JSON.stringify(c),op,ownerId,row.revision,code,now),
      this.db.prepare('UPDATE campus_pairs SET claimed_by=? WHERE code=? AND claimed_by IS NULL AND EXISTS(SELECT 1 FROM campus_characters WHERE owner_id=? AND last_op=?)').bind(ownerId,code,ownerId,op),
      this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(crypto.randomUUID(),now,'connection','已将本机 Codex 与这个角色配对。','[]',ownerId,op),
    ]);
    if(result[0].meta.changes!==1)throw new WorldError(409,'连接码已失效或已被使用，请重新生成。');
  }
  async driverOwner(token:string){
    this.driverHash=await tokenHash(token);
    const row=await this.db.prepare('SELECT owner_id FROM campus_characters WHERE token_hash=?').bind(this.driverHash).first<{owner_id:string}>();
    if(!row)throw new WorldError(401,'角色尚未配对，或连接已经被撤销。');return row.owner_id;
  }
  async observe(ownerId:string,driverId:string,endsAt:number){
    const before=await this.row(ownerId),previous:Character=JSON.parse(before.state),history=await this.history(before.id,24);
    const unread=(await this.db.prepare("SELECT id,seq,at,kind,text,sources FROM campus_events WHERE actor_id=? AND kind='human' AND seq>? AND seq<=? ORDER BY seq LIMIT 21").bind(before.id,previous.lastReadSeq,before.revision).all<WorldEvent&{sources:string}>()).results.map(e=>({...e,sources:JSON.parse(e.sources) as string[]}));
    const memory=(await this.db.prepare("SELECT id,seq,at,kind,text,sources FROM campus_events WHERE actor_id=? AND kind='memory' ORDER BY seq DESC LIMIT 8").bind(before.id).all<WorldEvent&{sources:string}>()).results.map(e=>({...e,sources:JSON.parse(e.sources) as string[]}));
    const cutoff=unread.length>20?unread[19].seq:before.revision;
    const known=[...new Map([...memory,...history,...unread.slice(0,20)].filter(e=>e.seq<=cutoff).map(e=>[e.id,e])).values()].sort((a,b)=>a.seq-b.seq);
    let acquired=false;
    const c=await this.change(ownerId,(c,_e,row,now)=>{
      acquired=false;c.heartbeatAt=now;c.connectedUntil=Math.min(endsAt,now+4*3600000);
      if(c.usage.hourStart+3600000<=now)c.usage={...c.usage,hourStart:now,calls:0};
      const due=c.lastHumanSeq>c.lastReadSeq||(!c.motion&&c.nextWake<=now);
      if(c.paused||!due||c.retryAt>now||endsAt<=now||c.usage.calls>=12||(c.lease&&c.lease.until>now))return;
      // A stale history snapshot cannot acknowledge newer private messages.
      const observedSeq=Math.min(row.revision,cutoff);
      c.lease={id:driverId+':'+crypto.randomUUID(),until:now+180000,observedSeq,sourceIds:known.filter(e=>e.seq<=observedSeq).map(e=>e.id)};
      c.usage.calls++;c.driverError='';acquired=true;
    });
    if(!acquired)return {ready:false,paused:c.paused,retryAfter:10,limited:c.usage.calls>=12};
    return {ready:true,leaseId:c.lease!.id,serverNow:this.clock(),character:{name:c.name,profile:c.profile,place:c.place,moving:!!c.motion,destination:c.motion?.to??null,arrivalAt:c.motion?.endAt??null,activity:c.activity,intention:c.intention,energy:Math.round(c.energy)},places:WORLD_PLACES,events:known.filter(e=>e.seq<=c.lease!.observedSeq),newMessages:unread.filter(e=>e.seq>c.lastReadSeq&&e.seq<=c.lease!.observedSeq)};
  }
  async decide(ownerId:string,leaseId:string,input:unknown,usage:{inputTokens:number;outputTokens:number}){
    const decision=Decision.parse(input);
    return this.change(ownerId,(c,events,_row,now)=>{
      if(c.lastDecisionId===leaseId)return;
      if(c.paused||!c.lease||c.lease.id!==leaseId||c.lease.until<=now)throw new WorldError(409,'这次思考已经过期，结果未执行。');
      if(c.motion&&decision.action!=='continue')throw new WorldError(422,'角色正在途中，需要先完成当前行程。');
      if(decision.memory&&(!decision.sourceEventIds.length||decision.sourceEventIds.some(id=>!c.lease!.sourceIds.includes(id))))throw new WorldError(422,'记忆必须关联角色已知的真实事件。');
      applyDecision(c,decision,now,events);
      c.lastReadSeq=c.lease.observedSeq;c.lastDecisionId=leaseId;c.lease=null;c.driverError='';c.retryAt=0;
      c.usage.inputTokens+=usage.inputTokens;c.usage.outputTokens+=usage.outputTokens;
    });
  }
  async failure(ownerId:string,leaseId:string,message:string){return this.change(ownerId,(c,_e,_r,now)=>{if(c.lease?.id!==leaseId)return;c.lease=null;c.driverError=message;c.retryAt=now+120000;});}
}
export function applyDecision(c:Character,d:CharacterDecision,now:number,events:NewEvent[]){
  if(d.reply)events.push({kind:'reply',text:d.reply});
  if(d.memory)events.push({kind:'memory',text:d.memory,sources:d.sourceEventIds});
  c.intention=d.intention;
  if(d.action==='move'&&d.destination!==c.place){
    const route=walkingRoute(c.place,d.destination),duration=Math.max(30000,routeLength(route)*.265625/.9*1000);
    c.motion={from:c.place,to:d.destination,route,startAt:now,endAt:now+duration};c.activity=`走向${WORLD_PLACES[d.destination].name}`;c.nextWake=now+duration;
    events.push({kind:'departure',text:`从${WORLD_PLACES[c.place].name}出发，前往${WORLD_PLACES[d.destination].name}。`});
  }else if(!c.motion){c.activity=d.activity;c.nextWake=now+d.waitSeconds*1000;events.push({kind:'activity',text:`在${WORLD_PLACES[c.place].name}，${d.activity}。`});}
}
