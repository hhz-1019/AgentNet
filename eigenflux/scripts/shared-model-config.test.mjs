import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedModelConfig} from './shared-model-config.mjs';
test('replaces stale model credentials and preserves unrelated configuration',()=>{
 const core={LLM_BASE_URL:'https://api.deepseek.com/v1',LLM_MODEL:'deepseek-flash',LLM_API_KEY:'shared-test',EMBEDDING_API_KEY:'old',SAFETY_LLM_API_KEY:'old',PG_DSN:'unchanged'};
 const next=sharedModelConfig(core,{RERANKER_AUTH_TOKEN:'old',GORSE_SERVER_API_KEY:'internal'});
 assert.equal(next.core.EMBEDDING_DISABLED,'true');assert.equal(next.core.EMBEDDING_API_KEY,'');assert.equal(next.core.SAFETY_LLM_API_KEY,'shared-test');assert.equal(next.core.PG_DSN,'unchanged');
 assert.equal(next.gorse.RERANKER_URL,'https://api.deepseek.com/v1/chat/completions');assert.equal(next.gorse.RERANKER_AUTH_TOKEN,'shared-test');assert.equal(next.gorse.GORSE_SERVER_API_KEY,'internal');assert.equal(core.EMBEDDING_API_KEY,'old');
});
test('rejects another provider instead of silently keeping a paid fallback',()=>{
 assert.throws(()=>sharedModelConfig({LLM_BASE_URL:'https://example.com',LLM_MODEL:'test',LLM_API_KEY:'test'}));
});
