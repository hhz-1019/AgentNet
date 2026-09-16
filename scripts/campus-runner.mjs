import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RunnerLedger } from './runner-ledger.mjs';

function number(env,name,fallback,max=Number.MAX_SAFE_INTEGER){const n=Number(env[name]??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`${name} 必须是 1–${max} 的整数。`);return n;}
function endpoint(value){const url=new URL(value);if(url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('地址需为 HTTPS（本机测试可用 HTTP），不能包含密钥或查询参数。');return url;}
export function configuration(env=process.env){
  const url=endpoint(env.CAMPUS_URL??'');if(url.pathname!=='/')throw new Error('CAMPUS_URL 只填写校园网站根地址。');
  if(!/^[a-f0-9]{64}$/.test(env.CAMPUS_TOKEN??''))throw new Error('CAMPUS_TOKEN 需填写角色连接密钥。');
  const brain=env.AGENT_BRAIN??'codex';if(!['codex','api'].includes(brain))throw new Error('AGENT_BRAIN 选择 codex 或 api。');
  if(brain==='api'&&(!env.MODEL_API_KEY||!env.MODEL_NAME))throw new Error('API 模式需要 MODEL_API_KEY 和 MODEL_NAME。');
  const mode=env.RUN_MODE??'once';if(!['once','continuous'].includes(mode))throw new Error('RUN_MODE 选择 once 或 continuous。');
  return {site:url.origin,token:env.CAMPUS_TOKEN,brain,continuous:mode==='continuous',minutes:number(env,'RUN_MINUTES',10,240),
    clientName:(env.CLIENT_NAME??(brain==='codex'?'个人 Codex 常驻连接':'个人模型常驻连接')).slice(0,60),
    dataDir:path.resolve(env.RUNNER_DATA_DIR??'.campus-local/runner'),limits:{calls:number(env,'MAX_CALLS_PER_DAY',24,144),tokens:number(env,'MAX_TOKENS_PER_DAY',100000),totalTokens:number(env,'MAX_TOTAL_TOKENS',1000000)},
    outputTokens:number(env,'MAX_OUTPUT_TOKENS',1500,16000),codexReserve:number(env,'CODEX_TOKEN_RESERVATION',32768),codexPath:env.CODEX_BIN,model:env.MODEL_NAME,
    modelURL:brain==='api'?endpoint(env.MODEL_API_URL??'').toString():null,modelKey:env.MODEL_API_KEY};
}
async function json(url,options={}){
  const r=await fetch(url,{...options,redirect:'error',signal:options.signal??AbortSignal.timeout(20000)});
  if(!r.ok)throw Object.assign(new Error(`连接失败（HTTP ${r.status}）。`),{status:r.status});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('接口未返回 JSON，请检查域名访问限制。');return r.json();
}
export async function run(config,{check=false,resume=false,signal=new AbortController().signal,log=console.log}={}){
  const call=(name,args={})=>json(config.site+'/api/campus/tools/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify(args),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const catalog=await json(config.site+'/api/campus/tools'),status=await call('campus_status');
  for(const name of ['campus_observe','campus_act','campus_recall','campus_heartbeat'])if(!catalog.tools?.some(t=>t.name===name))throw new Error('校园版本缺少 '+name+'，请先更新校园。');
  if(!status.character?.id)throw new Error('没有找到已授权角色。');
  if(check){log('接入自检通过：校园可达、角色授权有效、所需接口齐全。没有调用模型或执行行动。');return;}
  const ledger=new RunnerLedger(path.join(config.dataDir,'ledger.sqlite'),config.site+'#'+status.character.id);
  if(resume)ledger.resume();
  const parameters=structuredClone(catalog.tools.find(t=>t.name==='campus_act').inputSchema);delete parameters.$schema;delete parameters.properties.usage;
  const deadline=config.continuous?Infinity:Date.now()+config.minutes*60000;
  const wait=async seconds=>{await sleep(Math.min(60,Math.max(1,seconds))*1000,undefined,{signal}).catch(e=>{if(!signal.aborted)throw e;});};
  const keepLock=setInterval(()=>{try{ledger.save();}catch{log('运行锁失效，请停止并检查是否有另一个实例。');}},25000);
  let activeLease=null;
  try{
    log(config.continuous?'持续连接已启动；达到预算后等待，不再调用模型。':'开始一次有时限的校园体验。');
    while(!signal.aborted&&Date.now()<deadline){
      ledger.rotate();ledger.save();
      if(ledger.state.halt){log(ledger.state.halt);break;}
      if(ledger.state.pending?.phase==='decided'){
        try{await call('campus_act',ledger.state.pending.action);ledger.complete();log('已提交保存的决定。');}
        catch(e){if([400,409,422].includes(e.status)){await call('campus_report_failure',{leaseId:ledger.state.pending.leaseId,message:'保存的决定已失效，等待下一次观察。'}).catch(()=>{});ledger.complete();}else throw e;}
        continue;
      }
      if(ledger.state.calls>=config.limits.calls||ledger.state.tokens>=config.limits.tokens||ledger.state.totalTokens>=config.limits.totalTokens){
        if(!config.continuous||ledger.state.totalTokens>=config.limits.totalTokens){log('已达运行预算，停止模型调用。');break;}await wait(60);continue;
      }
      let observation;
      try{observation=await call('campus_observe',{clientName:config.clientName,runForSeconds:config.continuous?300:Math.max(60,Math.ceil((deadline-Date.now())/1000))});}
      catch(e){if(e.status&&e.status<500&&e.status!==429)throw e;await wait(30);continue;}
      if(!observation.ready){if(observation.paused&&!config.continuous)break;await wait(observation.retryAfter??30);continue;}
      activeLease=observation.leaseId;
      const latest=observation.newMessages?.at(-1)?.text;
      try{observation.recalled=await call('campus_recall',{query:(latest??observation.character.intention).slice(0,120),limit:8,leaseId:activeLease});}
      catch(e){await call('campus_report_failure',{leaseId:activeLease,message:'暂时无法读取历史，未调用模型。'}).catch(()=>{});activeLease=null;if(e.status===401||e.status===403)throw e;await wait(30);continue;}
      const request={model:config.model,messages:[{role:'system',content:catalog.instructions+'\n请调用 campus_act 提交一次自主决定，使用观察的 leaseId。'}, {role:'user',content:JSON.stringify(observation)}],tools:[{type:'function',function:{name:'campus_act',description:'提交自己的校园行动',parameters}}],tool_choice:'auto',max_tokens:config.outputTokens};
      // A conservative admission estimate; provider tokenizers/hidden overhead can differ.
      const reservation=config.brain==='api'?Buffer.byteLength(JSON.stringify(request),'utf8')+config.outputTokens+2048:config.codexReserve;
      if(!ledger.reserve(activeLease,reservation,config.limits)){
        await call('campus_report_failure',{leaseId:activeLease,message:'剩余预算不足以预留一次完整决策，本轮未调用模型。'});activeLease=null;
        log('剩余预算不足以预留下一次调用，已停止。');break;
      }
      const abort=new AbortController(),modelSignal=AbortSignal.any([signal,abort.signal,AbortSignal.timeout(150000)]);
      const heartbeat=setInterval(()=>{void call('campus_heartbeat',{clientName:config.clientName,leaseId:activeLease}).then(v=>{if(v.paused||!v.leaseActive)abort.abort();}).catch(()=>abort.abort());},25000);
      let result;
      try{
        // Recheck pause/revocation after recall and before spending.
        const alive=await call('campus_heartbeat',{clientName:config.clientName,leaseId:activeLease});
        if(alive.paused||!alive.leaseActive){ledger.settle({inputTokens:0,outputTokens:0},null);ledger.complete();continue;}
        if(config.brain==='codex'){
          const {runCodex}=await import('./campus-driver.mjs');
          result=await runCodex(observation,{codexPath:config.codexPath,model:config.model,room:path.join(config.dataDir,'room'),signal:modelSignal});
        }else{
          const completion=await json(config.modelURL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.modelKey},body:JSON.stringify(request),signal:modelSignal});
          const calls=completion.choices?.[0]?.message?.tool_calls;
          const usage=completion.usage?{inputTokens:completion.usage.prompt_tokens,outputTokens:completion.usage.completion_tokens}:null;
          let action;try{if(calls?.length===1&&calls[0].function?.name==='campus_act')action=JSON.parse(calls[0].function.arguments);}catch{}
          result={decision:action?.leaseId===activeLease?action.decision:null,usage};
        }
        const action={leaseId:activeLease,decision:result.decision,usage:result.usage};
        ledger.settle(result.usage,action);
        if(!result.decision||modelSignal.aborted||ledger.state.halt){ledger.complete();await call('campus_report_failure',{leaseId:activeLease,message:'本轮未返回有效决定或已停止，角色不执行新行动。'}).catch(()=>{});}
      }catch(e){
        // A timeout, process crash or lost provider response cannot prove zero spend.
        ledger.halt('本轮模型调用未能确认完成，保留预留用量并停止。核对后用 --resume 继续。');
        await call('campus_report_failure',{leaseId:activeLease,message:'模型调用中断，连接程序等待本人核查。'}).catch(()=>{});
      }finally{clearInterval(heartbeat);activeLease=null;}
    }
  }finally{clearInterval(keepLock);ledger.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  try{await run(configuration(),{check:process.argv.includes('--check'),resume:process.argv.includes('--resume'),signal:abort.signal});}
  catch(e){if(!abort.signal.aborted){console.error(e.message);process.exitCode=1;}}
}
