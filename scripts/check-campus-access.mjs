import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// Fixture writes are strictly local. No real accounts, model keys or production data.
const site='http://localhost:3000',clients=[];
async function api(path,data,headers={}){
  const r=await fetch(site+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
  const result=r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text();return {status:r.status,data:result,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
}
async function person(name){
  const recoveryKey='campus_owner_'+randomBytes(32).toString('hex');
  const created=await api('/api/campus/account',{op:'create',name,socialEnabled:true,recoveryKey},{Origin:site});
  assert.equal(created.status,200,JSON.stringify(created.data));assert(created.headers.get('set-cookie').includes('HttpOnly'));assert(created.headers.get('set-cookie').includes('SameSite=Lax'));
  const headers={Origin:site,Cookie:created.cookie};
  const issued=await api('/api/campus/account',{op:'agent-token'},headers);assert.equal(issued.status,200);
  const view=await api('/api/world',undefined,headers);assert.equal(view.status,200);assert.equal(view.data.authMode,'campus');
  return {name,recoveryKey,headers,id:view.data.character.id,token:issued.data.token};
}
async function mcp(token,name){const client=new Client({name,version:'1.0'});const transport=new StreamableHTTPClientTransport(new URL(site+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}});await client.connect(transport);clients.push(client);return client;}
const rpc=async(client,name,args={})=>{const r=await client.callTool({name,arguments:args});const text=r.content.find(c=>c.type==='text').text;let data;try{data=JSON.parse(text);}catch{data={error:text};}return {error:!!r.isError,data};};
const httpTool=(person,name,args={})=>api('/api/campus/tools/'+name,args,{Authorization:'Bearer '+person.token});
const stay={action:'stay',destination:'beida',activity:'观察周围',intention:'在广场观察周围。',reply:'',memory:'',sourceEventIds:[],waitSeconds:90,speech:null};

try{
  assert.equal((await api('/api/campus/account',{op:'create',name:'被拒绝',recoveryKey:'campus_owner_'+randomBytes(32).toString('hex')},{Origin:'https://foreign.example'})).status,403);
  const a=await person('协议验证甲'),b=await person('协议验证乙');
  const retry=await api('/api/campus/account',{op:'create',name:'不可覆盖的昵称',recoveryKey:a.recoveryKey},{Origin:site});assert.equal(retry.data.characterId,a.id);
  assert.equal((await api('/api/world',undefined,a.headers)).data.character.name,a.name);
  const openapi=await api('/api/campus/openapi');assert.equal(openapi.data.openapi,'3.1.0');assert.equal(Object.keys(openapi.data.paths).length,4);
  const metadata=await api('/api/campus/tools');assert.equal(metadata.status,200);assert.equal(metadata.data.tools.length,4);assert(!JSON.stringify(metadata.data).includes(a.recoveryKey));
  assert.equal((await httpTool({token:a.recoveryKey},'campus_status')).status,401,'Owner secrets are not Agent credentials');
  assert.equal((await api('/api/campus/account',{op:'agent-token'},{Origin:site,Authorization:'Bearer '+a.token})).status,401,'Agent tokens cannot grant owner access');
  assert.equal((await api('/api/campus/tools/campus_status',{},a.headers)).status,401,'Browser cookies do not authorize Agent operations');
  assert.equal((await httpTool(a,'campus_status',{ownerId:b.id})).status,400,'Unknown identity selectors are rejected');
  assert.equal((await api('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},a.headers)).status,401);
  const ca=await mcp(a.token,'Independent MCP Client A'),cb=await mcp(b.token,'Independent MCP Client B');
  const listed=await ca.listTools();assert.deepEqual(listed.tools.map(t=>t.name).sort(),metadata.data.tools.map(t=>t.name).sort());
  assert.equal((await rpc(ca,'campus_status')).data.character.id,a.id);assert.equal((await rpc(cb,'campus_status')).data.character.id,b.id);
  const privateText='只属于甲的私信 '+randomUUID();await api('/api/world',{op:'message',text:privateText,requestId:randomUUID()},a.headers);
  const observationA=await rpc(ca,'campus_observe',{clientName:'任意 MCP 客户端'});assert(observationA.data.ready);assert(observationA.data.nearby.some(n=>n.id===b.id));
  assert.equal((await httpTool(a,'campus_observe',{})).data.ready,false,'MCP and HTTP share the same decision lease');
  const actionA={leaseId:observationA.data.leaseId,decision:{...stay,speech:{to:b.id,text:'你好，一起看看校园？'}}};
  assert.equal((await rpc(ca,'campus_act',actionA)).error,false);
  const observationB=await httpTool(b,'campus_observe',{clientName:'通用模型 API 客户端'});assert.equal(observationB.status,200);assert(observationB.data.ready);assert(!JSON.stringify(observationB.data).includes(privateText));assert(observationB.data.newConversations.some(m=>m.speakerId===a.id));
  const wrong=await rpc(ca,'campus_act',{leaseId:observationB.data.leaseId,decision:stay});assert(wrong.error);assert.equal(wrong.data.status,409);
  const actionB={leaseId:observationB.data.leaseId,decision:{...stay,speech:{to:a.id,text:'好，我想先在这里待一会儿。'}}};
  assert.equal((await httpTool(b,'campus_act',actionB)).status,200);
  assert.equal((await rpc(ca,'campus_act',actionA)).error,false);
  assert.equal((await rpc(ca,'campus_status')).data.conversations.length,2,'Retries do not duplicate speech');
  assert.equal((await rpc(cb,'campus_status')).data.conversations.length,2);
  assert.equal((await rpc(ca,'campus_observe',{ownerId:b.id})).error,true);
  await api('/api/world',{op:'message',text:'一条让当前角色再观察的私信',requestId:randomUUID()},a.headers);
  const pending=await rpc(ca,'campus_observe');assert(pending.data.ready);
  const replacement=await api('/api/campus/account',{op:'agent-token'},a.headers);assert.equal(replacement.status,200);
  assert.equal((await httpTool(a,'campus_status')).status,401);await assert.rejects(()=>ca.callTool({name:'campus_status',arguments:{}}));
  a.token=replacement.data.token;
  assert.equal((await httpTool(a,'campus_act',{leaseId:pending.data.leaseId,decision:stay})).status,409,'Rotation invalidates the old decision lease');
  const next=await httpTool(a,'campus_observe');assert(next.data.ready);
  assert.equal((await httpTool(a,'campus_act',{leaseId:next.data.leaseId,decision:{...stay,action:'move',destination:'library'}})).status,200);
  const motion=(await httpTool(a,'campus_status')).data.character.motion;assert.equal(motion.to,'library');assert(motion.endAt>motion.startAt);
  await api('/api/campus/account',{op:'signout'},a.headers);
  assert.equal((await httpTool(a,'campus_status')).status,200,'Closing the browser does not revoke the separate Agent');
  const restored=await api('/api/campus/account',{op:'restore',recoveryKey:a.recoveryKey},{Origin:site});assert.equal(restored.data.characterId,a.id);
  a.headers.Cookie=restored.cookie;
  const changed=await api('/api/campus/account',{op:'recovery-key'},a.headers);assert.equal(changed.status,200);
  assert.equal((await api('/api/world',undefined,a.headers)).status,401,'Old owner sessions stop working');
  assert.equal((await api('/api/campus/account',{op:'restore',recoveryKey:a.recoveryKey},{Origin:site})).status,401);
  a.headers.Cookie=changed.cookie;
  assert.equal((await api('/api/world',undefined,a.headers)).data.character.id,a.id);
  const c=await person('通用模型连接验证'),modelKey=randomBytes(32).toString('hex');let providerCalls=0;
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    assert.equal(req.headers.authorization,'Bearer '+modelKey);assert(!raw.includes(c.token),'Campus credentials must not reach the model provider');
    const input=JSON.parse(raw),observation=JSON.parse(input.messages[1].content);assert.equal(input.model,'fixture-model');assert.equal(input.tools[0].function.name,'campus_act');providerCalls++;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'fixture-call',type:'function',function:{name:'campus_act',arguments:JSON.stringify({leaseId:observation.leaseId,decision:{...stay,reply:'通用模型工具调用验证完成。'}})}}]}}],usage:{prompt_tokens:20,completion_tokens:10}}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  try{
    const child=spawn(process.execPath,['public/downloads/campus-api-agent.mjs'],{env:{...process.env,CAMPUS_URL:site,CAMPUS_TOKEN:c.token,MODEL_API_URL:`http://127.0.0.1:${provider.address().port}/chat/completions`,MODEL_API_KEY:modelKey,MODEL_NAME:'fixture-model',RUN_MINUTES:'1',MAX_DECISIONS:'1'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const timeout=setTimeout(()=>child.kill(),30000);const code=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timeout);
    assert.equal(code,0,output);assert.equal(providerCalls,1);assert(!output.includes(modelKey));assert(!output.includes(c.token));
    const result=await api('/api/world',undefined,c.headers);assert(result.data.events.some(e=>e.text==='通用模型工具调用验证完成。'));
  }finally{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await api('/api/world',{op:'disconnect'},c.headers);}
  await api('/api/world',{op:'disconnect'},a.headers);assert.equal((await httpTool(a,'campus_status')).status,401);
  await api('/api/world',{op:'disconnect'},b.headers);
  console.log('PASS: independent browser identity/recovery, scoped Agent credentials, official MCP SDK handshake/list/call, two isolated clients, MCP-to-HTTP conversations, shared leases, private messages, idempotency, actual routes, immediate revocation and generic model adapter with a local Function Calling provider. No real model-provider account was used.');
}finally{await Promise.allSettled(clients.map(c=>c.close()));}
