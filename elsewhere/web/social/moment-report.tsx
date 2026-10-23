import { AgentAvatar } from '../avatar';
import { plainText } from '../plain-text';
import { messageLabels, type MomentMessage } from './moment-inbox';
import {
  actionText,
  momentStage,
  momentLabels,
  type MomentAction,
  type MomentItem,
} from './moment-model';

// An extractive brief: attribution and quoted excerpts never imply an agreement
// or an execution result that the source records do not establish.
function excerpt(text: string, limit = 84) {
  const clean = plainText(text).replace(/\s+/g, ' ').trim();
  return clean.length > limit ? clean.slice(0, limit) + '…' : clean;
}

export function MomentReport({
  messages,
  agentId,
  peerId,
  peerName,
  items,
  now,
  more,
  busy,
  feedback,
  onMore,
  onMessage,
  onItem,
  onAction,
  onDefer,
  onReopen,
}: {
  messages: MomentMessage[];
  agentId: string;
  peerId: string;
  peerName: string;
  items: MomentItem[];
  now: number;
  more: boolean;
  busy: boolean;
  feedback: string;
  onMore: () => void;
  onMessage: (message: MomentMessage) => void;
  onItem: (item: MomentItem) => void;
  onAction: (item: MomentItem, action: MomentAction) => void;
  onDefer: (item: MomentItem) => void;
  onReopen: (item: MomentItem) => void;
}) {
  const ordered = [...messages].sort((a, b) => b.received_at - a.received_at);
  const channels = (Object.keys(messageLabels) as MomentMessage['kind'][])
    .map((kind) => {
      const records = ordered.filter((m) => m.kind === kind);
      return {
        kind,
        records,
        outgoing: records.filter((m) => m.direction === 'outgoing').length,
      };
    })
    .filter((channel) => channel.records.length);
  const maxCount = Math.max(
    1,
    ...channels.map((channel) => channel.records.length),
  );
  const pending = items.filter((i) =>
    ['open', 'failed'].includes(momentStage(i, now)),
  );
  const deferred = items.filter((i) => momentStage(i, now) === 'deferred');
  const progress = items.filter(
    (i) => !pending.includes(i) && !deferred.includes(i),
  );
  const focus = pending[0] || progress[0] || deferred[0];
  const latest = ordered[0];
  const topic = ordered.find((m) => m.post_id || m.kind === 'broadcast');
  function decision(i: MomentItem) {
    return (
      <section
        className="mb-brief-decision"
        key={i.attention_id}
        aria-label={plainText(i.title)}
      >
        <h3>{plainText(i.title)}</h3>
        {i.body && <p>{excerpt(i.body, 110)}</p>}
        <div className="mb-brief-actions">
          {i.actions
            .filter((action) => action.flag !== 'open_source')
            .map((action) => (
              <button
                key={action.action_key}
                disabled={busy}
                onClick={() => onAction(i, action)}
              >
                {actionText(action)}
              </button>
            ))}
          <button
            className="mb-brief-quiet"
            disabled={busy}
            onClick={() => onDefer(i)}
          >
            先搁置
          </button>
        </div>
        <button
          className="mb-brief-link"
          disabled={busy}
          onClick={() => onItem(i)}
        >
          查看完整事项
        </button>
      </section>
    );
  }
  return (
    <section className="mb-report" aria-label="交互报告">
      <div className="mb-report-document">
        <div className="mb-report-overview">
          {pending.length ? (
            <section
              className="mb-brief-decisions mb-report-focus"
              aria-label="需要你决定"
            >
              <div className="mb-report-eyebrow">
                <span className="mb-report-status-dot" />
                需要你决定
                {pending.length > 1 && <span> · {pending.length} 项</span>}
              </div>
              {decision(pending[0])}
            </section>
          ) : (
            <section className="mb-report-focus" aria-label="当前进展">
              <div className="mb-report-eyebrow">
                {focus ? momentLabels[momentStage(focus, now)] : '最近往来'}
              </div>
              <h3>
                {focus
                  ? plainText(focus.title)
                  : latest
                    ? plainText(latest.context_title || latest.title)
                    : '暂时没有新的往来'}
              </h3>
              <p>
                {focus
                  ? excerpt(focus.command?.result?.summary || focus.body, 110)
                  : latest
                    ? excerpt(latest.body, 110)
                    : ''}
              </p>
              {focus && (
                <button
                  className="mb-brief-link"
                  disabled={busy}
                  onClick={() => onItem(focus)}
                >
                  查看完整事项
                </button>
              )}
              {!focus && latest && (
                <button
                  className="mb-brief-link"
                  onClick={() => onMessage(latest)}
                >
                  查看原文
                </button>
              )}
              <span className="mb-report-settled">目前没有需要你决定的事</span>
            </section>
          )}
          <section className="mb-report-map" aria-label="往来分布">
            <div className="mb-report-map-heading">
              <h4>往来一览</h4>
              <span>{more ? '已载入' : '当前记录'}</span>
            </div>
            <div className="mb-report-people">
              <div>
                <span className="mb-report-avatar">
                  <AgentAvatar agentId={agentId} />
                  <span className="mb-report-initial" aria-hidden="true">
                    我
                  </span>
                </span>
                <span>我方</span>
              </div>
              <div className="mb-report-connection">
                <strong>{messages.length}</strong>
                <span>条交互</span>
              </div>
              <div>
                <span className="mb-report-avatar">
                  <AgentAvatar agentId={peerId} />
                  <span className="mb-report-initial" aria-hidden="true">
                    {plainText(peerName).slice(0, 1)}
                  </span>
                </span>
                <span title={peerName}>
                  {peerId === agentId ? '我的 Agent' : '对方'}
                </span>
              </div>
            </div>
            <div className="mb-report-chart">
              {channels.map(({ kind, records, outgoing }) => (
                <button
                  key={kind}
                  onClick={() => onMessage(records[0])}
                  aria-label={
                    messageLabels[kind] +
                    '：我方 ' +
                    outgoing +
                    ' 条，对方 ' +
                    (records.length - outgoing) +
                    ' 条，查看最近记录'
                  }
                >
                  <span>{messageLabels[kind]}</span>
                  <span className="mb-report-track" aria-hidden="true">
                    <span
                      className="mb-report-bar-out"
                      style={{ width: (outgoing / maxCount) * 100 + '%' }}
                    />
                    <span
                      className="mb-report-bar-in"
                      style={{
                        width:
                          ((records.length - outgoing) / maxCount) * 100 + '%',
                      }}
                    />
                  </span>
                  <strong>{records.length}</strong>
                </button>
              ))}
            </div>
            {messages.length > 0 ? (
              <div className="mb-report-legend">
                <span>
                  <i className="mb-report-key-out" />
                  我方发出
                </span>
                <span>
                  <i className="mb-report-key-in" />
                  对方传来
                </span>
              </div>
            ) : (
              <p className="mb-brief-muted">尚无交互记录</p>
            )}
          </section>
        </div>
        {topic && (
          <button className="mb-report-topic" onClick={() => onMessage(topic)}>
            <span>相关话题</span>
            <strong>{excerpt(topic.context_title || topic.title, 64)}</strong>
            <span aria-hidden="true">↗</span>
          </button>
        )}
        {pending.length > 1 && (
          <details className="mb-report-other">
            <summary>另外 {pending.length - 1} 项待决定</summary>
            {pending.slice(1).map(decision)}
          </details>
        )}
        {progress.length > 0 && (
          <section className="mb-report-progress" aria-label="其他进展">
            {progress
              .filter((i) => i !== focus)
              .map((i) => (
                <button
                  key={i.attention_id}
                  disabled={busy}
                  onClick={() => onItem(i)}
                >
                  <span>{plainText(i.title)}</span>
                  <span>{momentLabels[momentStage(i, now)]}</span>
                </button>
              ))}
          </section>
        )}
        {deferred.length > 0 && (
          <section className="mb-brief-deferred" aria-label="已搁置">
            <h4>暂时放一放</h4>
            {deferred.map((i) => (
              <div key={i.attention_id}>
                <span>{plainText(i.title)}</span>
                <button disabled={busy} onClick={() => onReopen(i)}>
                  重新考虑
                </button>
              </div>
            ))}
          </section>
        )}
        {feedback && (
          <p role="alert" className="mb-feedback">
            {feedback}
          </p>
        )}
        <details className="mb-brief-sources">
          <summary>查看依据{more ? ' · 已载入记录' : ''}</summary>
          <div>
            {messages.map((m) => (
              <button
                key={m.kind + '/' + m.id}
                aria-label={`查看${messageLabels[m.kind]}：${plainText(m.context_title || m.title)}`}
                onClick={() => onMessage(m)}
              >
                {plainText(m.context_title || m.title)}{' '}
                <time>
                  {new Date(m.received_at).toLocaleDateString('zh-CN')}
                </time>
              </button>
            ))}
          </div>
          {more && <button onClick={onMore}>读取更早的记录</button>}
          {!messages.length && !more && <p>暂无往来原文</p>}
        </details>
      </div>
    </section>
  );
}
