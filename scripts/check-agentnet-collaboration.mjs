import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sqliteStore,migrate } from './sqlite-store.mjs';
import { WorldService } from '../lib/world-service.ts';
const file=path.join(await mkdtemp(path.join(tmpdir(),'agentnet-collaboration-')),'test.sqlite');
let db=sqliteStore(file),now=Date.parse('2026-09-20T01:00:00Z');migrate(db,path.resolve('drizzle'));
const w=()=>new WorldService(db,()=>now),zero={inputTokens:0,outputTokens:0};
const stay={action:'stay',destination:'beida',activity:'阅读与整理想法',intention:'和伙伴整理学习计划',reply:'',memory:'',sourceEventIds:[],waitSeconds:90};
const observe=owner=>w().observe(owner,crypto.randomUUID(),now+600000);
const record=async(owner,id)=>(await w().view(owner)).collaborations.find(c=>c.id===id);
const fail=fn=>assert.rejects(fn,e=>[409,422].includes(e.status));
const ids={};
for(const owner of ['a','b','c','d','e','f','g','h','i','j']){await w().create(owner,owner,'private_'+owner,true);ids[owner]=(await w().row(owner)).id;await w().issueAgentToken(owner,owner.charCodeAt(0).toString(16).repeat(32));}
const send=async(owner,command,extra={})=>{const o=await observe(owner);assert(o.ready,owner+' must be ready');const args={...stay,...extra,collaboration:command};await w().decide(owner,o.leaseId,args,zero);return {o,args};};
const update=async(owner,id,op,extra={})=>send(owner,{op,id,revision:(await record(owner,id)).revision,...extra});
// Inject a database failure after the action and notification writes: the entire batch must roll back.
const rollbackId=crypto.randomUUID(),rollbackObservation=await observe('i'),rollbackDecision={...stay,collaboration:{op:'invite',id:rollbackId,to:ids.j,goal:'原子协作',part:'一起确认'}};
const broken=new WorldService({...db,batch:statements=>db.batch([...statements,db.prepare('INSERT INTO deliberately_missing_table VALUES (1)')])},()=>now);
await assert.rejects(()=>broken.decide('i',rollbackObservation.leaseId,rollbackDecision,zero));
assert.equal(await record('i',rollbackId),undefined);assert.equal((await w().view('i')).conversations.length,0);
await w().decide('i',rollbackObservation.leaseId,rollbackDecision,zero);assert.equal((await record('j',rollbackId)).status,'pending');
await w().setPrivacy('a',{publicSummary:'喜欢公开的读书交流',blockedTopics:'禁止秘密',blockedTerms:['秘密甲']});
const id=crypto.randomUUID();let o=await observe('a');
assert.equal(o.nearby.find(p=>p.id===ids.b).publicSummary,'');assert(!JSON.stringify(o.nearby).includes('private_'));
await fail(()=>w().decide('a',o.leaseId,{...stay,collaboration:{op:'invite',id,to:ids.b,goal:'秘密甲',part:'共同整理'}},zero));
await fail(()=>w().decide('a',o.leaseId,{...stay,collaboration:{op:'invite',id,to:ids.b,goal:'公开目标',part:'秘 密 甲'}},zero));
const invitation={...stay,collaboration:{op:'invite',id,to:ids.b,goal:'整理学习计划',part:'安排练习内容'}};
await w().decide('a',o.leaseId,invitation,zero);
await w().decide('a',o.leaseId,invitation,zero);assert.equal((await w().view('a')).conversations.length,1);
assert.equal((await w().view('a')).character.budget.calls,1,'Lost-response retry does not reserve another activity');
assert.equal((await record('b',id)).status,'pending');assert.equal((await w().view('c')).collaborations.length,0);
assert.equal(await w().collaboration(id,ids.c),null);
o=await observe('c');await fail(()=>w().decide('c',o.leaseId,{...stay,collaboration:{op:'accept',id,revision:1}},zero));await w().decide('c',o.leaseId,stay,zero);
now+=91000;assert((await w().waitForEvents('b','B',0)).reasons.includes('conversation'));
const bObs=await observe('b');assert(bObs.newConversations.some(e=>e.kind==='collaboration'));
await fail(()=>w().decide('a',bObs.leaseId,{...stay,collaboration:{op:'accept',id,revision:1}},zero));
await w().decide('b',bObs.leaseId,{...stay,collaboration:{op:'accept',id,revision:1}},zero);
now+=91000;
const aSubmit=await send('a',{op:'submit',id,revision:2,result:'周一阅读，周三讨论。'});
now+=91000;await update('b',id,'submit',{result:'周二做两道练习，周末回顾。'});
assert.equal((await record('a',id)).status,'active');
now+=91000;await update('a',id,'confirm');assert.equal((await record('b',id)).status,'active');
// Restart preserves submissions, consent and the unread event cursor.
db.close();db=sqliteStore(file);migrate(db,path.resolve('drizzle'));
assert((await record('b',id)).confirmations[ids.a]);
now+=91000;const done=await send('b',{op:'confirm',id,revision:5},{reply:'我们已共同确认学习计划；内容还需要实践检验。'});
assert.equal((await record('a',id)).status,'completed');assert.equal((await w().view('a')).conversations.length,6);
assert.equal((await w().view('b')).events.filter(e=>e.kind==='reply').length,1);
await w().decide('b',done.o.leaseId,done.args,zero);assert.equal((await w().view('a')).conversations.length,6);
await fail(()=>w().decide('a',aSubmit.o.leaseId,aSubmit.args,zero));assert.equal((await w().view('a')).conversations.length,6);
assert.equal((await w().view('a')).character.budget.calls,3);assert.equal((await w().view('b')).character.budget.calls,3);

// Ignored and rejected invitations: no automatic acceptance or repeated notifications.
const ignored=crypto.randomUUID();await send('d',{op:'invite',id:ignored,to:ids.e,goal:'看看校园',part:'分享观察'});
now+=91000;o=await observe('d');await fail(()=>w().decide('d',o.leaseId,{...stay,collaboration:{op:'invite',id:crypto.randomUUID(),to:ids.e,goal:'重复催促',part:'回应'}},zero));await w().decide('d',o.leaseId,stay,zero);
assert.equal((await record('e',ignored)).status,'pending');assert.equal((await w().view('e')).conversations.length,1);
await update('e',ignored,'reject');assert.equal((await record('d',ignored)).status,'rejected');

// New submissions invalidate old confirmations; cannot submit private terms or proxy consent.
const revisionId=crypto.randomUUID();await send('f',{op:'invite',id:revisionId,to:ids.g,goal:'共同整理',part:'补充建议'});now+=91000;await update('g',revisionId,'accept');
now+=91000;await update('f',revisionId,'submit',{result:'第一版'});now+=91000;await update('g',revisionId,'submit',{result:'我的第一版'});
now+=91000;await update('f',revisionId,'confirm');now+=91000;await update('g',revisionId,'submit',{result:'修改后的版本'});
assert.deepEqual((await record('f',revisionId)).confirmations,{});
now+=91000;o=await observe('f');await fail(()=>w().decide('f',o.leaseId,{...stay,collaboration:{op:'confirm',id:revisionId,revision:5}},zero));
await w().setPrivacy('f',{publicSummary:'',blockedTopics:'',blockedTerms:['秘密乙']});await w().message('f','重新检查',crypto.randomUUID());o=await observe('f');
await fail(()=>w().decide('f',o.leaseId,{...stay,collaboration:{op:'submit',id:revisionId,revision:6,result:'秘密乙'}},zero));await w().decide('f',o.leaseId,stay,zero);

// Pause, budget, revocation, disconnect and co-location are independent gates; progress survives.
await w().pause('g',true);assert((await record('f',revisionId)).interactionReason.includes('暂停'));
assert.equal((await observe('g')).ready,false);await w().pause('g',false);await w().setDailyLimit('g',0);assert((await record('f',revisionId)).peer.state.includes('体力'));
const revoked=w();await revoked.driverOwner('67'.repeat(32));await w().disconnect('g');await assert.rejects(()=>revoked.observe('g','x',now+600000),e=>e.status===401);
assert.equal((await record('f',revisionId)).status,'active');
now+=91000;o=await observe('f');await w().change('g',c=>{c.place='library';});
await fail(()=>w().decide('f',o.leaseId,{...stay,collaboration:{op:'confirm',id:revisionId,revision:6}},zero));
await w().decide('f',o.leaseId,{...stay,collaboration:{op:'cancel',id:revisionId,revision:6}},zero);
assert.equal((await record('g',revisionId)).status,'cancelled','Exit is status-only and remains possible after the peer leaves');

// Simultaneous same-character clients receive exactly one lease.
const concurrent=await Promise.all([observe('h'),observe('h')]);assert.equal(concurrent.filter(v=>v.ready).length,1);assert.equal((await w().view('h')).character.budget.calls,1);
const before=(await w().view('h')).events.length;now+=70000;assert.equal((await w().view('h')).connected,false);assert.equal((await w().view('h')).events.length,before,'No driver means no new thought events');
await w().pause('g',true);now+=86400000;assert((await w().waitForEvents('g','test',0)).paused);
db.close();console.log('PASS: complete six-turn collaboration, own budgets, feedback, confirmation revisions, ignored/rejected invites, idempotency, restart/cursors, private fields, scoped discovery, nonparticipant/proxy rejection, pause/limits/revocation, co-location race, remote status-only exit and competing leases. Synthetic local agents; no paid inference.');
