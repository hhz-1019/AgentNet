import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCompose, readEnv } from './aliyun-hk-code-compose.mjs';
const previous = '/srv/elsewhere/releases/hk-cutover-20261018090000';
const root = '/srv/elsewhere/releases/hk-code-' + 'a'.repeat(40);
const images = Object.fromEntries(['core', 'web', 'gorse', 'sync'].map((s,i)=>[s,'sha256:'+String(i).repeat(64)]));
const fixture = () => ({name:'elsewhere', networks:{backend:{internal:true},outbound:{},edge:{internal:true}},services:{
  core:{image:'old-core',env_file:[{path:previous+'/env/core.env',format:'raw'}],networks:['backend','outbound','edge'],volumes:[]},
  web:{image:'old-web',env_file:[{path:previous+'/env/web.env',format:'raw'}],volumes:[{type:'bind',source:previous+'/web',target:'/srv'}]},
  gorse:{image:'old-gorse',env_file:[{path:previous+'/env/gorse.env',format:'raw'}],networks:['backend'],volumes:[{type:'bind',source:previous+'/gorse',target:'/var/lib/gorse'},{type:'bind',source:previous+'/configs/gorse-config.toml',target:'/etc/gorse/config.toml'}]},
  sync:{image:'old-sync',env_file:[previous+'/env/sync.env'],volumes:[{type:'bind',source:previous+'/configs/sync-sync.mjs',target:'/app/sync.mjs'}]},
  postgres:{image:'postgres',env_file:[previous+'/env/postgres.env'],volumes:[{source:previous+'/postgres',target:'/var/lib/postgresql/data'}]},
  redis:{image:'redis',volumes:[{source:previous+'/redis',target:'/data'}]},
}});
await test('updates all four applications while retaining data and infrastructure',()=>{
  const old=fixture(), backup=structuredClone(old),next=releaseCompose(old,{previous,root,images});
  assert.deepEqual(old,backup);
  for(const s of ['core','web','gorse','sync'])assert.equal(next.services[s].image,images[s]);
  for(const s of ['postgres','redis'])assert.deepEqual(next.services[s],old.services[s]);
  assert.deepEqual(next.services.gorse.volumes,[old.services.gorse.volumes[0]]);
  assert.deepEqual(next.services.web.volumes,[]);
  assert.deepEqual(next.services.sync.volumes,[]);
  assert(next.services.gorse.networks.includes('outbound'));
  assert.equal(next.services.gorse.env_file[0].path,root+'/env/gorse.env');
  assert.equal(next.services.sync.env_file[0],root+'/env/sync.env');
  assert.equal(next.services.core.env_file[0].format,'raw');
  assert.equal(next.services.gorse.ports,undefined);
});
await test('old Compose model overrides cannot revive separate providers',()=>{
  const old=fixture();
  old.services.core.environment={EMBEDDING_DISABLED:'false',SAFETY_LLM_API_KEY:'old',OTHER:'keep'};
  old.services.gorse.environment={RERANKER_AUTH_TOKEN:'old',OTHER:'keep'};
  const next=releaseCompose(old,{previous,root,images});
  assert.deepEqual(next.services.core.environment,{OTHER:'keep'});
  assert.deepEqual(next.services.gorse.environment,{OTHER:'keep'});
});
await test('rejects unexpected mounts, missing services, or missing egress before activation',()=>{
  let old=fixture();old.services.web.volumes[0].source='/unrelated';
  assert.throws(()=>releaseCompose(old,{previous,root,images}));
  old=fixture();delete old.services.sync;
  assert.throws(()=>releaseCompose(old,{previous,root,images}));
  old=fixture();old.networks.outbound.internal=true;
  assert.throws(()=>releaseCompose(old,{previous,root,images}));
});

await test('handles a core/web-only release with recommendation services still on the cutover paths',()=>{
  const old=fixture(), current='/srv/elsewhere/releases/hk-code-'+'b'.repeat(40);
  for(const name of ['core','web']) old.services[name].env_file=[{path:current+`/env/${name}.env`,format:'raw'}];
  old.services.web.volumes=[];
  old.services.sync.volumes[0].source=previous+'/configs/sync.mjs';
  const next=releaseCompose(old,{previous:current,root,images});
  assert.equal(next.services.gorse.env_file[0].path,root+'/env/gorse.env');
  assert.equal(next.services.sync.env_file[0],root+'/env/sync.env');
  assert.deepEqual(next.services.gorse.volumes,[old.services.gorse.volumes[0]]);
  assert.deepEqual(next.services.sync.volumes,[]);
  assert.deepEqual(next.services.postgres,old.services.postgres);
});
await test('private environment parsing preserves equals signs and empty values',()=>{
  assert.deepEqual(readEnv('#comment\nKEY=has=equals\nEMPTY=\n'),{KEY:'has=equals',EMPTY:''});
  assert.throws(()=>readEnv('malformed'));
});

await test('provider preflight accepts complete results and rejects outages or incomplete results without exposing response bodies',async()=>{
  const {createServer}=await import('node:http');
  const {spawn}=await import('node:child_process');
  let status=200,body={results:[{index:0,relevance_score:0.9},{index:1,relevance_score:0.1}]};
  const server=createServer((req,res)=>{req.resume();res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const run=()=>new Promise(resolve=>{
    const child=spawn(process.execPath,['eigenflux/scripts/recommender-provider-preflight.mjs'],{env:{...process.env,RERANKER_URL:'http://127.0.0.1:'+server.address().port,RERANKER_MODEL:'fixture',RERANKER_AUTH_TOKEN:'private-test-key'}});
    let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('close',code=>resolve({code,output}));
  });
  try{
    assert.equal((await run()).code,0);
    body={results:[{index:0,relevance_score:1}]};assert.equal((await run()).code,1);
    status=400;body={error:'PRIVATE_PROVIDER_RESPONSE'};
    const result=await run();assert.equal(result.code,1);assert.match(result.output,/Provider HTTP 400/);assert(!result.output.includes('PRIVATE_'));assert(!result.output.includes('private-test-key'));
  }finally{server.close();}
});

await test('DeepSeek chat preflight accepts JSON scores and rejects truncated output',async()=>{
 const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');
 let finish='stop';
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);assert.equal(body.thinking.type,'disabled');assert.equal(body.response_format.type,'json_object');
  res.end(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify({results:[{index:0,relevance_score:0.9},{index:1,relevance_score:0.1}]})}}]}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const run=()=>new Promise(resolve=>{const child=spawn(process.execPath,['eigenflux/scripts/recommender-provider-preflight.mjs'],{env:{...process.env,RERANKER_URL:`http://127.0.0.1:${server.address().port}/chat/completions`,RERANKER_MODEL:'test'},stdio:'ignore'});child.on('close',resolve)});
 try{assert.equal(await run(),0);finish='length';assert.equal(await run(),1)}finally{server.close()}
});
