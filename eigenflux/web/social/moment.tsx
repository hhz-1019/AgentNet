import { plainText } from '../plain-text';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useEntryPreparation } from '../entry-preparation';
import { AgentAvatar } from '../avatar';
import { AttentionSource } from '../activity';
import { Dialog } from './dialog';
import { DragRail } from './drag-rail';
import { MomentField } from './moment-field';
import { useMomentChat } from './moment-chat';
import { prepareDecision, type DecisionAttempt } from './moment-decision';
import {
  useMomentInbox,
  MomentInboxDetails,
  type MomentMessage,
} from './moment-inbox';
import {
  groupMoments,
  momentStage,
  momentLabels,
  actionText,
  hasMomentReceipt,
  type MomentItem,
  type MomentPage,
} from './moment-model';
import './crossing.css';
import './moment.css';

// Demo data is intentionally never imported by this authenticated surface.
export function Moment({
  agentId,
  onExplore,
  request: sendRequest = api,
  onOpenMessage,
}: {
  agentId: string;
  onExplore: () => void;
  request?: typeof api;
  onOpenMessage?: (message: MomentMessage) => void;
}) {
  const chat = useMomentChat();
  const inbox = useMomentInbox(sendRequest);
  const [showMessages, setShowMessages] = useState(true);
  const [sent, setSent] = useState<string[]>([]);
  const [items, setItems] = useState<MomentItem[]>([]),
    [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''),
    [feedback, setFeedback] = useState('');
  const [pages, setPages] = useState(1),
    [more, setMore] = useState(false);
  const [selected, setSelected] = useState(''),
    [itemId, setItemId] = useState('');
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [choice, setChoice] = useState('');
  const [view, setView] = useState<
    '' | 'item' | 'approval' | 'result' | 'evidence'
  >('');
  const [now, setNow] = useState(Date.now());
  const origin = useRef<HTMLElement | null>(null),
    mounted = useRef(true),
    inflight = useRef(false);
  const offset = useRef(0);
  const chosenRevision = useRef(0);
  const requestedPage = useRef(0);
  const refreshQueued = useRef(false);
  const latestRefresh = useRef<() => Promise<void>>(async () => {});
  const attempt = useRef<DecisionAttempt | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (inflight.current) {
      refreshQueued.current = true;
      return;
    }
    inflight.current = true;
    try {
      const all: MomentItem[] = [];
      let cursor = '';
      for (let n = 0; n < pages; n++) {
        const page = await sendRequest<MomentPage>(
          'console/moment' +
            (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
        );
        all.push(...page.items);
        cursor = page.next_cursor;
        offset.current = page.server_time - Date.now();
        if (!cursor) break;
      }
      if (mounted.current) {
        setItems([...new Map(all.map((i) => [i.attention_id, i])).values()]);
        setMore(Boolean(cursor));
        setError('');
        setLoaded(true);
        setNow(Date.now() + offset.current);
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '事项读取失败');
    } finally {
      inflight.current = false;
      if (refreshQueued.current && mounted.current) {
        refreshQueued.current = false;
        void latestRefresh.current();
      }
    }
  }, [pages, sendRequest]);
  latestRefresh.current = refresh;
  useEntryPreparation(
    (!loaded && !error) || (!inbox.loaded && !inbox.error),
    Boolean(error) && !loaded && Boolean(inbox.error),
  );
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) {
        setNow(Date.now() + offset.current);
        void refresh();
      }
    }, 8000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('agentnet:refresh', visible);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('agentnet:refresh', visible);
    };
  }, [refresh]);
  const groups = groupMoments(items, agentId, now, inbox.messages),
    group = groups.find((g) => g.id === selected);
  const item =
    group?.items.find((i) => i.attention_id === itemId) || group?.items[0];
  const stage = item ? momentStage(item, now) : 'open',
    condition = item ? conditions[item.attention_id] || '' : '';
  const action = item?.actions.find((a) => a.action_key === choice);
  const scope = action
    ? item?.context_ref?.moment?.scopes[action.action_key]
    : undefined;
  const resetChoice = () => {
    setView('');
    setChoice('');
    setFeedback('');
    attempt.current = undefined;
  };
  async function mutate(kind: 'confirm' | 'defer' | 'reopen' | 'revoke') {
    if (!item || busy || (kind === 'confirm' && !action)) return;
    if (kind === 'confirm' && chosenRevision.current !== item.item_revision) {
      setChoice('');
      setFeedback('事项已更新，补充条件已保留。请核对后重新选择。');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      if (kind === 'confirm') {
        const body = {
          action_key: action!.action_key,
          expected_item_revision: item.item_revision,
          condition,
        };
        const request = prepareDecision(
          attempt.current,
          item.attention_id,
          body,
          chat.executor,
        );
        attempt.current = request;
        const saved = await sendRequest<{ command_id: string }>(
          'console/attention-items/' + item.attention_id + '/respond',
          {
            ...request.body,
            idempotency_key: request.key,
          },
        );
        // Saving the decision succeeds independently of message transport.
        // Always refresh so a failed send cannot look like a failed approval.
        try {
          if (request.body.chat_executor) {
            await chat.send(saved.command_id, request.body.chat_executor);
            setSent((ids) => [...ids, saved.command_id]);
          }
          setFeedback('');
        } catch (e) {
          setFeedback(
            '审批已保存。' +
              (e instanceof Error ? e.message : '消息发送结果未确认。'),
          );
        }
      } else {
        await sendRequest('console/moment/' + item.attention_id + '/state', {
          action: kind,
          expected_item_revision: item.item_revision,
        });
        setFeedback('');
      }
      attempt.current = undefined;
      setChoice('');
      setView('');
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await refresh();
        setChoice('');
        attempt.current = undefined;
        setFeedback(
          e.code === 'MOMENT_EXECUTING'
            ? e.message
            : '事项或授权上下文已变化。补充条件已保留，请核对最新内容后重新选择。',
        );
      } else setFeedback(e instanceof Error ? e.message : '提交失败，请重试。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const activeView =
    (view === 'approval' && !action ? 'item' : view) ||
    (item?.command &&
    (hasMomentReceipt(item) || ['pending', 'executing'].includes(stage))
      ? 'result'
      : 'item');
  return (
    <section className="mb mb-live" aria-label="此刻的 Agent 与事项">
      {error && (
        <div role="alert" className="mb-load-message">
          {error} <button onClick={() => void refresh()}>重试</button>
        </div>
      )}
      {inbox.error && (
        <div role="alert" className="mb-load-message">
          消息暂时无法读取。{' '}
          <button onClick={() => void inbox.refresh()}>重新读取消息</button>
        </div>
      )}
      {((!loaded && !error) || (!inbox.loaded && !inbox.error)) && (
        <output className="mb-load-message">正在读取…</output>
      )}
      {loaded && inbox.loaded && !error && !inbox.error && !groups.length && (
        <div className="mb-empty">
          <span className="mb-empty-avatar">
            <AgentAvatar agentId={agentId} />
          </span>
          <h1>此刻，还没有收到新的消息</h1>
          <p>收到的消息与需要你决定的事项，会在这里相遇。</p>
          <div className="mb-empty-actions">
            <button onClick={onExplore}>去发现看看</button>
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <MomentField
          groups={groups}
          frozen={Boolean(group)}
          onSelect={(id, element) => {
            const chosen = groups.find((g) => g.id === id);
            if (!chosen) return;
            origin.current = element;
            setSelected(id);
            setItemId(chosen.items[0]?.attention_id || '');
            setShowMessages(chosen.messages.length > 0);
            resetChoice();
          }}
          onReachEdge={() => {
            inbox.loadMore();
            if (more && !inflight.current && requestedPage.current !== pages) {
              requestedPage.current = pages;
              setPages((p) => p + 1);
            }
          }}
        />
      )}
      {group && (item || group.messages.length > 0) && (
        <Dialog
          title={group.name}
          motion="bubble"
          origin={origin.current?.getBoundingClientRect()}
          getOrigin={() => origin.current?.getBoundingClientRect()}
          motionArtwork={<AgentAvatar agentId={group.id} name={group.name} />}
          onClose={() => {
            setSelected('');
            resetChoice();
          }}
          closeOnBackdrop
          busy={busy}
          className="mb-panel mb-fit-panel"
        >
          {group.messages.length > 0 && (showMessages || !item) ? (
            <MomentInboxDetails
              key={group.id}
              messages={group.messages}
              request={sendRequest}
              onViewed={inbox.viewed}
              onOpen={
                onOpenMessage
                  ? (message) => {
                      setSelected('');
                      onOpenMessage(message);
                    }
                  : undefined
              }
              onDecisions={item ? () => setShowMessages(false) : undefined}
            />
          ) : (
            item && (
              <div className="mb-detail">
                {group.items.length > 1 && activeView !== 'approval' && (
                  <DragRail
                    label="这位 Agent 的事项"
                    className="mb-task-rail"
                    resetKey={group.id}
                  >
                    <div className="mb-task-strip">
                      {group.items.map((i) => (
                        <button
                          key={i.attention_id}
                          disabled={busy}
                          aria-pressed={item.attention_id === i.attention_id}
                          onClick={() => {
                            setItemId(i.attention_id);
                            resetChoice();
                          }}
                        >
                          {plainText(i.title)}
                        </button>
                      ))}
                    </div>
                  </DragRail>
                )}
                <div className="mb-detail-toolbar">
                  <nav aria-label="事项内容">
                    {group.messages.length > 0 && (
                      <button onClick={() => setShowMessages(true)}>
                        消息
                      </button>
                    )}
                    <button
                      aria-current={activeView === 'item' ? 'page' : undefined}
                      onClick={() => setView('item')}
                    >
                      事项
                    </button>
                    {action && (
                      <button
                        aria-current={
                          activeView === 'approval' ? 'page' : undefined
                        }
                        onClick={() => setView('approval')}
                      >
                        授权
                      </button>
                    )}
                    {item.command && (
                      <button
                        aria-current={
                          activeView === 'result' ? 'page' : undefined
                        }
                        onClick={() => setView('result')}
                      >
                        结果
                      </button>
                    )}
                    {item.command?.result?.execution && (
                      <button
                        aria-current={
                          activeView === 'evidence' ? 'page' : undefined
                        }
                        onClick={() => setView('evidence')}
                      >
                        依据
                      </button>
                    )}
                  </nav>
                  <output className="mb-current-status">
                    {momentLabels[stage]}
                  </output>
                </div>
                <DragRail
                  label="事项正文"
                  className="mb-reader-rail"
                  pageGap={32}
                  resetKey={item.attention_id + activeView}
                >
                  <article
                    key={item.attention_id + activeView}
                    className="mb-reader"
                  >
                    <h3>
                      {activeView === 'approval' && action
                        ? actionText(action)
                        : plainText(item.title)}
                    </h3>
                    {activeView === 'item' && (
                      <>
                        <p>{plainText(item.body)}</p>
                        {['broadcast', 'broadcast_reply'].includes(
                          item.source_ref?.type || '',
                        ) && (
                          <AttentionSource
                            key={item.attention_id}
                            id={item.attention_id}
                          />
                        )}
                        {item.recommendation && (
                          <>
                            <h4>建议</h4>
                            <p>{plainText(item.recommendation)}</p>
                          </>
                        )}
                        {['open', 'failed'].includes(stage) && (
                          <p className="mb-deadline">
                            有效至{' '}
                            {new Date(item.expires_at).toLocaleString('zh-CN')}
                          </p>
                        )}
                      </>
                    )}
                    {activeView === 'approval' && action && (
                      <>
                        <p>
                          {plainText(scope) ||
                            '仅执行所选操作及原事项中明确说明的范围。'}
                        </p>
                        <p className="mb-deadline">
                          有效至{' '}
                          {new Date(item.expires_at).toLocaleString('zh-CN')}
                        </p>
                      </>
                    )}
                    {activeView === 'result' && item.command && (
                      <>
                        {item.command.result?.summary && (
                          <p>{plainText(item.command.result.summary)}</p>
                        )}
                        {stage === 'failed' && (
                          <p>再次确认前，请先核对已有影响。</p>
                        )}
                        {item.command.condition && (
                          <>
                            <h4>附加条件</h4>
                            <p>{plainText(item.command.condition)}</p>
                          </>
                        )}
                        {item.command.authorization_scope && (
                          <>
                            <h4>授权范围</h4>
                            <p>{plainText(item.command.authorization_scope)}</p>
                          </>
                        )}
                      </>
                    )}
                    {activeView === 'evidence' &&
                      item.command?.result?.execution && (
                        <>
                          <p>
                            {plainText(item.command.result.execution.evidence)}
                          </p>
                          <h4>承接宿主</h4>
                          <p>{item.command.result.execution.host_id}</p>
                          <h4>Codex 会话</h4>
                          <p>{item.command.result.execution.session_id}</p>
                        </>
                      )}
                    {stage === 'expired' && (
                      <p>本次授权已过期，需要 Agent 重新提出事项。</p>
                    )}
                  </article>
                </DragRail>
                {activeView === 'approval' &&
                  action &&
                  ['open', 'failed'].includes(stage) && (
                    <label className="mb-condition">
                      附加条件
                      <textarea
                        value={condition}
                        rows={2}
                        maxLength={1000}
                        disabled={busy}
                        placeholder="可选"
                        onChange={(e) =>
                          setConditions((v) => ({
                            ...v,
                            [item.attention_id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                  )}
                {feedback && (
                  <output className="mb-feedback">{feedback}</output>
                )}
                <div className="mb-detail-actions">
                  {['open', 'failed'].includes(stage) && (
                    <>
                      <button
                        className="mb-defer"
                        disabled={busy}
                        onClick={() => void mutate('defer')}
                      >
                        搁置
                      </button>
                      {activeView === 'approval' && action ? (
                        <button
                          className="mb-primary"
                          disabled={busy || Boolean(error)}
                          onClick={() => void mutate('confirm')}
                        >
                          {busy ? '处理中…' : '确认'}
                        </button>
                      ) : (
                        <DragRail
                          label="可选操作"
                          className="mb-action-rail"
                          resetKey={item.attention_id}
                        >
                          <div className="mb-action-strip">
                            {item.actions
                              .filter((a) => a.flag !== 'open_source')
                              .map((a) => (
                                <button
                                  key={a.action_key}
                                  className="mb-secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setChoice(a.action_key);
                                    setFeedback('');
                                    chosenRevision.current = item.item_revision;
                                    attempt.current = undefined;
                                    setView('approval');
                                  }}
                                >
                                  {actionText(a)}
                                </button>
                              ))}
                          </div>
                        </DragRail>
                      )}
                    </>
                  )}
                  {stage === 'pending' && (
                    <>
                      {item.command?.delivery === 'current_chat' &&
                        !sent.includes(item.command.command_id) && (
                          <button
                            disabled={busy}
                            className="mb-primary"
                            onClick={async () => {
                              const command = item.command!;
                              setBusy(true);
                              try {
                                await chat.send(
                                  command.command_id,
                                  command.context_ref?.moment?.executor_id ||
                                    '',
                                );
                                setSent((ids) => [...ids, command.command_id]);
                                setFeedback('');
                              } catch (e) {
                                setFeedback(
                                  e instanceof Error ? e.message : '发送失败。',
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            重试
                          </button>
                        )}
                      <button
                        className="mb-secondary"
                        disabled={busy}
                        onClick={() => void mutate('revoke')}
                      >
                        撤回决定
                      </button>
                    </>
                  )}
                  {['deferred', 'revoked'].includes(stage) && (
                    <button
                      className="mb-secondary"
                      disabled={busy}
                      onClick={() => void mutate('reopen')}
                    >
                      重新考虑
                    </button>
                  )}
                </div>
              </div>
            )
          )}
        </Dialog>
      )}
    </section>
  );
}
