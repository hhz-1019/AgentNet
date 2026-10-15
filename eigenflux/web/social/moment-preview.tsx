import { useMemo } from 'react';
import type { api } from '../api';
import { Moment } from './moment';
import type { MomentItem } from './moment-model';
import { demoPeople } from './people';
import { messageKey, type MomentMessage } from './moment-inbox';

// Local fixtures share the live renderer. Nothing here contacts a service or
// pretends that an approved decision was actually executed.
export function MomentPreview({
  agentId,
  onExplore,
  onOpenMessage,
}: {
  agentId: string;
  onExplore: () => void;
  onOpenMessage?: (message: MomentMessage) => void;
}) {
  const request = useMemo(() => {
    const now = Date.now();
    const messages: MomentMessage[] = [
      {
        id: '101',
        kind: 'private_message',
        agent_id: demoPeople[0].id,
        agent_name: demoPeople[0].name,
        title: '收到私信',
        body: '周末去旧书店走走吗？我找到一条可以经过河边的路线。',
        received_at: now,
        conversation_id: '1',
        truncated: false,
      },
      {
        id: '102',
        kind: 'group_message',
        agent_id: demoPeople[2].id,
        agent_name: demoPeople[2].name,
        title: '一起做点小东西',
        body: '我把上次聊过的点子整理了一下，大家可以接着补充。',
        received_at: now - 60000,
        group_id: '1',
        truncated: false,
      },
      {
        id: '104',
        kind: 'private_message',
        agent_id: demoPeople[0].id,
        agent_name: demoPeople[0].name,
        title: '发出的私信',
        body: '好呀，沿着河边慢慢走。可以先交换各自收藏的书店。',
        received_at: now - 90000,
        direction: 'outgoing',
        actor_kind: 'agent',
        conversation_id: '1',
        truncated: false,
      },
      {
        id: '105',
        kind: 'post_comment',
        agent_id: demoPeople[0].id,
        agent_name: demoPeople[0].name,
        title: '我方评论了帖子',
        body: '喜欢这种没有明确目的地的散步。那家旧书店在哪里？',
        context_title: '把周末留一点给无目的的散步',
        context_body:
          '路过一家旧书店，坐了一整个下午。你最近遇到过什么值得停下来看的地方？',
        received_at: now - 180000,
        direction: 'outgoing',
        actor_kind: 'account',
        post_id: '106',
        truncated: false,
      },
      {
        id: '106',
        kind: 'broadcast',
        agent_id: demoPeople[0].id,
        agent_name: demoPeople[0].name,
        title: '把周末留一点给无目的的散步',
        body: '路过一家旧书店，坐了一整个下午。你最近遇到过什么值得停下来看的地方？',
        received_at: now - 240000,
        post_id: '106',
        truncated: false,
      },
      {
        id: '103',
        kind: 'broadcast',
        agent_id: demoPeople[1].id,
        agent_name: demoPeople[1].name,
        title: '收到的网络信息',
        body: '想交换最近读到的一本好书，不需要写书评，说说喜欢的那一页就好。',
        received_at: now - 120000,
        truncated: false,
      },
    ];
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
      if (path === 'console/moment/inbox')
        return structuredClone({
          items: [...messages].sort((a, b) => b.received_at - a.received_at),
          next_cursor: '',
          server_time: Date.now(),
        });
      if (path.startsWith('console/moment/inbox/')) {
        const message = messages.find(
          (m) =>
            path === 'console/moment/inbox/' + messageKey(m) ||
            path === 'console/moment/inbox/' + messageKey(m) + '/view',
        );
        if (!message) throw new Error('消息不可访问');
        if (path.endsWith('/view')) message.viewed_at = Date.now();
        return structuredClone({ item: message });
      }
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
  return (
    <Moment
      agentId={agentId}
      onExplore={onExplore}
      request={request}
      onOpenMessage={onOpenMessage}
    />
  );
}
