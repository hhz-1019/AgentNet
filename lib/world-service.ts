import { Decision, type CharacterDecision } from './world-decision.ts';
import { WORLD_PLACES, routeLength, walkingRoute } from './world-map.ts';
import { PersonalMemoryInput, type MemoryImport } from './personal-memory.ts';
import type { Character, Conversation, Neighbor, WorldEvent } from './world-types.ts';
import { campusDay,dialogueState,updateDayPlan } from './world-life.ts';
import type { Relationship } from './world-types.ts';

type Row={owner_id:string;id:string;state:string;revision:number;last_op:string;token_hash:string|null;token_expires_at:number|null;owner_key_hash:string|null};
type NewEvent={kind:WorldEvent['kind'];text:string;at?:number;sources?:string[]};
type Effect={speech?:{id:string;decisionId:string;to:string;text:string;place:string;kind:string;after:number}};
const conversationColumns='id,seq,at,place,speaker_id AS speakerId,speaker_name AS speakerName,recipient_id AS recipientId,recipient_name AS recipientName,text,kind';
// Resolve elapsed travel from server time, even if the owner has no open browser.
const presentAt=`json_extract(state,'$.socialEnabled')=1 AND (json_extract(state,'$.motion') IS NULL OR json_extract(state,'$.motion.endAt')<=?) AND CASE WHEN json_extract(state,'$.motion.endAt')<=? THEN json_extract(state,'$.motion.to') ELSE json_extract(state,'$.place') END=?`;
export class WorldError extends Error { status:number;constructor(status:number,message:string){super(message);this.status=status;} }
export async function tokenHash(token:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
// Budgets reserve a decision before the client calls a model, including failed attempts.
export function dailyBudget(c:Character,now:number){
  const day=new Date(now+8*3600000).toISOString().slice(0,10);
  const dailyLimit=c.budget?.dailyLimit??48;
  if(c.budget?.day!==day)c.budget={dailyLimit,day,calls:0};
  return c.budget!;
}
function nextBudgetDay(now:number){return (Math.floor((now+8*3600000)/86400000)+1)*86400000-8*3600000;}
export function initialCharacter(id:string,name:string,profile:string,now:number):Character {
  return {id,name,profile,createdAt:now,place:'beida',motion:null,activity:'在北大楼前熟悉校园',intention:'先认识这座校园，再慢慢形成自己的日常。',energy:84,energyAt:now,nextWake:now,paused:false,lastReadSeq:0,lastHumanSeq:0,retryAt:0,heartbeatAt:0,driverName:'',driverError:'',connectedUntil:0,socialEnabled:false,lastSocialSeq:0,nextSocialAt:0,lease:null,lastDecisionId:'',usage:{hourStart:now,calls:0,inputTokens:0,outputTokens:0}};
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
  private ownerHash:string|null=null;
  readonly db:D1Database;private clock:()=>number;
  constructor(db:D1Database,clock=()=>Date.now()){this.db=db;this.clock=clock;}
  async row(ownerId:string){
    const row=await this.db.prepare('SELECT * FROM campus_characters WHERE owner_id=?').bind(ownerId).first<Row>();
    if(!row)throw new WorldError(404,'你的角色还没有进入校园。');
    if(this.driverHash&&(row.token_hash!==this.driverHash||(row.token_expires_at!==null&&row.token_expires_at<=this.clock())))throw new WorldError(401,'这个连接已被撤销或已到期。');
    if(this.ownerHash&&row.owner_key_hash!==this.ownerHash)throw new WorldError(401,'校园身份已更新，请使用新的恢复密钥。');
    return row;
  }
  async history(actorId:string,limit=60){
    const rows=await this.db.prepare('SELECT id,seq,at,kind,text,sources FROM campus_events WHERE actor_id=? ORDER BY seq DESC,at DESC,id DESC LIMIT ?').bind(actorId,limit).all<WorldEvent&{sources:string}>();
    return rows.results.reverse().map(e=>({...e,sources:JSON.parse(e.sources) as string[]}));
  }
  async nearby(c:Character,now=this.clock()):Promise<Neighbor[]>{
    if(!c.socialEnabled||c.motion)return [];
    const rows=await this.db.prepare(`SELECT id,state,token_hash,token_expires_at FROM campus_characters WHERE id<>? AND ${presentAt} ORDER BY id LIMIT 50`).bind(c.id,now,now,c.place).all<Row>();
    return rows.results.map(row=>{const other:Character=JSON.parse(row.state);advanceClock(other,now,[]);return {id:other.id,name:other.name,place:other.place,activity:other.activity,connected:!!row.token_hash&&(row.token_expires_at===null||row.token_expires_at>now)&&!other.paused&&other.heartbeatAt>now-65000&&other.connectedUntil>now};});
  }
  async conversations(actorId:string,after=0,limit=40,unread=false):Promise<Conversation[]>{
    const rows=await this.db.prepare(`SELECT ${conversationColumns} FROM campus_conversations WHERE (speaker_id=? OR recipient_id=?) AND seq>? ORDER BY seq ${unread?'ASC':'DESC'} LIMIT ?`).bind(actorId,actorId,after,limit).all<Conversation>();
    return unread?rows.results:rows.results.reverse();
  }
  async pairHistory(actor:string,other:string){
    return (await this.db.prepare(`SELECT ${conversationColumns} FROM campus_conversations WHERE (speaker_id=? AND recipient_id=?) OR (speaker_id=? AND recipient_id=?) ORDER BY seq DESC LIMIT 8`).bind(actor,other,other,actor).all<Conversation>()).results;
  }
  async relationships(actor:string):Promise<Relationship[]>{
    // Descriptive facts only: reciprocal speech is not proof of friendship or trust.
    const rows=await this.db.prepare(`SELECT peer AS id,SUM(sent) AS sent,SUM(received) AS received,MIN(at) AS firstAt,MAX(at) AS lastAt FROM (
      SELECT recipient_id AS peer,1 AS sent,0 AS received,at FROM campus_conversations WHERE speaker_id=? AND kind='message'
      UNION ALL SELECT speaker_id AS peer,0 AS sent,1 AS received,at FROM campus_conversations WHERE recipient_id=? AND kind='message'
    ) GROUP BY peer ORDER BY lastAt DESC,peer LIMIT 24`).bind(actor,actor).all<Omit<Relationship,'name'>>();
    return Promise.all(rows.results.map(async row=>{const peer=await this.db.prepare('SELECT state FROM campus_characters WHERE id=?').bind(row.id).first<{state:string}>();return {...row,name:peer?(JSON.parse(peer.state) as Character).name:'曾交谈的角色'};}));
  }
  async socialContext(c:Character){
    const relationships=await this.relationships(c.id);
    const dialogues=await Promise.all(relationships.map(async peer=>dialogueState(c.id,peer.id,await this.pairHistory(c.id,peer.id),this.clock())));
    return {relationships,dialogues};
  }
  async waitForEvents(ownerId:string,clientName:string,timeoutSeconds=25,signal?:AbortSignal){
    await this.heartbeat(ownerId,clientName);
    const deadline=Date.now()+timeoutSeconds*1000;
    // ponytail: bounded database polling works across restarts/processes; use a durable broker only when measured load warrants it.
    while(true){
      const row=await this.row(ownerId),c:Character=JSON.parse(row.state),now=this.clock();
      advanceClock(c,now,[]);const budget=dailyBudget(c,now);
      const incoming=await this.db.prepare('SELECT seq FROM campus_conversations WHERE recipient_id=? AND seq>? ORDER BY seq LIMIT 1').bind(c.id,c.lastSocialSeq??0).first<{seq:number}>();
      const reasons=[...(c.lastHumanSeq>c.lastReadSeq?['human_message']:[]),...(!c.motion&&c.nextWake<=now?['scheduled']:[]),...(c.socialEnabled&&incoming&&(c.nextSocialAt??0)<=now?['conversation']:[])];
      const hourlyLimited=c.usage.calls>=12&&c.usage.hourStart+3600000>now,dailyLimited=budget.calls>=budget.dailyLimit;
      const blockedUntil=Math.max(c.retryAt,c.lease?.until??0,hourlyLimited?c.usage.hourStart+3600000:0,dailyLimited?nextBudgetDay(now):0);
      const ready=!c.paused&&reasons.length>0&&blockedUntil<=now;
      if(ready||c.paused||dailyLimited||hourlyLimited||Date.now()>=deadline||signal?.aborted){
        await this.row(ownerId); // A revoked long poll cannot return a successful result.
        return {ready,paused:c.paused,limited:dailyLimited||hourlyLimited,reasons:ready?reasons:[],serverNow:now,
          acknowledged:{events:c.lastReadSeq,conversations:c.lastSocialSeq??0},retryAfter:Math.max(1,Math.ceil((blockedUntil-now)/1000)),budget};
      }
      await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,Math.min(2000,Math.max(0,deadline-Date.now())));signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();});
    }
  }
  async create(ownerId:string,name:string,profile='',socialEnabled=false,gender:Character['gender']='unspecified',ownerKeyHash:string|null=null){
    const id=crypto.randomUUID(),op=crypto.randomUUID(),now=this.clock(),character=initialCharacter(id,name,profile,now);
    character.socialEnabled=socialEnabled;character.gender=gender;character.personalMemory=null;
    await this.db.batch([
      this.db.prepare('INSERT INTO campus_characters (owner_id,id,state,revision,last_op,owner_key_hash) VALUES (?,?,?,1,?,?) ON CONFLICT(owner_id) DO NOTHING').bind(ownerId,id,JSON.stringify(character),op,ownerKeyHash),
      this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(crypto.randomUUID(),now,'arrival','进入校园，来到北大楼前。','[]',ownerId,op),
    ]);
    return this.view(ownerId);
  }
  // D1 batches are atomic. Event inserts are conditional on this exact successful CAS,
  // so racing messages, driver responses and disconnects cannot leave orphan events.
  async change(ownerId:string,fn:(c:Character,events:NewEvent[],row:Row,now:number,effect:Effect)=>void){
    for(let attempt=0;attempt<4;attempt++){
      const row=await this.row(ownerId),c:Character=JSON.parse(row.state),events:NewEvent[]=[],now=this.clock();
      const effect:Effect={};advanceClock(c,now,events);fn(c,events,row,now,effect);
      const op=crypto.randomUUID(),seq=row.revision+1;
      const speech=effect.speech;
      const guard=speech?` AND EXISTS(SELECT 1 FROM campus_characters WHERE id=? AND ${presentAt}) AND NOT EXISTS(SELECT 1 FROM campus_conversations WHERE ((speaker_id=? AND recipient_id=?) OR (speaker_id=? AND recipient_id=?)) AND seq>?)`:'';
      const values:(string|number|null)[]=[JSON.stringify(c),seq,op,row.token_hash,row.token_expires_at,row.owner_key_hash,ownerId,row.revision];
      if(speech)values.push(speech.to,now,now,speech.place,c.id,speech.to,speech.to,c.id,speech.after);
      const writes=[this.db.prepare('UPDATE campus_characters SET state=?,revision=?,last_op=?,token_hash=?,token_expires_at=?,owner_key_hash=? WHERE owner_id=? AND revision=?'+guard).bind(...values)];
      for(const e of events)writes.push(this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(crypto.randomUUID(),e.at??now,e.kind,e.text,JSON.stringify(e.sources??[]),ownerId,op));
      if(speech)writes.push(this.db.prepare(`INSERT INTO campus_conversations(id,decision_id,speaker_id,speaker_name,recipient_id,recipient_name,place,at,text,kind) SELECT ?,?,speaker.id,json_extract(speaker.state,'$.name'),recipient.id,json_extract(recipient.state,'$.name'),?,?,?,? FROM campus_characters speaker,campus_characters recipient WHERE speaker.owner_id=? AND speaker.last_op=? AND recipient.id=?`).bind(speech.id,speech.decisionId,speech.place,now,speech.text,speech.kind,ownerId,op,speech.to));
      const result=await this.db.batch(writes);
      if(result[0].meta.changes===1)return c;
    }
    throw new WorldError(409,'校园正在同步，请稍后重试。');
  }
  async view(ownerId:string){
    let row=await this.row(ownerId),c:Character=JSON.parse(row.state);const now=this.clock();
    if(c.motion&&c.motion.endAt<=now){await this.change(ownerId,()=>{});row=await this.row(ownerId);c=JSON.parse(row.state);}
    advanceClock(c,now,[]);
    dailyBudget(c,now);
    const {lease:_lease,lastDecisionId:_lastDecision,...character}=c;
    const result={serverNow:now,character,events:await this.history(c.id),agentAuthorized:!!row.token_hash&&(row.token_expires_at===null||row.token_expires_at>now),agentExpiresAt:row.token_expires_at,connected:!!row.token_hash&&(row.token_expires_at===null||row.token_expires_at>now)&&!c.paused&&c.heartbeatAt>now-65000&&c.connectedUntil>now,nearby:await this.nearby(c,now),conversations:await this.conversations(c.id),...await this.socialContext(c)};
    await this.row(ownerId);return result;
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
  async setDailyLimit(ownerId:string,limit:number){
    if(!Number.isInteger(limit)||limit<1||limit>144)throw new WorldError(400,'每日决策上限需为 1–144 次。');
    return this.change(ownerId,(c,e,_r,now)=>{const budget=dailyBudget(c,now);if(budget.dailyLimit===limit)return;budget.dailyLimit=limit;if(budget.calls>=limit)c.lease=null;e.push({kind:'connection',text:`每日决策上限调整为 ${limit} 次，北京时间零点重置。`});});
  }
  async heartbeat(ownerId:string,clientName:string,leaseId?:string){
    const c=await this.change(ownerId,(c,_e,_r,now)=>{c.heartbeatAt=now;c.connectedUntil=now+65000;c.driverName=clientName;dailyBudget(c,now);});
    return {paused:c.paused,serverNow:this.clock(),budget:c.budget,leaseActive:!!leaseId&&c.lease?.id===leaseId&&c.lease.until>this.clock()};
  }
  async recall(ownerId:string,query:string,limit=8,leaseId?:string){
    const row=await this.row(ownerId),c:Character=JSON.parse(row.state);
    if(leaseId&&(c.paused||c.lease?.id!==leaseId||c.lease.until<=this.clock()))throw new WorldError(409,'观察已过期，请重新观察后再回忆。');
    const terms=[...new Set([...new Intl.Segmenter('zh',{granularity:'word'}).segment(query.toLowerCase())].filter(s=>s.isWordLike&&s.segment.length>1).map(s=>s.segment))].slice(0,8);
    if(!terms.length&&query.trim())terms.push(query.trim().toLowerCase());
    // ponytail: owner-scoped keyword recall over stored history; add FTS only when measured history size warrants it.
    const relevance=terms.length?terms.map(()=>'(CASE WHEN instr(lower(text),?)>0 THEN 1 ELSE 0 END)').join('+'):'0';
    const found=await this.db.prepare(`SELECT *,(${relevance})*4 + CASE kind WHEN 'memory' THEN 3 WHEN 'human' THEN 2 WHEN 'conversation' THEN 2 ELSE 1 END + 1.0/(1+MAX(0,?-at)/86400000.0) AS score FROM (
      SELECT id,at,kind,text,sources FROM campus_events WHERE actor_id=? AND kind IN ('human','reply','arrival','departure','activity','memory')
      UNION ALL SELECT id,at,'conversation' AS kind,speaker_name || ' 对 ' || recipient_name || '：' || text AS text,'[]' AS sources FROM campus_conversations WHERE speaker_id=? OR recipient_id=?
    ) WHERE (${terms.length?terms.map(()=> 'instr(lower(text),?)>0').join(' OR '):'1'}) ORDER BY ${terms.length?'score DESC,':''}at DESC,id DESC LIMIT ?`).bind(...terms,this.clock(),c.id,c.id,c.id,...terms,limit).all<{id:string;at:number;kind:string;text:string;sources:string;score:number}>();
    const memories=found.results.map(({score:_score,sources,...entry})=>({...entry,sources:JSON.parse(sources) as string[]}));
    if(leaseId)await this.change(ownerId,(c,_e,_r,now)=>{
      if(c.paused||c.lease?.id!==leaseId||c.lease.until<=now)throw new WorldError(409,'观察已过期，回忆未加入本轮依据。');
      const ids=[...new Set([...c.lease.sourceIds,...memories.map(m=>m.id)])];
      if(ids.length>160)throw new WorldError(429,'本次观察已检索足够的经历，请先完成当前决定。');
      c.lease.sourceIds=ids;
    });
    else await this.row(ownerId); // Recheck revocation after the read.
    return {query,method:terms.length?'keyword-recency-importance':'recent',ranking:'关键词相关性优先，结合记录类型的重要性与时间；不是语义向量检索，也不代表记忆真实性评分。',memories};
  }
  async personalMemory(ownerId:string,input:MemoryImport|null){
    const memory=input===null?null:PersonalMemoryInput.parse(input);
    return this.change(ownerId,(c,e,_r,now)=>{
      if(memory&&c.personalMemory?.source===memory.source&&c.personalMemory.summary===memory.summary)return;
      if(!memory&&!c.personalMemory&&!c.profile)return;
      c.personalMemory=memory?{source:memory.source,summary:memory.summary,importedAt:now}:null;
      c.profile='';c.lease=null;c.nextWake=now;c.retryAt=0;
      // Keep the personal summary out of the event log. Clearing it also cancels
      // a decision that was still being generated from the previous summary.
      e.push({kind:'profile',text:memory?'已更新经你确认的个人记忆摘要。':'已移除个人摘要，后续判断不再提供这份资料。'});
    });
  }
  async participation(ownerId:string,enabled:boolean){return this.change(ownerId,(c,e,_r,now)=>{if(!!c.socialEnabled===enabled)return;c.socialEnabled=enabled;c.lease=null;c.nextWake=now;e.push({kind:'connection',text:enabled?'开始参与校园相遇。附近的角色可以看到名字、位置和当前活动。':'已退出校园相遇。其他角色不再看到你，也不能向你发起新交谈。'});});}
  async disconnect(ownerId:string){return this.change(ownerId,(c,e,r)=>{r.token_hash=null;r.token_expires_at=null;c.lease=null;c.heartbeatAt=0;c.paused=true;e.push({kind:'connection',text:'已撤销 Agent 连接。角色经历与私聊仍保留。'});});}
  async ownerByKey(key:string){
    const hash=await tokenHash(key);
    const row=await this.db.prepare('SELECT owner_id FROM campus_characters WHERE owner_key_hash=? AND NOT EXISTS(SELECT 1 FROM campus_accounts WHERE campus_accounts.owner_id=campus_characters.owner_id)').bind(hash).first<{owner_id:string}>();
    if(!row)throw new WorldError(401,'校园恢复密钥无效或已更换，请检查后重试。');
    this.ownerHash=hash;return row.owner_id;
  }
  async setOwnerKey(ownerId:string,key:string){
    const hash=await tokenHash(key);
    await this.change(ownerId,(_c,e,r)=>{r.owner_key_hash=hash;e.push({kind:'connection',text:'已更新校园恢复密钥。其他设备需使用新密钥恢复身份。'});});
    this.ownerHash=hash;
  }
  async issueAgentToken(ownerId:string,token:string){
    const hash=await tokenHash(token),expiresAt=this.clock()+90*86400000;
    await this.change(ownerId,(c,e,r,_now)=>{r.token_hash=hash;r.token_expires_at=expiresAt;c.lease=null;c.heartbeatAt=0;c.connectedUntil=0;c.paused=false;c.nextWake=this.clock();c.retryAt=0;c.driverError='';c.driverName='外部 Agent';e.push({kind:'connection',text:'已生成新的 Agent 连接密钥，旧连接失效。角色经历继续保留。'});});
    return {expiresAt};
  }
  async registrationLimit(address:string){
    const now=this.clock(),hour=Math.floor(now/3600000),bucket=await tokenHash(address+':'+hour);
    const results=await this.db.batch([
      this.db.prepare('DELETE FROM campus_registration_limits WHERE expires_at<?').bind(now),
      this.db.prepare('INSERT INTO campus_registration_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<20').bind(bucket,(hour+1)*3600000),
    ]);
    if(results[1].meta.changes!==1)throw new WorldError(429,'本网络创建角色过于频繁，请稍后再试。已有角色可使用恢复密钥进入。');
  }
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
      this.db.prepare('UPDATE campus_characters SET token_hash=(SELECT token_hash FROM campus_pairs WHERE code=?),token_expires_at=?,state=?,revision=revision+1,last_op=? WHERE owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM campus_pairs WHERE code=? AND claimed_by IS NULL AND expires_at>?)').bind(code,now+90*86400000,JSON.stringify(c),op,ownerId,row.revision,code,now),
      this.db.prepare('UPDATE campus_pairs SET claimed_by=? WHERE code=? AND claimed_by IS NULL AND EXISTS(SELECT 1 FROM campus_characters WHERE owner_id=? AND last_op=?)').bind(ownerId,code,ownerId,op),
      this.db.prepare('INSERT INTO campus_events (id,actor_id,seq,at,kind,text,sources) SELECT ?,id,revision,?,?,?,? FROM campus_characters WHERE owner_id=? AND last_op=?').bind(crypto.randomUUID(),now,'connection','已将本机 Codex 与这个角色配对。','[]',ownerId,op),
    ]);
    if(result[0].meta.changes!==1)throw new WorldError(409,'连接码已失效或已被使用，请重新生成。');
  }
  async driverOwner(token:string){
    const hash=await tokenHash(token);
    const row=await this.db.prepare('SELECT owner_id FROM campus_characters WHERE token_hash=? AND (token_expires_at IS NULL OR token_expires_at>?)').bind(hash,this.clock()).first<{owner_id:string}>();
    if(!row)throw new WorldError(401,'角色尚未授权，或连接密钥已撤销、到期。');this.driverHash=hash;return row.owner_id;
  }
  async observe(ownerId:string,driverId:string,endsAt:number,viaBrowser=false,clientName?:string){
    const before=await this.row(ownerId),previous:Character=JSON.parse(before.state),history=await this.history(before.id,24);
    const unread=(await this.db.prepare("SELECT id,seq,at,kind,text,sources FROM campus_events WHERE actor_id=? AND kind='human' AND seq>? AND seq<=? ORDER BY seq LIMIT 21").bind(before.id,previous.lastReadSeq,before.revision).all<WorldEvent&{sources:string}>()).results.map(e=>({...e,sources:JSON.parse(e.sources) as string[]}));
    const memory=(await this.db.prepare("SELECT id,seq,at,kind,text,sources FROM campus_events WHERE actor_id=? AND kind='memory' ORDER BY seq DESC LIMIT 8").bind(before.id).all<WorldEvent&{sources:string}>()).results.map(e=>({...e,sources:JSON.parse(e.sources) as string[]}));
    const cutoff=unread.length>20?unread[19].seq:before.revision;
    const known=[...new Map([...memory,...history,...unread.slice(0,20)].filter(e=>e.seq<=cutoff).map(e=>[e.id,e])).values()].sort((a,b)=>a.seq-b.seq);
    advanceClock(previous,this.clock(),[]);
    const nearby=await this.nearby(previous),pending=await this.conversations(before.id,previous.lastSocialSeq??0,21,true);
    const socialCutoff=pending.length>20?pending[19].seq:pending.at(-1)?.seq??previous.lastSocialSeq??0;
    const conversations=[...new Map([...(await this.conversations(before.id,0,12)),...pending.slice(0,20)].filter(e=>e.seq<=socialCutoff).map(e=>[e.id,e])).values()].sort((a,b)=>a.seq-b.seq);
    let acquired=false;
    const c=await this.change(ownerId,(c,_e,row,now)=>{
      acquired=false;c.heartbeatAt=now;c.connectedUntil=Math.min(endsAt,now+4*3600000);c.driverName=clientName?clientName.trim().slice(0,60):(viaBrowser?'本机 Codex · 页面连接':'本机 Codex · 直连');
      const budget=dailyBudget(c,now);
      if(c.usage.hourStart+3600000<=now)c.usage={...c.usage,hourStart:now,calls:0};
      const due=c.lastHumanSeq>c.lastReadSeq||(!c.motion&&c.nextWake<=now)||(c.socialEnabled&&pending.some(e=>e.recipientId===c.id&&e.seq>(c.lastSocialSeq??0))&&(c.nextSocialAt??0)<=now);
      if(c.paused||!due||c.retryAt>now||endsAt<=now||c.usage.calls>=12||budget.calls>=budget.dailyLimit||(c.lease&&c.lease.until>now))return;
      // A stale history snapshot cannot acknowledge newer private messages.
      const observedSeq=Math.min(row.revision,cutoff);
      c.lease={id:driverId+':'+crypto.randomUUID(),until:now+180000,observedSeq,observedSocialSeq:socialCutoff,nearbyIds:nearby.map(n=>n.id),sourceIds:[...known.filter(e=>e.seq<=observedSeq&&e.kind!=='profile'&&e.kind!=='plan').map(e=>e.id),...conversations.map(e=>e.id)]};
      c.usage.calls++;budget.calls++;c.driverError='';acquired=true;
    });
    const dailyLimited=c.budget!.calls>=c.budget!.dailyLimit;
    if(!acquired){
      const now=this.clock(),resumeAt=dailyLimited?nextBudgetDay(now):c.usage.calls>=12?c.usage.hourStart+3600000:Math.max(now+10000,c.retryAt);
      return {ready:false,paused:c.paused,retryAfter:Math.max(10,Math.ceil((resumeAt-now)/1000)),limited:dailyLimited||c.usage.calls>=12,limitReason:dailyLimited?'daily':c.usage.calls>=12?'hourly':null,budget:c.budget};
    }
    return {ready:true,leaseId:c.lease!.id,serverNow:this.clock(),dayPlan:c.dayPlan??null,planningNeeded:c.dayPlan?.day!==campusDay(this.clock()),...await this.socialContext(c),character:{id:c.id,name:c.name,gender:c.gender??'unspecified',profile:c.profile,personalMemory:c.personalMemory??null,place:c.place,moving:!!c.motion,destination:c.motion?.to??null,arrivalAt:c.motion?.endAt??null,activity:c.activity,intention:c.intention,energy:Math.round(c.energy),socialEnabled:!!c.socialEnabled},places:WORLD_PLACES,events:known.filter(e=>e.seq<=c.lease!.observedSeq),newMessages:unread.filter(e=>e.seq>c.lastReadSeq&&e.seq<=c.lease!.observedSeq),nearby:c.socialEnabled&&!c.motion?nearby:[],conversations,newConversations:pending.filter(e=>e.seq>(c.lastSocialSeq??0)&&e.seq<=c.lease!.observedSocialSeq!)};
  }
  async decide(ownerId:string,leaseId:string,input:unknown,usage:{inputTokens:number;outputTokens:number}){
    const decision=Decision.parse(input);
    const actor=await this.row(ownerId),pair=decision.speech?await this.pairHistory(actor.id,decision.speech.to):[];
    return this.change(ownerId,(c,events,_row,now,effect)=>{
      if(c.lastDecisionId===leaseId)return;
      if(c.paused||!c.lease||c.lease.id!==leaseId||c.lease.until<=now)throw new WorldError(409,'这次思考已经过期，结果未执行。');
      if(c.motion&&decision.action!=='continue')throw new WorldError(422,'角色正在途中，需要先完成当前行程。');
      if(decision.memory&&(!decision.sourceEventIds.length||decision.sourceEventIds.some(id=>!c.lease!.sourceIds.includes(id))))throw new WorldError(422,'记忆必须关联角色已知的真实事件。');
      if(decision.speech){
        if(!c.socialEnabled||c.motion||decision.action!=='stay'||!c.lease.nearbyIds?.includes(decision.speech.to))throw new WorldError(422,'只能与本次观察中同在一个地点的角色交谈。');
        if((c.nextSocialAt??0)>now)throw new WorldError(422,'先给对方一点时间，下次再交谈。');
        const dialogue=dialogueState(c.id,decision.speech.to,pair,now);
        if(decision.speech.kind==='end'?!dialogue.canEnd:!dialogue.canSpeak)throw new WorldError(422,'这段交谈正在等待对方或已经结束，请先继续自己的日常。');
        effect.speech={id:crypto.randomUUID(),decisionId:leaseId,to:decision.speech.to,text:decision.speech.text,place:c.place,kind:decision.speech.kind,after:pair[0]?.seq??0};
      }
      try{const update=updateDayPlan(c,decision,now);if(update)events.push({kind:'plan',text:update});}catch(e){throw new WorldError(422,(e as Error).message);}
      applyDecision(c,decision,now,events);
      if(!c.motion&&c.dayPlan?.day===campusDay(now)){const next=c.dayPlan.items.find(item=>item.status==='pending'&&item.notBefore>now);if(next)c.nextWake=Math.min(c.nextWake,next.notBefore);}
      c.lastSocialSeq=Math.max(c.lastSocialSeq??0,c.lease.observedSocialSeq??0);c.nextSocialAt=now+90000;
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
