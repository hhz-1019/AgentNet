// Offline acceptance: original Gorse service + a real configured reranker.
// Inputs are existing public posts and an explicitly selected network card.
// No live-platform writes; secrets stay in a private caller-supplied file.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {gorseItem} from './sync.mjs';
const base=resolve(process.env.REPLAY_DIR||'.agentnet-audit/recommendation-unified');
const provider=JSON.parse(await readFile(base+'/provider.json','utf8'));
const profile=JSON.parse(await readFile(process.env.REPLAY_PROFILE,'utf8'));
const posts=JSON.parse(await readFile(base+'/corpus.json','utf8'));
const dir=await mkdtemp(base+'/run-');
const calls=[];
let providerFailure;
const proxy=createServer(async(req,res)=>{
 try {
  let raw='';for await(const c of req)raw+=c;
  const request=JSON.parse(raw);
  const upstream=await fetch(provider.url,{method:'POST',headers:{Authorization:'Bearer '+provider.key,'Content-Type':'application/json'},body:raw,signal:AbortSignal.timeout(60000)});
  const data=await upstream.json();
  if(!upstream.ok){await writeFile(dir+'/provider-failure.json',JSON.stringify({status:upstream.status,response:data,queryChars:request.query?.length,documentCount:request.documents?.length}),{mode:0o600});providerFailure=new Error('reranker HTTP '+upstream.status+' ('+(data.code||'unknown')+')');throw providerFailure;}
  assert.equal(data.results.length,request.documents.length);
  const indices=new Set();for(const r of data.results){assert(Number.isInteger(r.index)&&r.index>=0&&r.index<request.documents.length&&!indices.has(r.index));assert(Number.isFinite(r.relevance_score));indices.add(r.index)}
  calls.push({query:request.query,documents:request.documents,results:data.results});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
 }catch(e){console.error(e.message);res.writeHead(502).end('{"error":"reranker failed"}')}
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
const key=randomBytes(24).toString('hex');
let config=(await readFile('elsewhere/recommender/gorse.toml','utf8')).replaceAll('/var/lib/gorse',dir).replaceAll('"0.0.0.0"','"127.0.0.1"').replace('fit_period = "1m"','fit_period = "5s"').replace('[recommend.collaborative]','[recommend.collaborative]\nfit_period = "5s"');
await writeFile(dir+'/config.toml',config);await mkdir(dir+'/cache');
const log=await open(dir+'/gorse.log','w');
const child=spawn(base+'/gorse',['--config',dir+'/config.toml','--cache-path',dir+'/cache'],{env:{...process.env,GORSE_SERVER_API_KEY:key,GORSE_MASTER_HTTP_PORT:'14391',GORSE_MASTER_PORT:'14392',GORSE_DASHBOARD_USER_NAME:'audit',GORSE_DASHBOARD_PASSWORD:key,RERANKER_URL:'http://127.0.0.1:'+proxy.address().port,RERANKER_MODEL:provider.model,RERANKER_AUTH_TOKEN:'local-acceptance'},stdio:['ignore',log.fd,log.fd]});
const api=async(path,method='GET',body)=>{const r=await fetch('http://127.0.0.1:14391'+path,{method,headers:{'X-API-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Gorse HTTP '+r.status);return r.json()};
try{
 let ready=false;for(let i=0;i<60;i++){try{await api('/api/items?n=1');ready=true;break}catch{}if(child.exitCode!==null)throw new Error('Gorse exited: '+dir);await new Promise(r=>setTimeout(r,500))}assert(ready,'startup timeout');
 const items=posts.map(gorseItem).filter(Boolean);
 await api('/api/items','POST',items);
 const user='agent:368750834374152192';
 await api('/api/user','POST',{UserId:user,Labels:[],Comment:JSON.stringify(profile)});
 console.log('Real Gorse running; posts:',items.length,'profile fields:',Object.keys(profile).join(','));
 let ranked=[];
 for(let i=0;i<180;i++){
  if(providerFailure)throw providerFailure;
  if(calls.length){const lines=await readFile(dir+'/gorse.log','utf8');if(lines.split('complete ranking recommendation').length>2){ranked=await api('/api/recommend/'+encodeURIComponent(user)+'?n=500');if(ranked.length)break}}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert(calls.length,'upstream semantic model was never invoked');assert(ranked.length,'ranking cache not ready');
 await writeFile(dir+'/model-call.json',JSON.stringify(calls[0]),{mode:0o600});
 const embedded = calls[0].query.split('用户网络资料：')[1]?.split('\n关注标签：')[0];
 assert.deepEqual(JSON.parse(embedded),profile,'network card changed in upstream template');
 const byId=new Map(items.map((item,i)=>[item.ItemId,posts[i]]));
 const result={engine:'gorse v0.5.11 + documented entry/transport patches',model:provider.model,sourceCount:posts.length,feedbackCount:0,run:dir,ranked:ranked.map(id=>({id,title:byId.get(id)?.document.title,tags:byId.get(id)?.document.tags})),calls:calls.map(c=>({documents:c.documents.length,query:c.query}))};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2),{mode:0o600});
 await writeFile(base+'/latest-result.json',JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify({result:dir+'/result.json',calls:calls.length,top20:result.ranked.slice(0,20)},null,2));
 if(process.env.REPLAY_ADAPTER==='1'){
  const testLog=await open(dir+'/adapter.log','w');
  const test=spawn(process.execPath,['elsewhere/scripts/social-core-test.mjs'],{env:{...process.env,AGENTNET_SOCIAL_TEST_PORT:'15487',AGENTNET_TEST_GORSE_URL:'http://127.0.0.1:14391',AGENTNET_TEST_GORSE_KEY:key,AGENTNET_RECOMMENDATION_CORPUS:base+'/corpus.json'},stdio:['ignore',testLog.fd,testLog.fd]});
  const code=await new Promise((resolve,reject)=>{test.on('exit',resolve);test.on('error',reject)});
  await testLog.close();assert.equal(code,0,'real adapter integration failed: '+dir+'/adapter.log');console.log('Real Go adapter integration passed');
 }

}finally{child.kill('SIGTERM');await new Promise(r=>proxy.close(r));await log.close()}
