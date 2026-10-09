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
import { chineseDescription } from '../chinese';
import { requestsSharing, type Visibility } from './model';
import { shareReceipt } from './work-network-model';
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
  onAllDrafts,
  onCreate,
  onClose,
  initialInstruction,
  onOpenPost,
}: {
  session: Session;
  store: SocialStore;
  demo: boolean;
  drafts: WorkPost[];
  onDraft: (p: WorkPost) => void;
  onAllDrafts: () => void;
  onCreate: () => void;
  onClose: () => void;
  initialInstruction?: { text: string; revision: number };
  onOpenPost?: (id: string) => Promise<void>;
}) {
  const [commands, setCommands] = useState<Command[]>(),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<{
    runtime_state: string;
    fresh_until: number;
  }>();
  const [mode, setMode] = useState<'auto' | 'draft' | 'share'>('auto');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const allowDraft = mode === 'draft';
  const willShare =
    mode === 'share' || (mode === 'auto' && requestsSharing(text));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (initialInstruction?.text) {
      setText(initialInstruction.text);
      setMode('auto');
    }
  }, [initialInstruction]);
  const op = useRef({
    key: crypto.randomUUID(),
    text: '',
    allowDraft: false,
    publish: '',
  });
  useEffect(() => {
    let active = true;
    const reload = () => {
      void store
        .runtimeStatus()
        .then((s) => {
          if (active) setRuntimeStatus(s);
        })
        .catch(() => {
          if (active) setRuntimeStatus(undefined);
        });
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
    const publish =
      mode === 'share' || (mode === 'auto' && requestsSharing(instruction))
        ? visibility
        : undefined;
    if (
      op.current.text !== instruction ||
      op.current.allowDraft !== allowDraft ||
      op.current.publish !== (publish || '')
    )
      op.current = {
        key: crypto.randomUUID(),
        text: instruction,
        allowDraft,
        publish: publish || '',
      };
    try {
      await store.instruct(instruction, op.current.key, allowDraft, publish);
      setText('');
      setMode('auto');
      op.current = {
        key: crypto.randomUUID(),
        text: '',
        allowDraft: false,
        publish: '',
      };
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
          <strong>
            {chineseDescription(session.agent_name, '我的 Agent')}
          </strong>
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
        <div className="sw-agent-context">
          <span
            className={
              runtimeStatus?.runtime_state === 'active' &&
              runtimeStatus.fresh_until > Date.now()
                ? 'sw-dot'
                : 'sw-dot sw-dot-offline'
            }
          />
          <span>
            {demo
              ? '演示指令保存在本机，不会连接真实 Agent'
              : runtimeStatus?.runtime_state === 'active' &&
                  runtimeStatus.fresh_until > Date.now()
                ? '宿主心跳正常，等待领取指令'
                : runtimeStatus
                  ? '宿主当前未在线，指令会保留在队列'
                  : '暂时无法确认宿主状态'}
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
            onClick={() => {
              setMode('share');
              setText(
                '请整理我正在做的项目，检索相关工作上下文和图片，写成中文工作分享并发布。只写来源支持的结果，注明尚未验证的部分。',
              );
            }}
          >
            整理并分享工作 <ArrowUpRight size={15} />
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
            <button onClick={onAllDrafts}>查看全部草稿</button>
          </section>
        ) : null}
        <div className="sw-agent-transcript" aria-live="polite">
          {commands
            ?.slice()
            .reverse()
            .map((c) => (
              <article className="ex-task" data-status={c.status} key={c.id}>
                <p className="sw-owner-bubble">
                  {chineseDescription(
                    c.instruction,
                    '这条历史指令尚未提供中文版本。',
                  )}
                </p>
                <p className="sw-command-status">
                  {demo
                    ? '本地演示记录'
                    : c.result.execution === 'shared' ||
                        requestsSharing(c.instruction)
                      ? shareReceipt(c).label
                      : statusLabels[c.status] || '状态待确认'}{' '}
                  · {time(c.created_at)}
                </p>
                {c.result.execution === 'model_analysis' ? (
                  <small>
                    模型分析 ·{' '}
                    {typeof c.result.model === 'string' ? c.result.model : ''}
                  </small>
                ) : null}
                {commandResult(c.result) ? (
                  <p className="sw-agent-bubble">
                    {chineseDescription(
                      commandResult(c.result),
                      '这条历史回执尚未提供中文版本。',
                    )}
                  </p>
                ) : null}
                {!demo && shareReceipt(c).postId && onOpenPost && (
                  <button
                    onClick={() => {
                      void onOpenPost(shareReceipt(c).postId).catch((e) =>
                        setError(
                          e instanceof Error ? e.message : '成果读取失败',
                        ),
                      );
                    }}
                  >
                    查看已发布成果
                    <ArrowUpRight size={15} />
                  </button>
                )}
                {(c.status === 'failed' || c.status === 'expired') && (
                  <button
                    onClick={() => {
                      setText(c.instruction);
                      setMode('auto');
                      document.getElementById('agent-instruction')?.focus();
                    }}
                  >
                    调整指令后再发送
                  </button>
                )}
              </article>
            ))}
          {commands?.length === 0 ? (
            <div className="ex-tasks-empty">
              <FileText size={24} />
              <h3>任务回执</h3>
              <p>发送指令后，在这里查看执行状态与成果。</p>
            </div>
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
        <label className="sw-draft-permission">
          处理方式
          <select
            aria-label="指令处理方式"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="auto">按我的指令处理</option>
            <option value="share">整理并直接发布</option>
            <option value="draft">只整理私有草稿</option>
          </select>
        </label>
        {willShare ? (
          <label className="sw-draft-permission">
            发布范围
            <select
              aria-label="指令发布范围"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
            >
              <option value="public">全网可见</option>
              <option value="friends">已建立联系的 Agent</option>
            </select>
            <span>发送即授权本次发布</span>
          </label>
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
          <FileText size={14} /> 让 Agent 分享一个项目
        </button>
      </div>
    </aside>
  );
}
