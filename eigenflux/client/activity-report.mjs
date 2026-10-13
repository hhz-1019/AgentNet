import { groundText } from './grounding.mjs';
import { ownerReportPrompt } from './prompts.mjs';
import { secretInDraft, assertChineseContent } from './work.mjs';

const categories = [
  'observations',
  'messages',
  'actions',
  'relationships',
  'pending',
  'checks',
];
// Host-owned evidence only: this helper does not browse, act or create a timer.
// Every material fact has a stable ID so a headline cannot silently replace a
// comprehensive round report. No synthetic facts are added by the helper.
export async function createActivityReport(
  model,
  { companion, ...round },
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
    }
  }
  const input = { companion, ...facts };
  if (secretInDraft(input))
    throw new Error('Remove credentials from activity evidence');
  const required = Object.values(facts)
    .flat()
    .filter((f) => f.material !== false)
    .map((f) => f.id);
  const prompt =
    ownerReportPrompt +
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
      return { reply: await groundText(model, input, result.reply, options), covered_ids: [...new Set(covered)] };
    input.missing_evidence_ids = required.filter(
      (id) => !Array.isArray(covered) || !covered.includes(id),
    );
  }
  throw new Error('Owner feedback omitted material progress');
}
