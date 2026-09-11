import assert from 'node:assert/strict';
import { createCampusRelay } from './campus-relay.mjs';

const relay=await createCampusRelay('https://campus.example','a'.repeat(64),{requestTimeout:500,pollTimeout:100});
const base=`http://127.0.0.1:${relay.port}`,headers={Origin:'https://campus.example',Authorization:`Bearer ${relay.secret}`,'Content-Type':'application/json'};
const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});
try{
  assert.equal((await post('/poll',undefined,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await post('/poll',undefined,{Authorization:'Bearer invalid'})).status,401);
  const preflight=await fetch(base+'/poll',{method:'OPTIONS',headers:{Origin:'https://campus.example','Access-Control-Request-Method':'POST'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://campus.example');assert.equal(preflight.headers.get('Access-Control-Allow-Private-Network'),'true');
  assert.equal((await post('/execute',{command:'shell'})).status,404,'Relay is not a shell service');
  const pending=relay.request({op:'observe',driverId:'fixture'});
  const job=await (await post('/poll')).json();assert.equal(job.command.op,'observe');assert.equal(job.token,'a'.repeat(64));
  assert.equal((await post('/result',{id:job.id,status:200,body:{ready:false}})).status,200);
  assert.deepEqual(await pending,{ready:false});
  assert.equal((await (await post('/result',{id:job.id,status:200,body:{ready:true}})).json()).accepted,false,'Duplicate or late browser responses cannot resolve a second job');
  const denied=relay.request({op:'status'}),rejection=assert.rejects(denied,e=>e.status===401);
  const deniedJob=await (await post('/poll')).json();await post('/result',{id:deniedJob.id,status:401,body:{error:'连接已撤销。'}});await rejection;
  await assert.rejects(relay.request({op:'status'}),/校园页面未接通/);
  assert.equal(await (await post('/poll')).json(),null,'Expired jobs do not linger after a page closes');
  const closePending=relay.request({op:'status'}),closed=assert.rejects(closePending,/本机连接已停止/);await relay.close();await closed;
  console.log('PASS: loopback origin/token isolation, CORS preflight, command-only surface, delivery, duplicate responses, revocation, timeout cleanup and shutdown.');
}catch(error){await relay.close();throw error;}
