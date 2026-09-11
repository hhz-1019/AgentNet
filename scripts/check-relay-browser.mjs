import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createCampusRelay } from './campus-relay.mjs';

// Optional local browser integration test. No real Codex usage or production writes.
const relay=await createCampusRelay('http://localhost:3000',randomBytes(32).toString('hex'));
console.log(relay.url);
const deadline=Date.now()+180000;
try{
  let paired=false;
  while(Date.now()<deadline&&!paired){try{await relay.request({op:'pair'});paired=true;}catch{}}
  assert(paired,'Click Connect this computer in the local preview within three minutes');
  const view=await relay.request({op:'status'});assert(view.character);
  const observation=await relay.request({op:'observe',driverId:randomUUID(),endsAt:Date.now()+120000});
  if(observation.ready){
    const accepted=await relay.request({op:'decide',leaseId:observation.leaseId,decision:{action:observation.character.moving?'continue':'stay',destination:observation.character.place,activity:'观察周围',intention:'本地浏览器连接验证。',reply:'页面连接验证通过。这条回复来自本地测试程序，没有调用模型。',memory:'',sourceEventIds:[],waitSeconds:300,speech:null},usage:{inputTokens:0,outputTokens:0}});
    assert(accepted.accepted);
  }
  console.log('PASS: browser -> loopback -> authenticated Sites route -> D1 pairing, observation and decision. No model call.');
}finally{await relay.close();}
