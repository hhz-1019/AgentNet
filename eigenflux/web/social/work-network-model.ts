import type { Peer } from '../types';
import type { Command, WorkPost } from './model';

export function relatedPeers(
  post: WorkPost,
  peers: Peer[],
  ownerAgentId: string,
) {
  const tags = new Set(
    post.document.tags.map((t) => t.trim().toLocaleLowerCase()),
  );
  return peers
    .filter((p) => p.agent_id !== post.agent_id && p.agent_id !== ownerAgentId)
    .map((peer) => ({
      peer,
      tags: (peer.capabilities || []).filter((t) =>
        tags.has(t.trim().toLocaleLowerCase()),
      ),
    }))
    .filter((p) => p.tags.length)
    .slice(0, 2);
}

export function publicGraphPosts(posts: WorkPost[], interests: string[]) {
  const tags = new Set(interests.map((t) => t.toLocaleLowerCase()));
  return posts
    .filter((p) => p.state === 'published' && p.visibility === 'public')
    .map((post, index) => ({
      post,
      index,
      score: post.document.tags.filter((t) => tags.has(t.toLocaleLowerCase()))
        .length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ post }) => post)
    .slice(0, 6);
}

export function shareReceipt(command?: Command, demo = false) {
  if (demo)
    return {
      label: '已记录在本机',
      detail: '演示指令未发送到真实网络。',
      tone: 'neutral',
      terminal: true,
      postId: '',
    };
  if (!command)
    return {
      label: '等待任务回执',
      detail: '指令已发送，正在读取这条任务的状态。',
      tone: 'neutral',
      terminal: false,
      postId: '',
    };
  const postId =
    command.status === 'completed' &&
    command.result.execution === 'shared' &&
    typeof command.result.post_id === 'string' &&
    /^[1-9]\d*$/.test(command.result.post_id)
      ? command.result.post_id
      : '';
  if (postId)
    return {
      label: '已发布',
      detail: '宿主已返回发布记录。',
      tone: 'success',
      terminal: true,
      postId,
    };
  const states: Record<string, [string, string, string, boolean]> = {
    pending: [
      '已排队',
      '等待 Agent 宿主接收指令；宿主离线时任务会留在队列中。',
      'neutral',
      false,
    ],
    notified: ['已通知宿主', '尚未收到宿主认领回执。', 'neutral', false],
    claimed: [
      '宿主正在处理',
      '已认领任务；资料检索和写作的细分进度尚未提供。',
      'active',
      false,
    ],
    completed: [
      '处理完成，未确认发布',
      '这条完成回执没有有效的发布记录。',
      'neutral',
      true,
    ],
    failed: ['任务失败', '查看宿主回执，修正后可发送新的指令。', 'error', true],
    expired: [
      '任务已过期',
      '这条任务已结束；需要时可重新发起。',
      'error',
      true,
    ],
  };
  const [label, detail, tone, terminal] = states[command.status] || [
    '状态待确认',
    '服务端返回了暂不支持的任务状态。',
    'neutral',
    false,
  ];
  return { label, detail, tone, terminal, postId: '' };
}
