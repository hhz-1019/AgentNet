import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sqliteStore } from './sqlite-store.mjs';
import { randomBytes } from 'node:crypto';
function localTestStore(site){assert(['localhost','127.0.0.1'].includes(new URL(site).hostname));assert(process.env.CAMPUS_DB_PATH?.includes('test'));return sqliteStore(process.env.CAMPUS_DB_PATH);}

// Two real protocol transports, deterministic decisions, synthetic local campus identities.
// Only social cooldown timestamps are advanced in the guarded local fixture; no paid models.
const site=process.env.CAMPUS_TEST_URL??'http://127.0.0.1:3110',store=localTestStore(site);
const http=async(path,data,headers={})=>{const r=await fetch(site+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
const owner=async name=>{const recoveryKey='campus_owner_'+randomBytes(32).toString('hex');const response=await fetch(site+'/api/campus/account',{method:'POST',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify({op:'create',name,socialEnabled:true,recoveryKey})});assert.equal(response.status,200);const created=await response.json(),headers={Cookie:response.headers.get('set-cookie').split(';')[0],Origin:site};const issued=await http('/api/campus/account',{op:'agent-token'},headers);return {id:created.characterId,headers,token:issued.token};};
const a=await owner('协作 MCP 甲'),b=await owner('协作 HTTP 乙'),outsider=await owner('协作旁观者');
const client=new Client({name:'AgentNet integration fixture MCP',version:'1.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(site+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+a.token}}}));
const callA=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content.find(c=>c.type==='text').text);};
const callB=(name,args={})=>http('/api/campus/tools/'+name,args,{Authorization:'Bearer '+b.token});
const stay={action:'stay',destination:'beida',activity:'阅读与整理想法',intention:'完成一项学习协作',reply:'',memory:'',sourceEventIds:[],waitSeconds:90};
const cool=()=>{for(const id of [a.id,b.id])store.sql.prepare("UPDATE campus_characters SET state=json_set(state,'$.nextSocialAt',0,'$.nextWake',0),revision=revision+1 WHERE id=?").run(id);};
const id=crypto.randomUUID();
try{
  const catalog=await client.listTools();assert(catalog.tools.find(t=>t.name==='campus_act').inputSchema.properties.decision.properties.collaboration);
  const skill=await fetch(site+'/skills/join-agentnet/SKILL.md');assert.equal(skill.status,200);assert((await skill.text()).startsWith('---'));
  assert.equal((await callA('campus_status')).character.id,a.id);assert.equal((await callB('campus_status')).character.id,b.id);
  const commands=[['a',{op:'invite',id,to:b.id,goal:'一周学习计划',part:'练习安排'}],['b',{op:'accept',id,revision:1}],['a',{op:'submit',id,revision:2,result:'周一阅读，周三交流。'}],['b',{op:'submit',id,revision:3,result:'周二练习，周末回顾。'}],['a',{op:'confirm',id,revision:4}],['b',{op:'confirm',id,revision:5}]];
  for(const [who,command] of commands){
    cool();const call=who==='a'?callA:callB;
    assert((await call('campus_wait',{timeoutSeconds:0})).ready);
    const obs=await call('campus_observe',{clientName:who==='a'?'MCP 协议测试':'HTTP 协议测试'});assert(obs.ready);
    if(command.op!=='invite')assert(obs.collaborations.some(c=>c.id===id&&c.revision===command.revision));
    const args={leaseId:obs.leaseId,decision:{...stay,collaboration:command,reply:command.op==='confirm'?'我已经确认双方的学习计划。':''}};
    const result=await call('campus_act',args);assert(result.accepted);
    await call('campus_act',args); // Lost response simulation: exact replay, no extra model/observation.
  }
  const av=await callA('campus_status'),bv=await callB('campus_status');
  for(const v of [av,bv]){assert.equal(v.collaborations.find(c=>c.id===id).status,'completed');assert.equal(v.character.budget.calls,3);assert.equal(v.conversations.filter(c=>c.kind==='collaboration').length,6);assert(v.events.some(e=>e.kind==='reply'));}
  const hidden=await http('/api/campus/tools/campus_status',{}, {Authorization:'Bearer '+outsider.token});assert.equal(hidden.collaborations.length,0);assert(!JSON.stringify(hidden).includes('一周学习计划'));
  console.log('PASS: MCP SDK + HTTP clients independently complete invitation, acceptance, own results, two confirmations, feedback and replay; third identity isolated. Local protocol E2E with synthetic decisions, accelerated cooldown, no commercial clients or paid model.');
}finally{await client.close();store.close();}
