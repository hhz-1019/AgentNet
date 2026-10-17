import { normalizeIdentity } from './identity.mjs';
import { createHash } from 'node:crypto';
import { networkBoundary } from './prompts.mjs';

export const workDraftPrompt = [
  networkBoundary,
  '根据当前身份、用户意图与真实材料组成一次图文分享，让正文与 work.media 中宿主已取得的素材一起讲清这件事。你是文案生成环节，图片由宿主在调用前准备；只用现有素材，不创造地址或声称已找图。',
  '输出简体中文 JSON：title、summary、body、kind、tags、media、identity、project_name。只用实际材料与已授权公开事实；内部身份档案不直接输出。',
].join('\n');

export function secretInDraft(document) {
  const serialized = JSON.stringify(document) || '';
  return /efcn_[a-f0-9]{64}|-----BEGIN [A-Z ]*PRIVATE KEY|\bsk-[a-z0-9_-]{16,}|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})|\bBearer\s+[a-z0-9._~+/-]{12,}|(?:api[_-]?key|password|secret|(?:access[_-]?|refresh[_-]?)?token|recovery[_-]?key|private[_-]?key|密码|验证码|恢复密钥)["'\\]*\s*[:=：]\s*["'\\]*[^\s"'\\,}]{4,}/i.test(
    serialized,
  );
}
const count = (s) => Array.from(s).length;
const bounded = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim() || count(value.trim()) > max)
    throw new Error(
      name + ' must be a nonempty string of at most ' + max + ' characters',
    );
  return value.trim();
};

// Pass only the existing companion introduction, never its whole memory store.
// These are expression cues, not additional facts authorized for publication.
export function companionVoice(companion, portrait) {
  return {
    agent_name: String(companion?.agent_name || '').slice(0, 80),
    profile: Array.from(portrait?.fields?.bio || '')
      .slice(0, 8000)
      .join(''),
  };
}

export function normalizeCompanionVoice(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid companion expression context');
  const result = {};
  for (const [key, max] of [
    ['agent_name', 80],
    ['profile', 8000],
  ]) {
    if (value[key] === undefined || value[key] === '') continue;
    result[key] = bounded(value[key], 'companion_voice.' + key, max);
  }
  if (secretInDraft(result))
    throw new Error('Remove credentials from companion expression context');
  return result;
}

// Hosts pass a curated result, not their complete conversation or filesystem.
export function workRecord(report) {
  if (report.status !== 'completed' || report.shareable !== true)
    return {
      skipped: true,
      reason: 'Only completed, explicitly shareable work creates a draft',
    };
  const work = {
    work_id: bounded(report.work_id, 'work_id', 128),
    title: bounded(report.title, 'title', 100),
    source: bounded(report.source, 'source', 500),
    result: bounded(report.result, 'result', 12000),
    evidence: bounded(report.evidence, 'evidence', 900),
    limitations: bounded(report.limitations, 'limitations', 1000),
    tags: report.tags,
    media: report.media || [],
    ...(report.agent_identity !== undefined
      ? { agent_identity: normalizeIdentity(report.agent_identity) }
      : {}),
    ...(report.companion_voice !== undefined
      ? { companion_voice: normalizeCompanionVoice(report.companion_voice) }
      : {}),
  };
  if (
    count(work.title) < 4 ||
    !Array.isArray(work.tags) ||
    !work.tags.length ||
    work.tags.length > 8 ||
    work.tags.some(
      (t) => typeof t !== 'string' || !t.trim() || count(t) > 30,
    ) ||
    new Set(work.tags.map((t) => t.trim().toLowerCase())).size !==
      work.tags.length
  )
    throw new Error('Provide a concrete title and 1–8 distinct tags');
  if (
    !Array.isArray(work.media) ||
    work.media.length > 4 ||
    work.media.some(
      (m) =>
        !m ||
        typeof m.url !== 'string' ||
        typeof m.alt !== 'string' ||
        !m.alt.trim() ||
        count(m.alt) > 300 ||
        !['image', 'chart', 'code', 'demo'].includes(m.kind),
    )
  )
    throw new Error('Provide at most 4 valid media entries');
  work.tags = work.tags.map((t) => t.trim());
  if (secretInDraft(work))
    throw new Error(
      'Remove credentials before sending a work record to a generator or draft service',
    );
  return work;
}

export function documentFromWork(work) {
  return {
    title: work.title,
    summary: Array.from(work.result).slice(0, 140).join(''),
    body: work.result + '\n\n' + work.evidence + '\n\n' + work.limitations,
    kind: 'result',
    tags: work.tags,
    media: work.media,
    identity: 'agent',
    project_name: '',
  };
}

// A stable work ID prevents retries from generating duplicate proposals.
export const proposalKey = (workID) =>
  'work:' + createHash('sha256').update(workID).digest('hex');

export function assertChineseContent(text) {
  const prose = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\/\/\S+/g, '');
  if (
    !/[\u3400-\u9fff]/.test(prose) ||
    /[A-Za-z]{2,}(?:[ ,]+[A-Za-z]{2,}){4,}/.test(prose)
  )
    throw new Error('请用中文重新整理描述，代码、链接和必要技术名词可以保留');
}
