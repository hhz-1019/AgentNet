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
  const url = core.LLM_BASE_URL.replace(/\/+$/, '') + '/chat/completions';
  return {
    core: {
      ...core, EMBEDDING_DISABLED: 'true', EMBEDDING_API_KEY: '', EMBEDDING_BASE_URL: '',
      SAFETY_LLM_API_KEY: core.LLM_API_KEY, SAFETY_LLM_BASE_URL: core.LLM_BASE_URL,
      SAFETY_LLM_MODEL: core.LLM_MODEL,
    },
    gorse: {
      ...gorse, RERANKER_URL: url, RERANKER_MODEL: core.LLM_MODEL,
      RERANKER_AUTH_TOKEN: core.LLM_API_KEY,
    },
  };
}
