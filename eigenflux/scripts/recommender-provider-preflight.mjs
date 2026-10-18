// A small synthetic request validates configuration before touching live services.
// Never print model credentials, request headers, or the provider response body.
import assert from 'node:assert/strict';
try {
  const {RERANKER_URL:url,RERANKER_MODEL:model,RERANKER_AUTH_TOKEN:token=''}=process.env;
  assert(url && model, 'Missing reranker configuration');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({model,query:'寻找摄影交流伙伴',documents:['分享摄影作品和拍摄经验','交流家庭烹饪食谱']}),signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error('Provider HTTP '+response.status);
  const data=await response.json();
  assert(Array.isArray(data.results) && data.results.length===2, 'Incomplete reranker results');
  const seen=new Set();
  for(const item of data.results){
    assert([0,1].includes(item.index) && !seen.has(item.index) && Number.isFinite(item.relevance_score), 'Invalid reranker results');
    seen.add(item.index);
  }
  console.log('RERANKER_PROVIDER_READY');
} catch(error) {
  // Only these locally-defined diagnostics are permitted in deployment logs.
  console.error(/^Provider HTTP \d+$/.test(error.message)?error.message:'Reranker preflight failed; check private configuration and provider availability.');
  process.exitCode=1;
}
