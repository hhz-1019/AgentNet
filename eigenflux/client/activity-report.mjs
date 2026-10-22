import { generationIdentity, companionIdentity } from './identity.mjs';
import { groundText } from './grounding.mjs';
import { ownerReportPrompt } from './prompts.mjs';
import { socialWritingWorkflow } from './workflows.mjs';
import {
  secretInDraft,
  assertChineseContent,
  normalizeCompanionVoice,
} from './work.mjs';

const categories = [
  'observations',
  'messages',
  'actions',
  'relationships',
  'pending',
  'checks',
];
function actionURL(value) {
  if (typeof value !== 'string')
    throw new Error('Owner action needs a verified action_url');
  const url = new URL(value);
  const base =
    url.origin === 'https://inspiralai.com' &&
    !url.username &&
    !url.password &&
    !url.hash;
  const plain =
    /^\/dashboard\/(settings|profile|activity|attention)$/.test(url.pathname) &&
    !url.search;
  const person = /^\/dashboard\/person\/\d+$/.test(url.pathname) && !url.search;
  const query =
    url.pathname === '/dashboard/messages'
      ? 'peer'
      : url.pathname === '/dashboard/explore'
        ? 'post'
        : url.pathname === '/dashboard/attention'
          ? 'item'
          : '';
  const targeted =
    query &&
    [...url.searchParams.keys()].length === 1 &&
    /^\d+$/.test(url.searchParams.get(query) || '');
  if (!base || !(plain || person || targeted))
    throw new Error('Owner action URL must target a supported elsewhere page');
  return value;
}
function linkedReply(reply, facts) {
  const all = Object.values(facts).flat();
  const allowed = new Set(all.map((f) => f.action_url).filter(Boolean));
  // Even a factual-review repair may remove a link or introduce a made-up one.
  for (const match of reply.matchAll(/https?:\/\/[^\s)\]>]+/g))
    if (!allowed.has(match[0]))
      throw new Error('Owner feedback invented a link');
  for (const fact of all) {
    if (
      fact.needs_owner === true &&
      reply.includes(fact.action_url) &&
      !reply.includes(`](${fact.action_url})`)
    )
      reply = reply.replaceAll(
        fact.action_url,
        `[${fact.action_label || '查看相关事项'}](${fact.action_url})`,
      );
  }
  const missing = all.filter(
    (f) => f.needs_owner === true && !reply.includes(`](${f.action_url})`),
  );
  if (!missing.length) return reply;
  return (
    reply +
    '\n\n' +
    missing
      .map(
        (f) =>
          `- ${f.text} [${f.action_label || '查看相关事项'}](${f.action_url})`,
      )
      .join('\n')
  );
}
// Host-owned evidence only: this helper does not browse, act or create a timer.
// Every material fact has a stable ID so a headline cannot silently replace a
// comprehensive round report. No synthetic facts are added by the helper.
export async function createActivityReport(
  model,
  { companion, companion_voice, agent_identity, ...round },
  options = {},
) {
  const facts = Object.fromEntries(
    categories.map((category) => [category, round[category] || []]),
  );
  const seen = new Set();
  for (const values of Object.values(facts)) {
    if (!Array.isArray(values) || values.length > 100)
      throw new Error('Invalid activity evidence');
    for (const fact of values) {
      if (
        !fact ||
        typeof fact.id !== 'string' ||
        !fact.id ||
        seen.has(fact.id) ||
        typeof fact.text !== 'string' ||
        !fact.text.trim()
      )
        throw new Error('Activity facts need unique IDs and text');
      seen.add(fact.id);
      if (fact.needs_owner === true || fact.action_url !== undefined)
        actionURL(fact.action_url);
      if (
        fact.action_label !== undefined &&
        (typeof fact.action_label !== 'string' ||
          !fact.action_label.trim() ||
          fact.action_label.length > 80 ||
          /[[\]\n\r]/.test(fact.action_label))
      )
        throw new Error('Invalid owner action label');
    }
  }
  const input = {
    companion,
    agent_identity:
      generationIdentity(agent_identity, 'chat') ||
      companionIdentity(companion, {
        fields: { bio: companion_voice?.profile || '' },
      }),
    ...(companion_voice !== undefined
      ? { companion_voice: normalizeCompanionVoice(companion_voice) }
      : {}),
    ...facts,
  };
  if (secretInDraft(input))
    throw new Error('Remove credentials from activity evidence');
  const required = Object.values(facts)
    .flat()
    .filter((f) => f.material !== false)
    .map((f) => f.id);
  const prompt =
    ownerReportPrompt +
    '\n' +
    socialWritingWorkflow +
    '\n同时返回 covered_ids 字符串数组，列出反馈真正涵盖的证据编号。覆盖所有 material 不为 false 的证据，可将有关的事实合并成自然段。不能只列编号而在 reply 中漏掉实质进展。checks 失败须如实说没检查到，不等于没变化。';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.json(prompt, input, options);
    if (
      typeof result.reply !== 'string' ||
      !result.reply.trim() ||
      result.reply.length > 12000 ||
      secretInDraft(result.reply)
    )
      throw new Error('Invalid owner feedback');
    assertChineseContent(result.reply);
    const covered = result.covered_ids;
    if (
      Array.isArray(covered) &&
      covered.every((id) => seen.has(id)) &&
      required.every((id) => covered.includes(id))
    )
      return {
        reply: linkedReply(
          await groundText(model, input, result.reply, options),
          facts,
        ),
        covered_ids: [...new Set(covered)],
      };
    input.missing_evidence_ids = required.filter(
      (id) => !Array.isArray(covered) || !covered.includes(id),
    );
  }
  throw new Error('Owner feedback omitted material progress');
}
