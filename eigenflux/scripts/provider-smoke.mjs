import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { checkConfig } from './check.mjs';

const env = parseEnv(await readFile('.env.eigenflux', 'utf8'));
assert.deepEqual(checkConfig(env), []);
assert.equal(env.LLM_API_STYLE, 'chat_completions');
const probes = [
  {
    name: 'LLM',
    url: env.LLM_BASE_URL + '/chat/completions',
    key: env.LLM_API_KEY,
    body: {
      model: env.LLM_MODEL,
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      thinking: { type: 'disabled' },
      max_tokens: 16,
    },
    verify: (data) => {
      assert.equal(data.choices?.[0]?.finish_reason, 'stop');
      assert.equal(data.choices?.[0]?.message?.content?.trim(), 'OK');
    },
  },
  {
    name: 'Embedding',
    url: env.EMBEDDING_BASE_URL + '/embeddings',
    key: env.EMBEDDING_API_KEY,
    body: {
      model: env.EMBEDDING_MODEL,
      input: ['Agent collaboration network'],
      dimensions: Number(env.EMBEDDING_DIMENSIONS),
      encoding_format: 'float',
    },
    verify: (data) => {
      const vector = data.data?.[0]?.embedding;
      assert.equal(vector?.length, Number(env.EMBEDDING_DIMENSIONS));
      assert(vector.every(Number.isFinite));
    },
  },
];
for (const probe of probes) {
  const response = await fetch(probe.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + probe.key,
    },
    body: JSON.stringify(probe.body),
    signal: AbortSignal.timeout(45000),
  });
  // Provider error bodies can contain request details. Never echo them or keys.
  assert(response.ok, `${probe.name} returned HTTP ${response.status}`);
  probe.verify(await response.json());
  console.log(`PASS: ${probe.name} real provider request`);
}
