import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ArrowUpRight, Check, RefreshCw } from '../icons';
import { Dialog } from './dialog';
import {
  crossingStories,
  type CrossingStage,
  type CrossingView,
} from './crossing-data';
import './crossing.css';

type Decision = { stage: CrossingStage; condition: string };
const ownItems = [
  {
    id: 'own-profile',
    label: '更新兴趣画像',
    title: '把关系演化加入近期兴趣？',
    body: '近期找人和交流都围绕关系如何形成，Agent 建议把这个方向写得更具体。',
    recommendation: '只补充这一项兴趣，保留其他已经确认的资料。',
    current: '社会模拟、Agent 协作。',
    proposed: '社会模拟、关系演化、Agent 协作。',
    scope: '仅修改兴趣字段，不修改其他画像或记忆，也不扩大资料的可见范围。',
    action: '确认这项修改',
  },
  {
    id: 'own-goal',
    label: '调整找人目标',
    title: '下一轮，先找有真实场景的伙伴？',
    body: '先把研究方向的匹配，收敛到愿意讨论实际验证场景的人。',
    recommendation: '优先了解场景和参与意愿，再讨论合作方式。',
    current: '寻找社会模拟的真实场景与产品体验伙伴。',
    proposed: '优先寻找有真实场景、愿意开展小规模交流的研究者。',
    scope: '仅更新近期找人目标，不修改长期画像，也不替你承诺合作。',
    action: '采用这个目标',
  },
  {
    id: 'own-post',
    label: '确认公开分享',
    title: '把这个研究问题分享出去？',
    body: 'Agent 整理了一段关于关系演化的讨论，希望获得其他研究者的反馈。',
    recommendation: '作为研究问题公开分享，明确这是一项设想。',
    current: '这份内容尚未发布。',
    proposed:
      '关系如何从重复互动中形成？\n\n除了互动次数，我想进一步讨论互惠行为和关系稳定性。这是一项研究设想，尚无实验结果。欢迎交流如何设计一个小规模验证。',
    scope: '仅发布这一版公开内容，不包含私人记忆、联系方式或未公开项目资料。',
    action: '允许发布这一版',
  },
];
const emptyDecisions = (): Record<string, Decision> =>
  Object.fromEntries(
    [...crossingStories, ...ownItems].map((item) => [
      item.id,
      { stage: 'open', condition: '' },
    ]),
  );
const statusText: Record<CrossingStage, string> = {
  open: '等你决定',
  pending: '已决定，等待执行',
  sent: '已执行',
  replied: '有新回应',
  observing: '暂时搁置',
};
function OwnGlyph() {
  return (
    <svg
      viewBox="0 0 180 180"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="90"
        cy="90"
        rx="51"
        ry="26"
        stroke="currentColor"
        strokeWidth="5"
        transform="rotate(-35 90 90)"
      />
      <ellipse
        cx="90"
        cy="90"
        rx="51"
        ry="26"
        stroke="currentColor"
        strokeWidth="5"
        transform="rotate(35 90 90)"
      />
      <circle cx="90" cy="90" r="9" fill="currentColor" />
    </svg>
  );
}
function followPointer(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== 'mouse') return;
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    '--lean-x',
    ((event.clientX - rect.x) / rect.width - 0.5) * 10 + 'px',
  );
  event.currentTarget.style.setProperty(
    '--lean-y',
    ((event.clientY - rect.y) / rect.height - 0.5) * 8 + 'px',
  );
}
function resetPointer(event: PointerEvent<HTMLButtonElement>) {
  event.currentTarget.style.setProperty('--lean-x', '0px');
  event.currentTarget.style.setProperty('--lean-y', '0px');
}
const positions = [
  { x: 45, y: 37, size: 242, tone: 'sage', hint: '建议真人交流' },
  { x: 20, y: 68, size: 152, tone: 'lavender', hint: '确认探索方向' },
  { x: 78, y: 24, size: 128, tone: 'blue', hint: '收到研究说明' },
];

/** Local design prototype: choices and receipts never contact a service. */
export function Crossing(_props: {
  view: CrossingView;
  onView: (view: CrossingView) => void;
  onExplore: () => void;
}) {
  const [storedDecisions, setDecisions] = useState(emptyDecisions);
  // New prototype scenarios may arrive during Vite Fast Refresh.
  const decisions = { ...emptyDecisions(), ...storedDecisions };
  const [selected, setSelected] = useState<string>();
  const [ownSelected, setOwnSelected] = useState(ownItems[0].id);
  const [origin, setOrigin] = useState<DOMRect>();
  const originElement = useRef<HTMLElement | null>(null);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const story = crossingStories.find((item) => item.id === selected);
  const own = ownItems.find((item) => item.id === ownSelected)!;
  const id = selected === 'self' ? ownSelected : selected;
  const decision = id ? decisions[id] : undefined;
  const ownWaiting = ownItems.filter(
    (item) => decisions[item.id].stage === 'open',
  ).length;
  const waiting = Object.values(decisions).filter(
    (item) => item.stage === 'open',
  ).length;
  const open = (agent: string, element: HTMLButtonElement) => {
    originElement.current = element.querySelector<HTMLElement>('.mb-bubble');
    setSelected(agent);
    setOrigin(originElement.current?.getBoundingClientRect());
    setConditionOpen(false);
    setFeedback('');
  };
  const update = (stage: CrossingStage) => {
    if (!id) return;
    setDecisions((items) => ({
      ...items,
      [id]: { ...emptyDecisions()[id], ...items[id], stage },
    }));
    setFeedback(stage === 'pending' ? '已保存演示选择，尚未执行。' : '');
  };
  const caption = selected === 'self' ? '你的 Agent' : story?.person || '';
  const stage = decision?.stage || 'open';
  return (
    <section className="mb" aria-label="此刻的 Agent 与事项">
      <div className="mb-space" aria-label="按关注优先级排列的 Agent">
        <div className="mb-atmosphere" aria-hidden="true" />
        {crossingStories.map((item, index) => {
          const position = positions[index],
            state = decisions[item.id].stage;
          const active = ['open', 'pending', 'replied'].includes(state);
          return (
            <button
              key={item.id}
              className={[
                'mb-node',
                'mb-' + position.tone,
                active ? '' : 'mb-resting',
              ].join(' ')}
              style={
                {
                  '--x': position.x + '%',
                  '--y': position.y + '%',
                  '--size': position.size + 'px',
                } as CSSProperties
              }
              aria-label={
                item.person +
                '的 Agent，' +
                (state === 'open' ? position.hint : statusText[state]) +
                '，查看事项'
              }
              onPointerMove={followPointer}
              onPointerLeave={resetPointer}
              onClick={(event) => open(item.id, event.currentTarget)}
            >
              <span className="mb-bubble">
                <span className="mb-avatar">
                  <img src={'/avatars/' + item.avatar + '.svg'} alt="" />
                </span>
                {state === 'replied' && (
                  <span className="mb-new-dot" aria-hidden="true" />
                )}
              </span>
              <span className="mb-name">{item.person}</span>
              <span className="mb-caption">
                <i className={'mb-mark mb-mark-' + state} aria-hidden="true" />
                {state === 'open' ? position.hint : statusText[state]}
              </span>
            </button>
          );
        })}
        <button
          className={'mb-node mb-self' + (ownWaiting ? '' : ' mb-resting')}
          style={
            { '--x': '67%', '--y': '72%', '--size': '172px' } as CSSProperties
          }
          aria-label={'你的 Agent，' + ownWaiting + '项待确认，查看事项'}
          onPointerMove={followPointer}
          onPointerLeave={resetPointer}
          onClick={(event) => open('self', event.currentTarget)}
        >
          <span className="mb-bubble">
            <span className="mb-avatar mb-own-avatar">
              <OwnGlyph />
            </span>
          </span>
          <span className="mb-name">你的 Agent</span>
          <span className="mb-caption">
            <i
              className={'mb-mark mb-mark-' + (ownWaiting ? 'open' : 'sent')}
              aria-hidden="true"
            />
            {ownWaiting ? ownWaiting + ' 项待确认' : '查看执行进展'}
          </span>
        </button>
      </div>
      <footer className="mb-footer">
        <span>
          {waiting ? waiting + ' 项等你回应' : '暂时没有待决定事项'}
          <span className="mb-footer-divider">·</span>本地演示
        </span>
        <button
          aria-label="重置此刻演示"
          title="重置演示"
          onClick={() => {
            setDecisions(emptyDecisions());
            setSelected(undefined);
          }}
        >
          <RefreshCw size={15} />
        </button>
      </footer>
      {selected && decision && (
        <Dialog
          title={caption}
          origin={origin}
          motion="bubble"
          motionArtwork={
            story ? (
              <img src={'/avatars/' + story.avatar + '.svg'} alt="" />
            ) : (
              <OwnGlyph />
            )
          }
          getOrigin={() => originElement.current?.getBoundingClientRect()}
          onClose={() => setSelected(undefined)}
          closeOnBackdrop
          className="mb-panel"
        >
          <div className="mb-sheet-grid">
            <aside
              className={
                'mb-sheet-aside mb-' +
                (story
                  ? positions[crossingStories.indexOf(story)].tone
                  : 'self')
              }
            >
              <div className="mb-sheet-art" aria-hidden="true">
                {story ? (
                  <img src={'/avatars/' + story.avatar + '.svg'} alt="" />
                ) : (
                  <OwnGlyph />
                )}
              </div>
              <div className="mb-person-line">
                <div>
                  <span>
                    {story ? story.person + '的 Agent' : '代表你的 Agent'}
                  </span>
                  <small>{story?.role || '目标与公开分享'}</small>
                </div>
                <span className="mb-status">{statusText[stage]}</span>
              </div>
              {selected === 'self' && (
                <div className="mb-own-choices" aria-label="你的 Agent 的事项">
                  {ownItems.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={ownSelected === item.id}
                      onClick={() => {
                        setOwnSelected(item.id);
                        setConditionOpen(false);
                        setFeedback('');
                      }}
                    >
                      {item.label}
                      <span>
                        {decisions[item.id].stage === 'open'
                          ? '待确认'
                          : statusText[decisions[item.id].stage]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {story && (
                <p className="mb-sheet-context">
                  {story.description}
                  <small>{story.overlap}</small>
                </p>
              )}
            </aside>
            <div className="mb-sheet-main">
              <div className="mb-content">
                <span className="mb-overline">
                  {story?.category || own.label}
                </span>
                <h3>{story?.question || own.title}</h3>
                <p className="mb-intro">{story?.reason || own.body}</p>
                <div className="mb-suggestion">
                  <span>Agent 建议</span>
                  <p>
                    {story
                      ? story.id === 'zhou'
                        ? '先交换公开简介，确认双方意愿，再决定是否直接交流。'
                        : story.id === 'chen'
                          ? '先整理值得追问的问题，再由你决定是否继续交流。'
                          : '先了解对方的兴趣和参与条件，再决定是否调整合作重点。'
                      : own.recommendation}
                  </p>
                </div>
                {story ? (
                  <details className="mb-expand">
                    <summary>
                      为什么推荐这个人
                      <ArrowUpRight size={14} />
                    </summary>
                    <div className="mb-evidence">
                      {story.evidence.map((e) => (
                        <div key={e.label}>
                          <small>{e.label}</small>
                          <p>{e.text}</p>
                          <small>{e.source}</small>
                        </div>
                      ))}
                      <p className="mb-uncertain">
                        尚未确认：{story.uncertainty}
                      </p>
                    </div>
                  </details>
                ) : (
                  <div className="mb-comparison">
                    <div>
                      <small>
                        {own.id === 'own-goal'
                          ? '当前目标'
                          : own.id === 'own-profile'
                            ? '当前兴趣'
                            : '当前状态'}
                      </small>
                      <p>{own.current}</p>
                    </div>
                    <div>
                      <small>
                        {own.id !== 'own-post'
                          ? '建议调整为'
                          : '准备发布的内容'}
                      </small>
                      <p>{own.proposed}</p>
                    </div>
                  </div>
                )}
                <details className="mb-expand">
                  <summary>
                    {story?.id === 'chen'
                      ? '查看拟整理的提纲'
                      : story
                        ? '查看介绍内容与授权范围'
                        : '查看本次授权范围'}
                    <ArrowUpRight size={14} />
                  </summary>
                  <div className="mb-evidence">
                    {story && <p className="mb-quote">{story.message}</p>}
                    <p>{story?.scope || own.scope}</p>
                    {story && <small>{story.boundary}</small>}
                  </div>
                </details>
                {stage === 'open' ? (
                  <div className="mb-decision">
                    <p className="mb-scope-line">{story?.scope || own.scope}</p>
                    {conditionOpen && (
                      <label className="mb-condition">
                        补充这次行动的条件
                        <textarea
                          value={decision.condition}
                          onChange={(event) =>
                            setDecisions((items) => ({
                              ...items,
                              [id!]: {
                                ...emptyDecisions()[id!],
                                ...items[id!],
                                condition: event.target.value,
                              },
                            }))
                          }
                          placeholder="写下你希望 Agent 遵守的条件"
                          rows={3}
                          maxLength={1000}
                        />
                      </label>
                    )}
                    <div className="mb-action-row">
                      <button
                        className="mb-primary"
                        onClick={() => update('pending')}
                      >
                        {story?.action || own.action}
                        <ArrowUpRight size={16} />
                      </button>
                      <button
                        className="mb-secondary"
                        onClick={() => setConditionOpen(!conditionOpen)}
                      >
                        {conditionOpen ? '收起条件' : '补充条件'}
                      </button>
                    </div>
                    <button
                      className="mb-defer"
                      onClick={() => update('observing')}
                    >
                      先放一放
                    </button>
                  </div>
                ) : (
                  <div className="mb-receipt">
                    <div className="mb-progress" aria-label="执行进展">
                      {[
                        '已决定',
                        '已执行',
                        story?.id === 'chen' || !story
                          ? '结果可查看'
                          : '对方回应',
                      ].map((label, index) => (
                        <span
                          key={label}
                          className={
                            index <=
                            (stage === 'pending'
                              ? 0
                              : stage === 'sent'
                                ? 1
                                : stage === 'replied'
                                  ? 2
                                  : -1)
                              ? 'reached'
                              : ''
                          }
                        >
                          <Check size={12} />
                          {label}
                        </span>
                      ))}
                    </div>
                    <h4>
                      {stage === 'pending'
                        ? '选择已保存，等待 Agent 执行'
                        : stage === 'sent'
                          ? story?.id === 'chen'
                            ? '提纲已整理'
                            : story
                              ? '介绍已发送，等待对方回应'
                              : own.id === 'own-goal'
                                ? '演示目标已更新'
                                : own.id === 'own-profile'
                                  ? '演示兴趣已更新'
                                  : '演示帖子已发布'
                          : stage === 'replied'
                            ? '有了新的进展'
                            : '这件事先放一放'}
                    </h4>
                    <p>
                      {stage === 'pending'
                        ? '真实接入后，这里会显示宿主领取任务和执行的回执。'
                        : stage === 'replied' ||
                            (stage === 'sent' && story?.id === 'chen')
                          ? story?.reply
                          : stage === 'observing'
                            ? '不会执行这次行动。你可以稍后重新考虑。'
                            : '这是本地演示回执，没有调用真实服务。'}
                    </p>
                    {decision.condition && (
                      <p className="mb-preserved">
                        你的条件：{decision.condition}
                      </p>
                    )}
                    {stage === 'pending' && (
                      <button
                        className="mb-secondary"
                        onClick={() => update('sent')}
                      >
                        演示：Agent 执行
                      </button>
                    )}
                    {stage === 'sent' && story && story.id !== 'chen' && (
                      <button
                        className="mb-secondary"
                        onClick={() => update('replied')}
                      >
                        演示：收到对方回应
                      </button>
                    )}
                    {stage === 'observing' && (
                      <button
                        className="mb-secondary"
                        onClick={() => update('open')}
                      >
                        重新考虑
                      </button>
                    )}
                  </div>
                )}
                {feedback && (
                  <output className="mb-feedback">{feedback}</output>
                )}
              </div>
              <div className="mb-panel-foot">
                演示资料与回执 · 不发送消息、不修改真实资料
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
