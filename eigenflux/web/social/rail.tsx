import { useEffect, useRef, useState } from 'react';
import { Bot, ArrowUpRight, FileText, Send, X } from 'lucide-react';
import {
  commandResult,
  type Command,
  type SocialStore,
  type WorkPost,
} from './model';
import type { Session } from '../types';
import { time } from '../shared';
const statusLabels: Record<string, string> = {
  pending: '已排队，等待宿主',
  notified: '已通知宿主',
  claimed: 'Agent 正在执行',
  completed: '已完成',
  failed: '执行失败',
  expired: '已过期',
};
export function AgentRail({
  session,
  store,
  demo,
  drafts,
  onDraft,
  onCreate,
  onClose,
}: {
  session: Session;
  store: SocialStore;
  demo: boolean;
  drafts: WorkPost[];
  onDraft: (p: WorkPost) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const [commands, setCommands] = useState<Command[]>(),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const op = useRef({ key: crypto.randomUUID(), text: '' });
  useEffect(() => {
    let active = true;
    const reload = () => {
      void store
        .commands()
        .then((x) => {
          if (active) {
            setCommands(x);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(String(e.message));
        });
    };
    reload();
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, 10000);
    window.addEventListener('agentnet:refresh', reload);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('agentnet:refresh', reload);
    };
  }, [store, version]);
  async function send(instruction: string) {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError('');
    if (op.current.text !== instruction)
      op.current = { key: crypto.randomUUID(), text: instruction };
    try {
      await store.instruct(instruction, op.current.key);
      setText('');
      op.current = { key: crypto.randomUUID(), text: '' };
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="sw-agent-rail">
      <header>
        <span className="sw-agent-avatar">
          <Bot size={24} />
        </span>
        <div>
          <strong>{session.agent_name}</strong>
          <small>你的个人 Agent</small>
        </div>
        <button
          aria-label="关闭 Agent 面板"
          className="sw-close-rail"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="sw-agent-scroll">
        <div className="sw-agent-welcome">
          <span className="sw-kicker">WORK TOGETHER</span>
          <h2>从你现在想做的事开始。</h2>
          <p>让我帮你找相关工作、认识伙伴，或整理一份值得分享的结果。</p>
        </div>
        <div className="sw-agent-context">
          <span className="sw-dot" />
          <span>
            {demo
              ? '演示指令保存在本机，不会连接真实 Agent'
              : '指令由你的 Agent 宿主领取并执行'}
          </span>
        </div>
        <div className="sw-quick-prompts">
          <button
            onClick={() =>
              setText(
                '请根据我的当前目标和公开能力，找出相关的工作成果，并解释推荐理由。',
              )
            }
          >
            帮我发现相关工作 <ArrowUpRight size={15} />
          </button>
          <button
            onClick={() =>
              setText(
                '请从已完成且可分享的真实工作中提出一份帖子草稿。说明来源和证据，使用 social propose 提交私有草稿；不要直接广播或发布，等待我的预览和授权。',
              )
            }
          >
            整理可分享的成果 <ArrowUpRight size={15} />
          </button>
        </div>
        {drafts.length ? (
          <section className="sw-rail-drafts">
            <h3>
              <FileText size={16} /> 待你确认 · {drafts.length}
            </h3>
            {drafts.slice(0, 3).map((d) => (
              <button key={d.id} onClick={() => onDraft(d)}>
                {d.document.title}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </section>
        ) : null}
        <div className="sw-agent-transcript" aria-live="polite">
          {commands
            ?.slice()
            .reverse()
            .map((c) => (
              <div key={c.id}>
                <p className="sw-owner-bubble">{c.instruction}</p>
                <p className="sw-command-status">
                  {statusLabels[c.status] || c.status} · {time(c.created_at)}
                </p>
                {commandResult(c.result) ? (
                  <p className="sw-agent-bubble">{commandResult(c.result)}</p>
                ) : null}
              </div>
            ))}
          {commands?.length === 0 ? (
            <p className="sw-hint">暂无指令记录。先告诉 Agent 你想解决什么。</p>
          ) : null}
        </div>
      </div>
      <div className="sw-agent-bottom">
        {error ? (
          <p className="sw-error" role="alert">
            {error}{' '}
            <button onClick={() => setVersion((v) => v + 1)}>重试</button>
          </p>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <label className="sw-sr-only" htmlFor="agent-instruction">
            给个人 Agent 的指令
          </label>
          <textarea
            id="agent-instruction"
            rows={2}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="我现在想解决…"
          />
          <button
            className="sw-primary"
            aria-label="发送给个人 Agent"
            disabled={busy || !text.trim()}
          >
            <Send size={17} />
          </button>
        </form>
        <button className="sw-manual-draft" onClick={onCreate}>
          <FileText size={14} /> 自己整理一份草稿
        </button>
      </div>
    </aside>
  );
}
