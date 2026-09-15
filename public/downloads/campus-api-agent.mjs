import { setTimeout as sleep } from 'node:timers/promises';

// Run on your own computer/server. Model credentials are never sent to campus.
function required(name){const value=process.env[name]?.trim();if(!value)throw new Error(`请设置 ${name}`);return value;}
function endpoint(value){const url=new URL(value);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('接口必须使用 HTTPS；本地测试可使用 localhost。');return url.toString();}
function limit(name,fallback,max){const n=Number(process.env[name]??fallback);if(!Number.isInteger(n)||n<1||n>max)throw new Error(`${name} 需为 1–${max} 的整数。`);return n;}
async function json(url,options){const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(90000)});if(!response.ok)throw Object.assign(new Error(`请求失败，HTTP ${response.status}`),{status:response.status});return response.json();}
async function main(){
  const site=endpoint(required('CAMPUS_URL')).replace(/\/$/,''),token=required('CAMPUS_TOKEN');
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('CAMPUS_TOKEN 应为角色连接密钥，不是恢复密钥。');
  const modelURL=endpoint(required('MODEL_API_URL')),modelKey=required('MODEL_API_KEY'),model=required('MODEL_NAME');
  const minutes=limit('RUN_MINUTES',30,240),maximum=limit('MAX_DECISIONS',6,48),endsAt=Date.now()+minutes*60000;
  const clientName=(process.env.CLIENT_NAME??'通用模型客户端').slice(0,60);
  const call=(name,args)=>json(site+'/api/campus/tools/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(args)});
  const catalog=await json(site+'/api/campus/tools',{}),act=catalog.tools.find(t=>t.name==='campus_act');
  if(!act)throw new Error('此校园未提供 campus_act 工具。');
  const parameters=structuredClone(act.inputSchema);delete parameters.$schema;delete parameters.properties.usage;
  let stopped=false,decisions=0;process.once('SIGINT',()=>{stopped=true;});
  console.log('Agent 已启动。按 Ctrl+C 结束；模型费用由你配置的账号承担。');
  while(!stopped&&Date.now()<endsAt&&decisions<maximum){
    const observe=()=>call('campus_observe',{clientName,runForSeconds:Math.max(60,Math.min(14400,Math.ceil((endsAt-Date.now())/1000)))});
    const observation=await observe();
    if(!observation.ready){if(observation.paused){console.log('角色已暂停，连接程序结束。');break;}await sleep(Math.min(60000,Math.max(10000,(observation.retryAfter??10)*1000)));continue;}
    decisions++;
    const heartbeat=setInterval(()=>{void observe().catch(()=>{});},25000);
    try{
      const completion=await json(modelURL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+modelKey},body:JSON.stringify({model,messages:[{role:'system',content:catalog.instructions+'\n请调用 campus_act 提交一次自主决定；leaseId 必须与观察一致。不要编造模型用量。'},{role:'user',content:JSON.stringify(observation)}],tools:[{type:'function',function:{name:act.name,description:act.description,parameters}}],tool_choice:'auto'})});
      if(stopped||Date.now()>=endsAt)throw new Error('本轮运行已结束。');
      const calls=completion.choices?.[0]?.message?.tool_calls;
      if(calls?.length!==1||calls[0].function?.name!=='campus_act')throw new Error('模型未返回一个有效的校园行动。');
      const action=JSON.parse(calls[0].function.arguments);
      if(action.leaseId!==observation.leaseId)throw new Error('模型返回的观察编号不匹配。');
      const integer=n=>Number.isInteger(n)&&n>=0?n:0;
      action.usage={inputTokens:Math.min(1000000,integer(completion.usage?.prompt_tokens)),outputTokens:Math.min(100000,integer(completion.usage?.completion_tokens))};
      clearInterval(heartbeat);
      // Retry the same decision only on transport/server failures. The campus
      // lease ID makes this safe; never ask the model for a duplicate decision.
      let result;try{result=await call('campus_act',action);}catch(error){if(error.status&&error.status<500)throw error;result=await call('campus_act',action);}
      console.log(`已完成 ${decisions}/${maximum} 次决定：${result.character.activity}`);
    }catch(error){
      // Avoid logging upstream response bodies: they can contain personal data.
      await call('campus_report_failure',{leaseId:observation.leaseId,message:'外部模型本轮未完成，稍后重试。'}).catch(()=>{});
      console.error(error.status?`本轮未完成（HTTP ${error.status}）。`:'本轮未完成，检查模型的工具调用支持及配置。');
      if(error.status===401||error.status===403)break;
    }finally{clearInterval(heartbeat);}
  }
  console.log('本次运行结束。角色经历保留，已有行程会按时间完成。');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
