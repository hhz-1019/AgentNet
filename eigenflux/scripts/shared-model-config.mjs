import assert from 'node:assert/strict';

// Reuse the application's existing credential. Never read the obsolete separate
// recommender secret file, and never fall back to a different paid provider.
export function sharedModelConfig(core, gorse = {}) {
  const base = new URL(core.LLM_BASE_URL);
  assert(base.protocol === 'https:' && base.hostname === 'api.deepseek.com' &&
    !base.username && !base.password && !base.search && !base.hash,
  'Expected the existing official DeepSeek endpoint');
  assert(['', '/', '/v1', '/v1/'].includes(base.pathname), 'Unexpected DeepSeek base path');
  assert(core.LLM_API_KEY?.trim() && core.LLM_MODEL?.trim(), 'Missing shared model configuration');
  return {
    core: {
      ...core, EMBEDDING_DISABLED: 'true', EMBEDDING_API_KEY: '', EMBEDDING_BASE_URL: '',
      SAFETY_LLM_API_KEY: core.LLM_API_KEY, SAFETY_LLM_BASE_URL: core.LLM_BASE_URL,
      SAFETY_LLM_MODEL: core.LLM_MODEL,
    },
    gorse: {
      ...gorse, RERANKER_MODE: 'local', RERANKER_URL: 'http://local-ranker:8090/v1/rerank',
      RERANKER_MODEL: 'bge-hybrid-v1', RERANKER_AUTH_TOKEN: '',
      RERANKER_DAILY_CALL_LIMIT: '0', RERANKER_DAILY_TOKEN_LIMIT: '0',
    },
  };
}
