import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { sqliteStore,migrate } from './sqlite-store.mjs';
import { WorldService } from '../lib/world-service.ts';
import { campusDay } from '../lib/world-life.ts';
import { runCampusTool,toolCatalog } from '../lib/campus-tools.ts';

const dir=await mkdtemp(path.join(tmpdir(),'agentnet-life-')),file=path.join(dir,'world.sqlite');
let db=sqliteStore(file),now=Date.parse('2026-09-18T02:00:00Z');migrate(db,path.resolve('drizzle'));
const world=()=>new WorldService(db,()=>now),zero={inputTokens:0,outputTokens:0};
const stay={action:'stay',destination:'beida',activity:'观察周围',intention:'在校园观察。',reply:'',memory:'',sourceEventIds:[],waitSeconds:1800};
const observe=owner=>world().observe(owner,crypto.randomUUID(),now+600000);
await world().create('a','甲','PRIVATE_A',true);await world().create('b','乙','PRIVATE_B',true);await world().create('c','旁观者','',true);
const aid=(await world().row('a')).id,bid=(await world().row('b')).id;
assert(toolCatalog().tools.some(t=>t.name==='campus_wait'));
await assert.rejects(()=>runCampusTool(world(),'a','campus_wait',{timeoutSeconds:26}));

let obs=await observe('a');const due=now+600000;
await assert.rejects(()=>world().decide('a',obs.leaseId,{...stay,plan:[{place:'library',activity:'观察周围',notBefore:now+86400000,intention:'无效跨日'}]},zero),e=>e.status===422);
await world().decide('a',obs.leaseId,{...stay,plan:[{place:'library',activity:'观察周围',notBefore:due,intention:'去图书馆了解环境'}]},zero);
let view=await world().view('a');assert.equal(view.character.nextWake,due);assert.equal(view.character.dayPlan.items[0].status,'pending');
const calls=view.character.budget.calls;
assert.equal((await world().waitForEvents('a','test',0)).ready,false);
assert.equal((await world().view('a')).character.budget.calls,calls,'Waiting cannot spend decision budget');
await world().message('a','PRIVATE_PENDING 银杏机器人',crypto.randomUUID());
assert((await world().waitForEvents('a','test',0)).reasons.includes('human_message'));
obs=await observe('a');await world().failure('a',obs.leaseId,'模拟中断');
db.close();db=sqliteStore(file);now+=120001;
assert((await world().waitForEvents('a','test',0)).ready,'Unread message survives failed decision and database reopen');
obs=await observe('a');assert(obs.newMessages.some(e=>e.text.includes('PRIVATE_PENDING')));
await assert.rejects(()=>world().decide('a',obs.leaseId,{...stay,planProgress:{index:0,status:'completed'}},zero),e=>e.status===422);
assert.equal((await world().view('a')).character.dayPlan.items[0].status,'pending');
await world().decide('a',obs.leaseId,{...stay,action:'move',destination:'library'},zero);
now=Math.max(due,(await world().view('a')).character.motion.endAt)+1;
assert((await world().waitForEvents('a','test',0)).ready,'Arrival/scheduled activity wakes the driver without a browser');
obs=await observe('a');await world().decide('a',obs.leaseId,{...stay,planProgress:{index:0,status:'completed'}},zero);
assert.equal((await world().view('a')).character.dayPlan.items[0].status,'completed');
assert.equal((await world().waitForEvents('a','test',0)).ready,false,'Successful decision durably acknowledges the message');
assert(!JSON.stringify(await world().view('b')).includes('PRIVATE_PENDING'));
assert(!JSON.stringify(await world().view('b')).includes('去图书馆了解环境'));

// Same keyword: sourced reflection ranks before generic activity; private records remain scoped.
const source=(await world().recall('a','银杏')).memories[0];
await world().change('a',(_c,events)=>{events.push({kind:'memory',text:'银杏机器人：这次交流让我想了解机器人。',sources:[source.id]});events.push({kind:'activity',text:'银杏机器人相关活动。'});});
const ranked=await world().recall('a','银杏');assert.equal(ranked.method,'keyword-recency-importance');assert.equal(ranked.memories[0].kind,'memory');assert(ranked.memories[0].sources.includes(source.id));
assert.equal((await world().recall('c','银杏')).memories.length,0);

// Return for a real co-located exchange; no browser is required by either driver.
now+=3600000;obs=await observe('a');await world().decide('a',obs.leaseId,{...stay,action:'move',destination:'beida'},zero);now=(await world().view('a')).character.motion.endAt+1;
const send=async(owner,to,kind='message')=>{const o=await observe(owner);assert(o.ready);await world().decide(owner,o.leaseId,{...stay,speech:{to,text:kind==='end'?'下次聊。':'聊聊校园。',kind}},zero);return o;};
await send('a',bid);now+=91000;
await world().message('a','可以再打招呼吗？',crypto.randomUUID());
obs=await observe('a');await assert.rejects(()=>world().decide('a',obs.leaseId,{...stay,speech:{to:bid,text:'重复招呼'}},zero),e=>e.status===422);await world().decide('a',obs.leaseId,stay,zero);
await send('b',aid);view=await world().view('a');assert.equal(view.relationships[0].received,1);assert.equal(view.dialogues[0].status,'active');
assert.equal((await world().view('c')).relationships.length,0,'Bystanders cannot see private relationships');
now+=91000;await send('a',bid,'end');assert.equal((await world().view('b')).dialogues[0].status,'ended');
const bLease=await observe('b');await assert.rejects(()=>world().decide('b',bLease.leaseId,{...stay,speech:{to:aid,text:'无视结束'}},zero),e=>e.status===422);await world().decide('b',bLease.leaseId,stay,zero);
assert.equal((await world().view('a')).relationships[0].sent,1,'Farewell is not counted as another relationship message');
now+=1800001;
for(let i=0;i<8;i++){await send(i%2?'b':'a',i%2?aid:bid);now+=91000;}
assert.equal((await world().view('a')).dialogues[0].turns,8);assert.equal((await world().view('a')).dialogues[0].status,'ended');
obs=await observe('a');await assert.rejects(()=>world().decide('a',obs.leaseId,{...stay,speech:{to:bid,text:'第九条'}},zero),e=>e.status===422);await world().decide('a',obs.leaseId,stay,zero);
db.close();db=sqliteStore(file);assert.equal((await world().view('a')).dialogues[0].status,'ended','Conversation ceiling survives restart');

now+=86400000;obs=await observe('a');assert(obs.planningNeeded);assert.notEqual(obs.dayPlan.day,campusDay(now));
await assert.rejects(()=>world().decide('a',obs.leaseId,{...stay,planProgress:{index:0,status:'skipped'}},zero),e=>e.status===422);
await world().decide('a',obs.leaseId,stay,zero);
await world().pause('a',true);assert((await world().waitForEvents('a','test',0)).paused);await world().pause('a',false);
await world().setDailyLimit('a',1);assert((await world().waitForEvents('a','test',0)).limited);

// A long-poll response cannot survive token revocation, and cancellation ends promptly.
await world().issueAgentToken('c','c'.repeat(64));obs=await observe('c');await world().decide('c',obs.leaseId,stay,zero);
const driver=world();await driver.driverOwner('c'.repeat(64));const waiting=driver.waitForEvents('c','test',3);
setTimeout(()=>void world().disconnect('c'),50);await assert.rejects(()=>waiting,e=>e.status===401);
const abort=new AbortController(),start=Date.now();setTimeout(()=>abort.abort(),50);await world().waitForEvents('b','test',3,abort.signal);assert(Date.now()-start<1000);
db.close();
console.log('PASS: durable unacknowledged inbox/restart, no-spend wait, pause/cap/revocation/cancel, independent plans, truthful progress and day rollover, evidence-ranked private memory, reciprocal relationships, explicit endings and eight-turn ceiling. No paid model or production data used.');
