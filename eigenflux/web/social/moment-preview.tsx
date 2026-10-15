import { useMemo } from 'react';
import type { api } from '../api';
import { Moment } from './moment';
import type { MomentItem } from './moment-model';
import { demoPeople } from './people';

// Local fixtures share the live renderer. Nothing here contacts a service or
// pretends that an approved decision was actually executed.
export function MomentPreview({
  agentId,
  onExplore,
}: {
  agentId: string;
  onExplore: () => void;
}) {
  const request = useMemo(() => {
    const now = Date.now();
    const items: MomentItem[] = [
      [
        '确认下一轮找人的方向',
        '先认识愿意交流产品体验的朋友。',
        agentId,
        '你的 Agent',
      ],
      [
        '一起整理周末的散步路线？',
        '林间分享了两家旧书店，想先交换各自收藏的地点。',
        demoPeople[0].id,
        demoPeople[0].name,
      ],
      [
        '把这个小项目整理成草稿？',
        '先整理讨论过的想法，保存一份草稿供你查看。',
        demoPeople[2].id,
        demoPeople[2].name,
      ],
    ].map(([title, body, id, name], i) => ({
      attention_id: String(i + 1),
      title,
      body,
      recommendation: '先核对内容，再决定是否继续。',
      category: 'other_decision',
      status: 'open',
      response_status: 'none',
      item_revision: 1,
      created_at: now - i * 60000,
      expires_at: now + 86400000,
      related_agent: { agent_id: id, name },
      context_ref: {
        moment: {
          priority: 80 - i * 20,
          executor_id: 'preview',
          scopes: { yes: '仅在本地演示选择流程，不执行外部操作。' },
        },
      },
      actions: [
        {
          action_key: 'yes',
          kind: 'custom',
          flag: '继续了解',
          appearance: 'primary',
        },
      ],
    }));
    return (async (path, body) => {
      if (path === 'console/moment')
        return structuredClone({
          items,
          next_cursor: '',
          server_time: Date.now(),
        });
      const id = path.split('/')[2];
      const item = items.find((i) => i.attention_id === id);
      if (!item) throw new Error('事项不存在');
      const input = body as {
        action?: string;
        action_key?: string;
        condition?: string;
      };
      item.item_revision++;
      if (path.endsWith('/respond')) {
        item.status = 'pending';
        item.selected_action_key = input.action_key;
        item.command = {
          command_id: 'preview-' + id,
          status: 'pending',
          selected_at: Date.now(),
          condition: input.condition,
          authorization_scope: item.context_ref!.moment!.scopes.yes,
        };
        return { command_id: item.command.command_id };
      }
      item.status = input.action === 'reopen' ? 'open' : 'dismissed';
      if (input.action === 'revoke' && item.command) {
        item.command.status = 'failed';
        item.command.revoked_at = Date.now();
      }
      if (input.action === 'reopen') item.selected_action_key = undefined;
      return {};
    }) as typeof api;
  }, [agentId]);
  return <Moment agentId={agentId} onExplore={onExplore} request={request} />;
}
