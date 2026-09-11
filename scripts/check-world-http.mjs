import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
const site='http://localhost:3000'; // Never run fixture writes against the hosted world.
const token=randomBytes(32).toString('hex'),cookie='__sites_local_auth=1';
async function api(route,command,headers={}){
  const response=await fetch(site+route,{method:command?'POST':'GET',headers:{...(command?{'Content-Type':'application/json'}:{}),...headers},body:command?JSON.stringify(command):undefined});
  const data=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();return {status:response.status,data};
}
assert.equal((await api('/api/world')).status,401);
assert.equal((await api('/api/world',undefined,{'oai-authenticated-user-id':'forged'})).status,401,'Client-supplied identity headers must be stripped');
const human={Cookie:cookie,Origin:site};
assert.equal((await api('/api/world',{op:'create',name:'本地验证角色',profile:'仅供本地接口验证，不进入线上校园。'},{...human,Origin:'https://untrusted.example'})).status,403);
let result=await api('/api/world',{op:'create',name:'本地验证角色',profile:'仅供本地接口验证，不进入线上校园。'},human);
assert.equal(result.status,200,JSON.stringify(result.data));assert(result.data.character);assert.equal(result.data.account,'seedy@sites.test');
const driver={Authorization:`Bearer ${token}`};
result=await api('/api/world/driver',{op:'pair'},driver);assert.equal(result.status,200,JSON.stringify(result.data));
result=await api('/api/world',{op:'claim',code:result.data.code},human);assert.equal(result.status,200,JSON.stringify(result.data));
assert.equal((await api('/api/world',{op:'move',destination:'riverside'},human)).status,400,'The human API does not offer movement commands');
assert.equal((await api('/api/world',{op:'message',text:'本地私聊验证。',requestId:randomUUID()},human)).status,200);
result=await api('/api/world/driver',{op:'observe',driverId:randomUUID(),endsAt:Date.now()+3600000},driver);assert.equal(result.status,200,JSON.stringify(result.data));assert(result.data.ready);
const lease=result.data.leaseId;
result=await api('/api/world/driver',{op:'decide',leaseId:lease,decision:{action:'stay',destination:'beida',activity:'观察周围',intention:'验证角色状态能持久保存。',reply:'本地接口验证已收到。',memory:'',sourceEventIds:[],waitSeconds:300},usage:{inputTokens:0,outputTokens:0}},driver);assert.equal(result.status,200,JSON.stringify(result.data));
result=await api('/api/world',undefined,human);assert(result.data.events.some(e=>e.kind==='reply'&&e.text==='本地接口验证已收到。'));assert.equal(result.data.character.activity,'观察周围');
assert.equal((await api('/api/world',{op:'disconnect'},human)).status,200);
assert.equal((await api('/api/world/driver',{op:'status'},driver)).status,401);
assert.equal((await api('/api/world',{op:'participation',enabled:true},human)).status,200);
result=await api('/api/world',undefined,human);assert(Array.isArray(result.data.nearby));assert(Array.isArray(result.data.conversations));assert.equal(result.data.character.socialEnabled,true);
assert.equal((await api('/api/world/relay',{token,command:{op:'pair'}})).status,401,'Browser relay requires an actual Sites identity');
assert.equal((await api('/api/world/relay',{token,command:{op:'pair'}},{...human,Origin:'https://untrusted.example'})).status,403);
assert.equal((await api('/api/world/relay',{token,command:{op:'move',destination:'beida'}},human)).status,400);
result=await api('/api/world/relay',{token,command:{op:'pair'}},human);assert.equal(result.status,200,JSON.stringify(result.data));assert(result.data.paired);
result=await api('/api/world/relay',{token,command:{op:'observe',driverId:randomUUID(),endsAt:Date.now()+3600000}},human);assert.equal(result.status,200);assert(result.data.ready);assert(Array.isArray(result.data.nearby));
assert.equal((await api('/api/world',{op:'disconnect'},human)).status,200);
assert.equal((await api('/api/world/relay',{token,command:{op:'status'}},human)).status,401,'A browser cannot silently revive a revoked driver');
console.log('PASS: real local Worker/D1 routes, auth headers, CSRF, account creation, pairing, private message, decision persistence, human-action rejection and token revocation.');
