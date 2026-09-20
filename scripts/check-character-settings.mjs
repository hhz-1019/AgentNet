import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sqliteStore,migrate } from './sqlite-store.mjs';
import { WorldService } from '../lib/world-service.ts';
import { runCampusTool,toolCatalog } from '../lib/campus-tools.ts';
import { WORLD_PLACES,walkingRoute,routePosition } from '../lib/world-map.ts';
import { Decision } from '../lib/world-decision.ts';

const dir=await mkdtemp(path.join(tmpdir(),'agentnet-settings-')),file=path.join(dir,'world.sqlite');
let db=sqliteStore(file),now=Date.parse('2026-09-20T02:00:00Z');migrate(db,path.resolve('drizzle'));
const world=()=>new WorldService(db,()=>now),zero={inputTokens:0,outputTokens:0};
const stay={action:'stay',destination:'beida',activity:'观察周围',intention:'看看周围。',reply:'',memory:'',sourceEventIds:[],waitSeconds:14400};
const observe=owner=>world().observe(owner,crypto.randomUUID(),now+600000);
try{
  await world().create('a','甲','',true);await world().create('b','乙','',true);
  const b=(await world().view('b')).character;
  const tools=toolCatalog().tools;assert(tools.some(t=>t.name==='campus_personal_context'));assert(tools.some(t=>t.name==='campus_propose_context'));
  const request={requestId:crypto.randomUUID(),summary:'喜欢篮球，也喜欢在图书馆安静阅读。PRIVATE_CONTEXT',sourceLabel:'经用户授权的当前助手上下文'};
  await runCampusTool(world(),'a','campus_propose_context',request);
  await runCampusTool(world(),'a','campus_propose_context',request);
  let context=await runCampusTool(world(),'a','campus_personal_context',{});
  assert.equal(context.personalMemory,null);assert.equal(context.pending.summary,request.summary);
  await assert.rejects(()=>world().proposeContext('a',{...request,requestId:crypto.randomUUID()}),e=>e.status===409);
  assert(!JSON.stringify(await world().view('b')).includes('PRIVATE_CONTEXT'));
  await world().resolveContext('a',request.requestId,true);
  context=await world().personalContext('a');assert.equal(context.personalMemory.summary,request.summary);assert.equal(context.pending,null);
  await world().proposeContext('a',request);assert.equal((await world().personalContext('a')).pending,null,'Retry after acceptance cannot reopen a proposal');
  const rejected={...request,requestId:crypto.randomUUID(),summary:'不准确的摘要'};await world().proposeContext('a',rejected);await world().resolveContext('a',rejected.requestId,false);
  assert.equal((await world().personalContext('a')).personalMemory.summary,request.summary);
  let o=await observe('a');assert.equal(o.personalContext.personalMemory.summary,request.summary);assert(o.stamina.suggestedIdleSeconds>=300);
  const privacy={publicSummary:'喜欢篮球',blockedTopics:'不谈具体宿舍和成绩',blockedTerms:['PRIVATE_CANARY','432109']};
  await world().setPrivacy('a',privacy);
  await assert.rejects(()=>world().decide('a',o.leaseId,stay,zero),e=>e.status===409,'Privacy changes invalidate old decisions');
  o=await observe('a');assert.deepEqual(o.privacy,privacy);
  for(const text of ['PRIVATE_CANARY','ｐｒｉｖａｔｅ＿ｃａｎａｒｙ','4 3 2 1 0 9'])await assert.rejects(()=>world().decide('a',o.leaseId,{...stay,speech:{to:b.id,text}},zero),e=>e.status===422);
  assert.equal((await world().view('b')).conversations.length,0,'Blocked speech is never delivered');
  await world().decide('a',o.leaseId,{...stay,speech:{to:b.id,text:'我喜欢篮球，你呢？'},reply:'我刚在北大楼前和乙聊了篮球。'},zero);
  assert((await world().view('a')).events.some(e=>e.kind==='reply'&&e.text.includes('篮球')));
  assert.equal((await world().view('b')).conversations.length,1);
  assert(!JSON.stringify(await world().view('b')).includes('PRIVATE_CANARY'));
  let recall=await world().recall('a','篮球');assert(recall.memories.some(e=>e.nature==='witnessed_conversation'));
  await world().message('a','今天感觉如何？',crypto.randomUUID());now+=91000;o=await observe('a');
  const source=o.conversations[0].id;
  await world().decide('a',o.leaseId,{...stay,memory:'我们聊到了篮球，我想继续了解他的兴趣。',sourceEventIds:[source],reply:'今天聊到了篮球，不过我还不知道乙是否喜欢打球。'},zero);
  recall=await world().recall('a','篮球');assert(recall.memories.some(e=>e.nature==='subjective_reflection'&&e.sources.includes(source)));
  const before=(await world().view('a')).character.budget.calls;
  await world().waitForEvents('a','test',0);await world().recall('a','篮球');await world().personalContext('a');
  assert.equal((await world().view('a')).character.budget.calls,before,'Read/recall/wait consume no stamina');
  await world().setDailyLimit('a',0);assert((await world().waitForEvents('a','test',0)).limited);assert.equal((await observe('a')).ready,false);
  await world().setDailyLimit('a',before);assert.equal((await observe('a')).ready,false);
  now+=86400000;o=await observe('a');assert(o.ready);assert.equal(o.stamina.used,1);await world().decide('a',o.leaseId,stay,zero);
  // A new nearby character wakes an otherwise idle resident; one accepted observation acknowledges it.
  assert.equal((await world().waitForEvents('a','test',0)).ready,false);
  await world().create('new','新同学','',true);assert((await world().waitForEvents('a','test',0)).reasons.includes('encounter'));
  o=await observe('a');await world().decide('a',o.leaseId,stay,zero);assert.equal((await world().waitForEvents('a','test',0)).ready,false);
  db.close();db=sqliteStore(file);assert.deepEqual((await world().personalContext('a')).privacy,privacy);assert((await world().recall('a','篮球')).memories.length);
  // Every catalogue destination is accepted and connects through actual server-driven travel.
  await world().create('walker','走访验证');
  for(const place of Object.keys(WORLD_PLACES)){
    const route=walkingRoute('beida',place);assert.deepEqual(route[0],WORLD_PLACES.beida.point);assert.deepEqual(routePosition(route,1),WORLD_PLACES[place].point);
    assert(Decision.safeParse({...stay,action:'move',destination:place}).success);
    now+=14400001;const obs=await observe('walker');assert(obs.ready);
    await world().decide('walker',obs.leaseId,{...stay,action:'move',destination:place},zero);
    const moving=(await world().view('walker')).character;if(moving.motion)now=moving.motion.endAt+1;
    assert.equal((await world().view('walker')).character.place,place);
  }
  for(const from of Object.keys(WORLD_PLACES))for(const to of Object.keys(WORLD_PLACES)){const route=walkingRoute(from,to);assert.deepEqual(route[0],WORLD_PLACES[from].point);assert.deepEqual(route.at(-1),WORLD_PLACES[to].point);}
  console.log(`PASS: ${Object.keys(WORLD_PLACES).length} real catalogue routes and travel, stamina zero/exhaustion/rollover, private context proposal/approval/rejection/restart, literal privacy enforcement, stale lease rejection, personal feedback, sourced subjective recall and no-spend encounter wake. Synthetic local data; no paid model calls.`);
}finally{db.close();}
