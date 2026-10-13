import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { api, ApiError } from '../api';
import { AgentAvatar } from '../avatar';
import { AttentionSource } from '../activity';
import { Dialog } from './dialog';
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
}: {
  agentId: string;
  onExplore: () => void;
}) {
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
  const [now, setNow] = useState(Date.now());
  const origin = useRef<HTMLElement | null>(null),
    mounted = useRef(true),
    inflight = useRef(false);
  const offset = useRef(0);
  const chosenRevision = useRef(0);
  const attempt = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const all: MomentItem[] = [];
      let cursor = '';
      for (let n = 0; n < pages; n++) {
        const page = await api<MomentPage>(
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
    }
  }, [pages]);
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
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  const groups = groupMoments(items, agentId, now),
    group = groups.find((g) => g.id === selected);
  const item =
    group?.items.find((i) => i.attention_id === itemId) || group?.items[0];
  const stage = item ? momentStage(item, now) : 'open',
    condition = item ? conditions[item.attention_id] || '' : '';
  const action = item?.actions.find((a) => a.action_key === choice);
  const scope = action
    ? item?.context_ref?.moment?.scopes[action.action_key]
    : undefined;
  const waiting = items.filter((i) => momentStage(i, now) === 'open').length;
  const resetChoice = () => {
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
        const signature = JSON.stringify([item.attention_id, body]);
        if (attempt.current?.signature !== signature)
          attempt.current = { signature, key: crypto.randomUUID() };
        await api('console/attention-items/' + item.attention_id + '/respond', {
          ...body,
          idempotency_key: attempt.current.key,
        });
        setFeedback('');
      } else {
        await api('console/moment/' + item.attention_id + '/state', {
          action: kind,
          expected_item_revision: item.item_revision,
        });
        setFeedback(
          kind === 'revoke'
            ? '已撤回，Agent 不会领取这次决定。'
            : kind === 'defer'
              ? '已暂时搁置。'
              : '已重新打开，请核对后再决定。',
        );
      }
      attempt.current = undefined;
      setChoice('');
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
  const positions = [
    [47, 36],
    [21, 69],
    [77, 23],
    [77, 73],
  ];
  return (
    <section className="mb mb-live" aria-label="此刻的 Agent 与事项">
      {error && (
        <div role="alert" className="mb-load-message">
          {error} <button onClick={() => void refresh()}>重新读取</button>
        </div>
      )}
      {!loaded && !error && (
        <output className="mb-load-message">正在读取此刻的事项…</output>
      )}
      {loaded && !items.length && (
        <div className="mb-empty">
          <p>此刻，没有需要你处理的事项。</p>
          <span>Agent 提出建议或带回结果时，会出现在这里。</span>
          <button onClick={onExplore}>去发现看看</button>
        </div>
      )}
      {items.length > 0 && (
        <div
          className={'mb-space' + (groups.length > 4 ? ' mb-many' : '')}
          aria-label="按关注优先级排列的 Agent"
        >
          <div className="mb-atmosphere" aria-hidden="true" />
          {groups.map((g, index) => {
            const pos = positions[index % 4],
              size = Math.round(138 + (g.priority / 130) * 94);
            return (
              <button
                key={g.id}
                className={
                  'mb-node ' +
                  (g.own
                    ? 'mb-self'
                    : ['mb-sage', 'mb-lavender', 'mb-blue'][index % 3])
                }
                style={
                  {
                    '--x': pos[0] + '%',
                    '--y': pos[1] + '%',
                    '--size': size + 'px',
                  } as CSSProperties
                }
                aria-label={
                  g.name + '，' + g.items.length + ' 项事项，查看事项'
                }
                onClick={(e) => {
                  origin.current = e.currentTarget.querySelector('.mb-bubble');
                  setSelected(g.id);
                  setItemId(g.items[0].attention_id);
                  resetChoice();
                }}
              >
                <span className="mb-bubble">
                  <AgentAvatar agentId={g.id} name={g.name} />
                </span>
                <span className="mb-name">{g.name}</span>
                <span className="mb-caption">
                  {g.items.length === 1
                    ? momentLabels[momentStage(g.items[0], now)]
                    : g.items.length + ' 项事项'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <footer className="mb-footer">
        <span>
          {waiting ? waiting + ' 项等你决定' : '决定与执行结果会保存在这里'}
        </span>
        {more && (
          <button onClick={() => setPages((p) => p + 1)}>查看更早的事项</button>
        )}
      </footer>
      {group && item && (
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
          className="mb-panel"
        >
          <div className="mb-sheet-grid">
            <aside className="mb-sheet-aside mb-sage">
              <div className="mb-sheet-art">
                <AgentAvatar agentId={group.id} name={group.name} />
              </div>
              <div className="mb-person-line">
                <span>{group.name}</span>
                <span className="mb-status">{momentLabels[stage]}</span>
              </div>
              <div className="mb-own-choices" aria-label="这位 Agent 的事项">
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
                    {i.title}
                    <span>{momentLabels[momentStage(i, now)]}</span>
                  </button>
                ))}
              </div>
            </aside>
            <div className="mb-sheet-main">
              <div className="mb-content">
                <h3>{item.title}</h3>
                <p className="mb-intro">{item.body}</p>
                {['broadcast', 'broadcast_reply'].includes(
                  item.source_ref?.type || '',
                ) && (
                  <AttentionSource
                    key={item.attention_id}
                    id={item.attention_id}
                  />
                )}
                {item.recommendation && (
                  <div className="mb-suggestion">
                    <span>Agent 的建议</span>
                    <p>{item.recommendation}</p>
                  </div>
                )}
                <p className="mb-deadline">
                  有效至 {new Date(item.expires_at).toLocaleString('zh-CN')}
                </p>
                {(stage === 'open' || stage === 'failed') && (
                  <>
                    {stage === 'failed' && (
                      <output>
                        上次执行未完成。再次确认前，请先核对已有影响。
                      </output>
                    )}
                    <div className="mb-choice-list" aria-label="选择操作">
                      {item.actions
                        .filter((a) => a.flag !== 'open_source')
                        .map((a) => (
                          <button
                            key={a.action_key}
                            disabled={busy}
                            aria-pressed={choice === a.action_key}
                            className="mb-secondary"
                            onClick={() => {
                              setChoice(a.action_key);
                              chosenRevision.current = item.item_revision;
                              attempt.current = undefined;
                            }}
                          >
                            {actionText(a)}
                          </button>
                        ))}
                    </div>
                    {action && (
                      <div className="mb-decision">
                        <p className="mb-scope-line">
                          授权范围：
                          {scope || '仅执行所选操作及原事项中明确说明的范围。'}
                        </p>
                        <label className="mb-condition">
                          补充条件
                          <textarea
                            value={condition}
                            maxLength={1000}
                            disabled={busy}
                            placeholder="例如：只发这条消息，不承诺合作。"
                            onChange={(e) =>
                              setConditions((v) => ({
                                ...v,
                                [item.attention_id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <button
                          className="mb-primary"
                          disabled={busy || Boolean(error)}
                          onClick={() => void mutate('confirm')}
                        >
                          {busy ? '正在保存…' : '确认这次授权'}
                        </button>
                      </div>
                    )}
                    <button
                      className="mb-defer"
                      disabled={busy}
                      onClick={() => void mutate('defer')}
                    >
                      暂时搁置
                    </button>
                  </>
                )}
                {item.command && (
                  <div className="mb-receipt" aria-label="真实执行进展">
                    <ol className="mb-receipt-stages">
                      <li>确认已保存</li>
                      <li>
                        {stage === 'completed'
                          ? 'Agent 已执行'
                          : stage === 'executing'
                            ? 'Agent 正在执行'
                            : 'Agent 尚未确认执行完成'}
                      </li>
                      <li>
                        {hasMomentReceipt(item)
                          ? '已收到执行回执'
                          : '等待执行回执'}
                      </li>
                    </ol>
                    {item.command.result?.summary && (
                      <p>{item.command.result.summary}</p>
                    )}
                    {item.command.condition && (
                      <p>本次附加条件：{item.command.condition}</p>
                    )}
                    {item.command.authorization_scope && (
                      <p>本次授权范围：{item.command.authorization_scope}</p>
                    )}
                    {item.command.result?.execution && (
                      <details className="mb-expand">
                        <summary>查看执行依据</summary>
                        <p>{item.command.result.execution.evidence}</p>
                        <p>承接宿主：{item.command.result.execution.host_id}</p>
                        <p>
                          Codex 会话：{item.command.result.execution.session_id}
                        </p>
                      </details>
                    )}
                    {stage === 'pending' && (
                      <button
                        className="mb-secondary"
                        disabled={busy}
                        onClick={() => void mutate('revoke')}
                      >
                        撤回本次决定
                      </button>
                    )}
                  </div>
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
                {stage === 'expired' && (
                  <p>本次授权已过期。需要 Agent 根据最新上下文重新提出事项。</p>
                )}
                {feedback && (
                  <output className="mb-feedback">{feedback}</output>
                )}
              </div>
              <div className="mb-panel-foot">
                确认只保存授权。实际动作与结果以执行回执为准。
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
