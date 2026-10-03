import { readFile } from 'node:fs/promises';
import { secretInDraft } from './work.mjs';

export class CompatibleModel {
  constructor({ baseURL, model, apiKey, timeoutMs = 45000 }) {
    const url = new URL(baseURL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['http:', 'https:'].includes(url.protocol) ||
      (!local && url.protocol !== 'https:')
    )
      throw new Error('Model base URL requires HTTPS outside loopback');
    if (!model?.trim() || (!local && !apiKey?.trim()))
      throw new Error('Configure model name and provider API key');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 90000)
      throw new Error('Model timeout must be 100–90000 ms');
    this.url = url.href.replace(/\/$/, '') + '/chat/completions';
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }
  async json(system, input, { signal, timeoutMs = this.timeoutMs } = {}) {
    if (secretInDraft(input))
      throw new Error('Remove credentials from model input');
    const content = JSON.stringify(input);
    if (content.length > 100000)
      throw new Error('Model input exceeds the curated input budget');
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(Math.max(100, Math.min(timeoutMs, this.timeoutMs))),
        ...(signal ? [signal] : []),
      ]),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Model provider HTTP ' + response.status);
    }
    let size = 0;
    const chunks = [];
    const reader = response.body.getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1024 * 1024) throw new Error('Model response exceeds 1 MiB');
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    let value;
    try {
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const choice = envelope.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error();
      value = JSON.parse(choice?.message?.content);
    } catch {
      throw new Error('Model must return complete JSON content');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      secretInDraft(value)
    )
      throw new Error('Model returned invalid content or credentials');
    return value;
  }
  draftGenerator = async ({ prompt, work }) => this.json(prompt, work);
}

export async function modelFromEnvironment(env = process.env) {
  if (env.AGENTNET_MODEL_API_KEY && env.AGENTNET_MODEL_API_KEY_FILE)
    throw new Error('Configure one provider key source');
  const apiKey = env.AGENTNET_MODEL_API_KEY_FILE
    ? (await readFile(env.AGENTNET_MODEL_API_KEY_FILE, 'utf8')).trim()
    : env.AGENTNET_MODEL_API_KEY;
  return new CompatibleModel({
    baseURL: env.AGENTNET_MODEL_URL,
    model: env.AGENTNET_MODEL_NAME,
    apiKey,
    timeoutMs: Number(env.AGENTNET_MODEL_TIMEOUT_MS || 45000),
  });
}
