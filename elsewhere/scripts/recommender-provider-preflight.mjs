// A small synthetic request validates configuration before touching live services.
// Never print model credentials, request headers, or the provider response body.
import assert from 'node:assert/strict';
try {
  const {RERANKER_URL:url,RERANKER_MODEL:model,RERANKER_AUTH_TOKEN:token=''}=process.env;
  assert(url && model, 'Missing reranker configuration');
  if(process.env.RERANKER_MODE==='local') assert.equal(url,'http://local-ranker:8090/v1/rerank');
  const chat=new URL(url).pathname.replace(/\/$/, '').endsWith('/chat/completions');
  const input={query:'寻找摄影交流伙伴',documents:['分享摄影作品和拍摄经验','交流家庭烹饪食谱']};
  const body=chat ? {model,thinking:{type:'disabled'},max_tokens:512,response_format:{type:'json_object'},messages:[{role:'system',content:'Return JSON results containing each document index exactly once and relevance_score from 0 to 1.'},{role:'user',content:JSON.stringify(input)}]} : {model,...input};
  const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(process.env.RERANKER_MODE==='local'?'':token)},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error('Provider HTTP '+response.status);
  let data=await response.json();
  if(chat){assert.equal(data.choices?.[0]?.finish_reason,'stop');data=JSON.parse(data.choices[0].message.content);}
  assert(Array.isArray(data.results) && data.results.length===2, 'Incomplete reranker results');
  const seen=new Set();
  for(const item of data.results){
    assert([0,1].includes(item.index) && !seen.has(item.index) && Number.isFinite(item.relevance_score), 'Invalid reranker results');
    if(chat) assert(item.relevance_score >= 0 && item.relevance_score <= 1, 'Invalid ranking score range');
    seen.add(item.index);
  }
  console.log('RERANKER_PROVIDER_READY');
} catch(error) {
  // Only these locally-defined diagnostics are permitted in deployment logs.
  console.error(/^Provider HTTP \d+$/.test(error.message)?error.message:'Reranker preflight failed; check private configuration and provider availability.');
  process.exitCode=1;
}
