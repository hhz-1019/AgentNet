import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sqliteStore,migrate } from './sqlite-store.mjs';
import { run,configuration } from './campus-runner.mjs';
import { WorldService } from '../lib/world-service.ts';
import { runCampusTool,toolCatalog } from '../lib/campus-tools.ts';

const directory=await mkdtemp(path.join(tmpdir(),'campus-runner-')),db=sqliteStore(path.join(directory,'world.sqlite'));migrate(db,path.resolve('drizzle'));
const token='c'.repeat(64),modelKey='LOCAL-PROVIDER-ONLY';
const world=()=>new WorldService(db);await world().create('runner','本地运行验证');await world().issueAgentToken('runner',token);
await world().message('runner','请回想之前的校园生活。',crypto.randomUUID());
let modelCalls=0,dropResponse=true,missingUsage=false;
const serve=async handler=>{const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;};
const campus=await serve(async(req,res)=>{
  try{
    const name=req.url.split('/').at(-1);
    if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(toolCatalog()));return;}
    assert.equal(req.headers.authorization,'Bearer '+token);let raw='';for await(const chunk of req)raw+=chunk;
    assert(!raw.includes(modelKey));const w=world(),owner=await w.driverOwner(token),value=await runCampusTool(w,owner,name,JSON.parse(raw));
    if(name==='campus_act'&&dropResponse){dropResponse=false;res.writeHead(503);res.end('simulated lost response after commit');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
  }catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'test request failed'}));}
});
const provider=await serve(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer '+modelKey);let raw='';for await(const chunk of req)raw+=chunk;assert(!raw.includes(token));
  const request=JSON.parse(raw),observation=JSON.parse(request.messages[1].content);assert(observation.recalled);assert.equal(request.max_tokens,500);modelCalls++;
  const decision={action:'stay',destination:'beida',activity:'观察周围',intention:'安静观察。',reply:'实际执行了一次决定。',memory:'',sourceEventIds:[],waitSeconds:90,speech:null};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{type:'function',function:{name:'campus_act',arguments:JSON.stringify({leaseId:observation.leaseId,decision})}}]}}],...missingUsage?{}:{usage:{prompt_tokens:100,completion_tokens:50}}}));
});
const site=`http://127.0.0.1:${campus.address().port}`;
const env={CAMPUS_URL:site,CAMPUS_TOKEN:token,AGENT_BRAIN:'api',MODEL_API_URL:`http://127.0.0.1:${provider.address().port}/chat/completions`,MODEL_API_KEY:modelKey,MODEL_NAME:'fixture',MAX_OUTPUT_TOKENS:'500',MAX_CALLS_PER_DAY:'1',RUNNER_DATA_DIR:path.join(directory,'runner')};
const config=configuration(env),logs=[],log=m=>logs.push(m);
try{
  await run(config,{check:true,log});assert.equal(modelCalls,0,'Connectivity checks cannot spend tokens');
  await assert.rejects(()=>run(config,{log}),e=>e.status===503);assert.equal(modelCalls,1);
  assert.equal((await world().view('runner')).events.filter(e=>e.kind==='reply').length,1);
  await run(config,{log});assert.equal(modelCalls,1,'Recovery resubmits the saved decision without calling a model');
  assert.equal((await world().view('runner')).events.filter(e=>e.kind==='reply').length,1,'Committed speech is not replayed');
  await run(config,{log});assert.equal(modelCalls,1,'Restart does not clear the call budget');
  await world().message('runner','第二次真实输入',crypto.randomUUID());missingUsage=true;
  const unknown=configuration({...env,RUNNER_DATA_DIR:path.join(directory,'unknown')});await run(unknown,{log});assert.equal(modelCalls,2);await run(unknown,{log});assert.equal(modelCalls,2,'Missing provider usage leaves a persistent stop');
  await world().disconnect('runner');await assert.rejects(()=>run(config,{check:true,log}),e=>e.status===401);
  assert(!logs.join('').includes(modelKey));assert(!logs.join('').includes(token));
  console.log('PASS: real HTTP runner with a local provider, read-only preflight, history context, isolated credentials, model-response accounting, committed action recovery, no double model call/action, restart budget, missing usage stop and revocation. No paid models used.');
}finally{campus.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(r=>campus.close(r)),new Promise(r=>provider.close(r))]);db.close();}
