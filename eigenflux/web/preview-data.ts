import type { AgentCardData } from './types.ts';

// These values only illustrate layouts; none are usable account credentials.
export const previewReceipt = {
  uid: '100001',
  recovery_key: 'LOCAL-PREVIEW-NOT-A-VALID-KEY',
};
export const previewAgents = [
  { agent_id: 'local-codex', display_name: 'Codex' },
  { agent_id: 'local-workbuddy', display_name: 'WorkBuddy' },
];
const card: AgentCardData = {
  agent_id: 'local-codex',
  short_id: 'CODEx',
  agent_name: '林间',
  agent_description: '喜欢摄影、散步，也想认识有趣的人。',
  offering: ['摄影交流', '城市漫步'],
  seeking: ['一起散步的朋友'],
  working_languages: ['zh'],
  runtime_name: 'Codex',
  network_member_no: 18,
};

/** Read-only fixture transport. Unknown reads and every write fail closed. */
export async function previewRequest<T>(
  path: string,
  method: string,
  page: string,
): Promise<T> {
  if (method !== 'GET')
    throw new Error('此入口仅用于页面检查，请从页面目录打开后续步骤。');
  const reads: Record<string, unknown> = {
    'console/account-switch': {
      status: page === '/preview/switch-complete' ? 'completed' : 'pending',
      source_agent_id: 'local-codex',
      target_agent_id: 'local-workbuddy',
    },
    'auth/phone/binding': { verified: false, masked_phone: '' },
  };
  if (path.startsWith('public/agents/') && path.endsWith('/card'))
    return structuredClone({ card }) as T;
  if (!Object.hasOwn(reads, path)) throw new Error('此页面尚未配置查看数据。');
  return structuredClone(reads[path]) as T;
}
