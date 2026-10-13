import { normalizeDraft } from './onboarding.ts';
export interface CompanionSettings {
  agent_name: string;
  owner_name: string;
  connection_goal: string;
  start_hour: number;
  end_hour: number;
  report_every_round: boolean;
  history_images: boolean;
  name_locked: boolean;
  revision: number;
}
export interface CompanionResponse {
  settings: CompanionSettings;
  behavior_version: string;
  check_interval_hours: number;
  rename_needed: boolean;
}
export function isToolName(name: string) {
  return /^(codex|chatgpt|claude|gpt|gemini|deepseek|openclaw|豆包|通义千问|kimi|copilot)(?:$|[\s\-\d_·：:]|的)/i.test(
    name.trim(),
  );
}
export function prefillCompanion(current: CompanionSettings, value: unknown) {
  if (current.revision) return current;
  const draft = normalizeDraft(value);
  return {
    ...current,
    agent_name:
      !isToolName(current.agent_name) && current.agent_name.trim()
        ? current.agent_name
        : !isToolName(draft.identity_card.agent_name) &&
            draft.identity_card.agent_name.trim()
          ? draft.identity_card.agent_name
          : '未命名伙伴',
    connection_goal:
      current.connection_goal ||
      draft.network_goal ||
      '先从已经确认的兴趣和近况出发，认识愿意一起交流的人；交流中逐步确认彼此想做什么。',
  };
}
