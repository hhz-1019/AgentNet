import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  FileText,
  History,
  Play,
  RefreshCw,
  ShieldCheck,
  Users,
} from '../icons';
import { Dialog } from './dialog';
import { ContentTabs } from './content-motion';
import {
  crossingStories,
  crossingStageLabel,
  type CrossingDecision,
  type CrossingStory,
  type CrossingView,
} from './crossing-data';
import './crossing.css';

const tabs: { view: CrossingView; label: string; index: string }[] = [
  { view: 'now', label: '此刻', index: '01' },
  { view: 'encounters', label: '相遇', index: '02' },
  { view: 'traces', label: '足迹', index: '03' },
];
const emptyDecisions = (): Record<string, CrossingDecision> =>
  Object.fromEntries(
    crossingStories.map((story) => [story.id, { stage: 'open' }]),
  );

function Portrait({
  story,
  large = false,
}: {
  story: CrossingStory;
  large?: boolean;
}) {
  return (
    <span className={`cx-portrait${large ? ' cx-portrait-large' : ''}`}>
      <img src={`/avatars/${story.avatar}.svg`} alt="" />
    </span>
  );
}

/** A deliberately isolated design demo. It never calls a service or sends a message. */
export function Crossing({
  view,
  onView,
  onExplore,
}: {
  view: CrossingView;
  onView: (view: CrossingView) => void;
  onExplore: () => void;
}) {
  const [decisions, setDecisions] = useState(emptyDecisions);
  const [selected, setSelected] = useState(crossingStories[0].id);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [condition, setCondition] = useState('');
  const [dialog, setDialog] = useState<
    'person' | 'message' | 'handoff' | undefined
  >();
  const [copied, setCopied] = useState(false);
  const [traceStep, setTraceStep] = useState(1);
  const [traceOpen, setTraceOpen] = useState('intro');
  const [encounterFilter, setEncounterFilter] = useState('all');
  const story = crossingStories.find((item) => item.id === selected)!;
  const decision = decisions[story.id];
  const remaining = crossingStories.filter(
    (item) => decisions[item.id].stage === 'open',
  );
  const completed = crossingStories.filter(
    (item) => decisions[item.id].stage !== 'open',
  );
  const isPrepared = story.id === 'chen';
  const chooseStory = (id: string) => {
    setSelected(id);
    setEvidenceOpen(false);
    setScopeOpen(false);
    setConditionOpen(false);
    setCondition(decisions[id].condition || '');
    setCopied(false);
  };
  const update = (stage: CrossingDecision['stage']) => {
    setDecisions((items) => ({
      ...items,
      [story.id]: { stage, condition: condition.trim() },
    }));
    setConditionOpen(false);
  };
  const openStory = (id: string) => {
    chooseStory(id);
    onView('now');
  };
  const reset = () => {
    setDecisions(emptyDecisions());
    chooseStory(crossingStories[0].id);
    setCondition('');
    setTraceStep(1);
    onView('now');
  };
  const viewTrace = () => {
    setTraceOpen('intro');
    onView('traces');
  };
  const steps = [
    {
      label: '找到交集',
      time: '14:32',
      title: '相遇之前，先找到共同的问题。',
      text: 'Agent 将你的找人目标与周宁的公开研究需求联系起来，形成了一份可供判断的介绍建议。',
      actor: 'Agent 的判断',
      detail: '依据：双方公开需求。未知：合作意愿与场地资源。',
    },
    {
      label: '等待你',
      time: '14:33',
      title: '这一小步，由你决定。',
      text: 'Agent 准备好介绍内容，将首次联系交给你确认。你的授权只覆盖这一次介绍。',
      actor: '你的决定',
      detail: '允许：发送公开项目简介。未允许：分享原始数据或约定合作。',
    },
    {
      label: '向前一步',
      time: '14:36',
      title: '你的判断，变成一次行动。',
      text: 'Agent 发出已确认的介绍，留下发送记录。等待回复期间，不会把“已发送”显示成“已建立合作”。',
      actor: 'Agent 的回执',
      detail: '介绍已发送，仍在等待对方回应。',
    },
    {
      label: '彼此回应',
      time: '15:08',
      title: '从可能的交集，到真实的回应。',
      text: '周宁表示愿意进一步了解。Agent 把双方背景和还没确认的问题整理好，等待你接手。',
      actor: '对方的回应',
      detail: '愿意了解项目；是否安排进一步交流，由你决定。',
    },
  ];

  return (
    <section className="cx" aria-label="交汇处设计演示">
      <header className="cx-toolbar ew-feed-toolbar">
        <ContentTabs className="sn-tabs cx-tabs" label="交汇处视图">
          {tabs.map((tab) => (
            <button
              key={tab.view}
              onClick={() => onView(tab.view)}
              aria-current={view === tab.view ? 'page' : undefined}
            >
              {tab.label}
              {tab.view === 'now' && remaining.length > 0 && (
                <span className="cx-tab-count">{remaining.length}</span>
              )}
            </button>
          ))}
        </ContentTabs>
        <div className="cx-demo-tools">
          <span className="cx-demo-badge">交汇处 · 概念演示</span>
          <button
            className="sw-secondary cx-icon-button"
            onClick={reset}
            aria-label="重置交汇处演示"
            title="重置演示"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {view === 'now' && (
        <div className="cx-view" key="now">
          <header className="cx-heading sn-page-heading">
            <div>
              <h1>等待你的判断</h1>
              <p>
                {remaining.length
                  ? remaining.length +
                    ' 项需要你参与。Agent 已整理背景和下一步。'
                  : '本轮事项已留下决定记录，可以继续查看进展。'}
              </p>
            </div>
            <button className="sw-secondary" onClick={viewTrace}>
              <History size={17} /> 查看执行记录
            </button>
          </header>
          <div className="cx-goal">
            <div>
              <span className="cx-kicker">当前找人目标</span>
              <p>为社会模拟项目，寻找真实场景与产品体验伙伴。</p>
            </div>
            <button
              className="sw-secondary"
              onClick={() => {
                chooseStory('lin');
                setConditionOpen(true);
              }}
            >
              调整重点 <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="cx-work-layout">
            <aside className="cx-queue" aria-label="需要你判断的事项">
              <div className="cx-queue-heading">
                <h2>
                  需要你 <span>{remaining.length}</span>
                </h2>
                <span>按当前目标排序</span>
              </div>
              {crossingStories.map((item, index) => (
                <button
                  className="cx-queue-item"
                  key={item.id}
                  aria-pressed={selected === item.id}
                  onClick={() => chooseStory(item.id)}
                >
                  <span className="cx-queue-meta">
                    <span>{item.category}</span>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </span>
                  <strong>{item.title}</strong>
                  <span className="cx-queue-person">
                    <Portrait story={item} />
                    <span>
                      {item.person}
                      <small>{item.role}</small>
                    </span>
                  </span>
                  <span className="cx-queue-status">
                    <span className="cx-status-dot" />
                    {crossingStageLabel[decisions[item.id].stage]}
                  </span>
                </button>
              ))}
              <div className="cx-queue-note">
                <ShieldCheck size={17} />
                <p>演示中的选择仅保存在当前页面，不发送消息。</p>
              </div>
            </aside>
            <article
              className={'cx-decision cx-stage-' + decision.stage}
              aria-label="事项详情"
            >
              <div className="cx-decision-meta">
                <span>
                  <span className="cx-status-dot" />
                  {decision.stage === 'open'
                    ? '需要你判断 · ' + story.category
                    : crossingStageLabel[decision.stage]}
                </span>
                <span>
                  {String(crossingStories.indexOf(story) + 1).padStart(2, '0')}{' '}
                  / {String(crossingStories.length).padStart(2, '0')}
                </span>
              </div>
              <div className="cx-decision-heading">
                <h2>{story.question}</h2>
                <p>{story.reason}。</p>
              </div>
              <button
                className="cx-recipient"
                onClick={() => {
                  setDialog('person');
                  setCopied(false);
                }}
              >
                <Portrait story={story} />
                <span>
                  <strong>{story.person}</strong>
                  <small>{story.role}</small>
                </span>
                <span className="cx-recipient-link">
                  查看档案 <ArrowUpRight size={16} />
                </span>
              </button>
              <div className="cx-context-grid">
                <section>
                  <span className="cx-kicker">你的项目需要</span>
                  <h3>社会模拟项目</h3>
                  <p>{story.yours}</p>
                  <small>{story.evidence[0].source}</small>
                </section>
                <section>
                  <span className="cx-kicker">对方公开表达了什么</span>
                  <h3>{story.person}的需求</h3>
                  <p>{story.theirs}</p>
                  <small>{story.evidence[1].source}</small>
                </section>
              </div>
              <div className="cx-match-summary">
                <div>
                  <span className="cx-kicker">Agent 找到的交集</span>
                  <strong>{story.overlap}</strong>
                  <p>{story.description}</p>
                </div>
                <button
                  className="sw-secondary"
                  onClick={() => setEvidenceOpen(!evidenceOpen)}
                  aria-expanded={evidenceOpen}
                >
                  两条匹配依据{' '}
                  <ChevronDown
                    size={16}
                    className={evidenceOpen ? 'cx-rotate' : ''}
                  />
                </button>
              </div>
              {evidenceOpen && (
                <div className="cx-evidence">
                  <div className="cx-evidence-grid">
                    {story.evidence.map((item) => (
                      <article key={item.label}>
                        <span className="cx-kicker">{item.label}</span>
                        <p>“{item.text}”</p>
                        <small>{item.source}</small>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <div className="cx-uncertainty">
                <ShieldCheck size={17} />
                <div>
                  <span className="cx-kicker">需要继续确认</span>
                  <p>{story.uncertainty}</p>
                </div>
              </div>
              {decision.stage === 'open' ? (
                <>
                  <div className="cx-authorization">
                    <div>
                      <h3>本次行动的范围</h3>
                      <p>{story.scope}</p>
                    </div>
                    <button
                      className="sw-secondary"
                      onClick={() => setScopeOpen(!scopeOpen)}
                      aria-expanded={scopeOpen}
                    >
                      <ShieldCheck size={16} />{' '}
                      {scopeOpen ? '收起范围' : '查看本次范围'}
                    </button>
                  </div>
                  <div className="cx-boundary">
                    <span className="cx-kicker">不会自动做</span>
                    <p>{story.boundary}</p>
                  </div>
                  {scopeOpen && (
                    <div className="cx-scope">
                      <div>
                        <Check size={16} />
                        <p>本次只允许：{story.scope}</p>
                      </div>
                      <button
                        className="sw-secondary"
                        onClick={() => setDialog('message')}
                      >
                        预览{isPrepared ? '提纲' : '介绍内容'}{' '}
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  )}
                  {conditionOpen && (
                    <div className="cx-condition">
                      <label htmlFor="cx-condition">补充这次行动的条件</label>
                      <textarea
                        id="cx-condition"
                        value={condition}
                        onChange={(event) => setCondition(event.target.value)}
                        placeholder="例如：先确认真实场景资源，只发送公开项目简介。"
                        rows={3}
                      />
                      <p>条件会随决定保留到执行回执。</p>
                    </div>
                  )}
                  <div className="cx-decision-bottom">
                    <div className="cx-actions">
                      <button
                        className="sw-primary cx-primary"
                        onClick={() => update('pending')}
                      >
                        {condition.trim() ? '带着条件继续' : story.action}
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        className="sw-secondary cx-text-button"
                        onClick={() => setConditionOpen(!conditionOpen)}
                      >
                        {conditionOpen ? '收起条件' : '补充条件'}
                      </button>
                      <button
                        className="sw-secondary cx-text-button"
                        onClick={() => update('observing')}
                      >
                        先观察
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="cx-outcome" aria-live="polite">
                  <div className="cx-outcome-header">
                    <span className="cx-outcome-mark">
                      {decision.stage === 'pending' ? (
                        <History size={21} />
                      ) : (
                        <Check size={21} />
                      )}
                    </span>
                    <div>
                      <span className="cx-kicker">这次决定的进展</span>
                      <h3>
                        {decision.stage === 'pending'
                          ? '等待宿主 Agent 领取'
                          : decision.stage === 'sent'
                            ? isPrepared
                              ? '交流提纲已准备好'
                              : '介绍已发出，等待回应'
                            : decision.stage === 'replied'
                              ? isPrepared
                                ? '交流背景已准备好'
                                : story.person + '愿意进一步了解'
                              : '先保留这次相遇'}
                      </h3>
                    </div>
                  </div>
                  <p>
                    {decision.stage === 'pending'
                      ? story.scope
                      : decision.stage === 'replied'
                        ? story.reply
                        : decision.stage === 'observing'
                          ? '本次不会联系对方，你可以稍后重新考虑。'
                          : isPrepared
                            ? story.message
                            : '已留下发送记录，对方尚未回应。'}
                  </p>
                  {decision.stage !== 'observing' && (
                    <ol className="cx-execution-steps" aria-label="行动进展">
                      {[
                        '已决定',
                        isPrepared ? '已整理' : '已发送',
                        isPrepared ? '可交接' : '已回应',
                      ].map((label, i) => (
                        <li
                          key={label}
                          data-reached={
                            i <=
                            (decision.stage === 'pending'
                              ? 0
                              : decision.stage === 'sent'
                                ? 1
                                : 2)
                          }
                        >
                          <span>{i + 1}</span>
                          {label}
                        </li>
                      ))}
                    </ol>
                  )}
                  {decision.condition && (
                    <p className="cx-saved-condition">
                      <strong>你的条件</strong>
                      {decision.condition}
                    </p>
                  )}
                  <div className="cx-actions">
                    {decision.stage === 'pending' && (
                      <button
                        className="sw-primary cx-primary"
                        onClick={() => update('sent')}
                      >
                        <Play size={15} />
                        演示：Agent {isPrepared ? '完成整理' : '发出介绍'}
                      </button>
                    )}
                    {decision.stage === 'sent' && (
                      <button
                        className="sw-primary cx-primary"
                        onClick={() => update('replied')}
                      >
                        <Play size={15} />
                        演示：{isPrepared ? '准备交接' : '收到回应'}
                      </button>
                    )}
                    {decision.stage === 'replied' && (
                      <button
                        className="sw-primary cx-primary"
                        onClick={() => {
                          setCopied(false);
                          setDialog('handoff');
                        }}
                      >
                        查看交接简报 <ArrowUpRight size={17} />
                      </button>
                    )}
                    {decision.stage === 'observing' && (
                      <button
                        className="sw-primary cx-primary"
                        onClick={() => update('open')}
                      >
                        重新考虑
                      </button>
                    )}
                    <button
                      className="sw-secondary cx-text-button"
                      onClick={viewTrace}
                    >
                      查看足迹 <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </article>
          </div>
          <section className="cx-while-away">
            <div className="cx-section-heading">
              <h2>Agent 已整理的记录</h2>
              <button
                className="sw-secondary cx-text-button"
                onClick={viewTrace}
              >
                展开足迹 <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="cx-activity-row">
              <time>14:32</time>
              <span className="cx-activity-dot" />
              <p>从周宁的公开需求中找到交集，形成首次联系建议。</p>
              <span className="cx-activity-tag">等待判断</span>
            </div>
            <div className="cx-activity-row">
              <time>13:10</time>
              <span className="cx-activity-dot" />
              <p>搁置了一位候选：方向相近，但没有明确的合作需求。</p>
              <span className="cx-activity-tag">已筛选</span>
            </div>
            {completed.map((item) => (
              <div className="cx-activity-row" key={item.id}>
                <time>刚刚</time>
                <span className="cx-activity-dot" />
                <p>与{item.person}相关的事项，已有你的决定记录。</p>
                <span className="cx-activity-tag">
                  {crossingStageLabel[decisions[item.id].stage]}
                </span>
              </div>
            ))}
          </section>
        </div>
      )}

      {view === 'encounters' && (
        <div className="cx-view" key="encounters">
          <div className="cx-heading">
            <div>
              <p className="cx-eyebrow">已整理的潜在伙伴</p>
              <h1>与你的工作有关的人</h1>
            </div>
            <p className="cx-heading-note">
              查看双方需求、匹配依据与当前进展。
            </p>
          </div>
          <div className="cx-encounter-filters" aria-label="相遇状态">
            {[
              ['all', '全部相遇'],
              ['open', '等待判断'],
              ['progress', '正在继续'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={encounterFilter === id}
                onClick={() => setEncounterFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="cx-encounter-list">
            {crossingStories
              .filter(
                (item) =>
                  encounterFilter === 'all' ||
                  (encounterFilter === 'open'
                    ? decisions[item.id].stage === 'open'
                    : decisions[item.id].stage !== 'open'),
              )
              .map((item, index) => (
                <article className="cx-encounter" key={item.id}>
                  <div className="cx-encounter-identity">
                    <span className="cx-kicker">
                      相遇 {String(index + 1).padStart(2, '0')}
                    </span>
                    <Portrait story={item} large />
                    <h2>{item.person}</h2>
                    <p>{item.role}</p>
                  </div>
                  <div className="cx-encounter-body">
                    <span className="cx-encounter-status">
                      <span className="cx-status-dot" />
                      {crossingStageLabel[decisions[item.id].stage]}
                    </span>
                    <h3>{item.overlap}</h3>
                    <p>{item.description}</p>
                    <dl>
                      <div>
                        <dt>你在寻找</dt>
                        <dd>{item.yours}</dd>
                      </div>
                      <div>
                        <dt>对方期待</dt>
                        <dd>{item.theirs}</dd>
                      </div>
                    </dl>
                    <div className="cx-actions">
                      <button
                        className="sw-primary cx-primary"
                        onClick={() => openStory(item.id)}
                      >
                        查看事项与进展 <ArrowUpRight size={17} />
                      </button>
                      <span className="cx-private-note">
                        人物与需求均为演示资料
                      </span>
                    </div>
                  </div>
                </article>
              ))}
          </div>
          {encounterFilter === 'progress' && completed.length === 0 && (
            <div className="cx-rest">
              <Users size={32} />
              <h2>相遇，等待你迈出第一步。</h2>
              <p>做出一次决定后，它的进展就会留在这里。</p>
              <button
                className="sw-primary cx-primary"
                onClick={() => onView('now')}
              >
                回到此刻 <ArrowRight size={17} />
              </button>
            </div>
          )}
          <button className="cx-discover-link" onClick={onExplore}>
            前往发现页 <ArrowUpRight size={19} />
          </button>
        </div>
      )}

      {view === 'traces' && (
        <div className="cx-view" key="traces">
          <div className="cx-heading">
            <div>
              <p className="cx-eyebrow">决策与行动记录</p>
              <h1>这次行动如何发生</h1>
            </div>
            <p className="cx-heading-note">
              回看匹配、授权、执行和回应的依据。
            </p>
          </div>
          <div className="cx-section-heading">
            <h2>一次相遇的来路</h2>
            <span className="cx-demo-badge">独立故事回放</span>
          </div>
          <article className="cx-replay">
            <div className="cx-replay-header">
              <div className="cx-replay-people">
                <span className="cx-mini-self">你</span>
                <span>↔</span>
                <Portrait story={crossingStories[0]} />
                <span>周宁</span>
              </div>
              <span className="cx-kicker">养老场景 × 社会模拟</span>
            </div>
            <div className="cx-timeline">
              {steps.map((step, index) => (
                <button
                  className={index <= traceStep ? 'cx-step-reached' : ''}
                  aria-current={index === traceStep ? 'step' : undefined}
                  key={step.label}
                  onClick={() => setTraceStep(index)}
                >
                  <span className="cx-step-dot">
                    {index < traceStep ? <Check size={12} /> : index + 1}
                  </span>
                  <span>{step.label}</span>
                  <time>{step.time}</time>
                </button>
              ))}
            </div>
            <div className="cx-replay-scene" key={traceStep}>
              <span className="cx-kicker">{steps[traceStep].actor}</span>
              <h2>{steps[traceStep].title}</h2>
              <p>{steps[traceStep].text}</p>
              <div className="cx-replay-detail">
                <FileText size={18} />
                <span>{steps[traceStep].detail}</span>
              </div>
              {traceStep === 3 && (
                <blockquote>
                  <span>周宁的回复</span>
                  “很愿意了解！可以先看看项目简介，再讨论有没有适合的验证场景。”
                </blockquote>
              )}
            </div>
            <div className="cx-replay-controls">
              <button
                className="sw-secondary cx-text-button"
                onClick={() => setTraceStep(Math.max(0, traceStep - 1))}
                disabled={traceStep === 0}
              >
                <ArrowLeft size={16} />
                上一步
              </button>
              <span>演示回放 · {traceStep + 1} / 4</span>
              <button
                className="sw-primary cx-primary"
                onClick={() =>
                  setTraceStep(traceStep === 3 ? 0 : traceStep + 1)
                }
              >
                {traceStep === 3 ? <RefreshCw size={15} /> : <Play size={15} />}
                {traceStep === 3 ? '重新回看' : '下一幕'}
              </button>
            </div>
          </article>
          <div className="cx-section-heading cx-log-heading">
            <h2>留下的足迹</h2>
            <span className="cx-kicker">演示记录</span>
          </div>
          {[
            {
              id: 'intro',
              time: '14:32',
              title: '一份首次联系建议，交到你面前',
              detail:
                'Agent 从双方需求中找到交集，保留两条来源，并明确尚未确认合作意愿与场地资源。',
            },
            {
              id: 'filter',
              time: '13:10',
              title: '一次没有打扰你的筛选',
              detail:
                '候选资料与社会模拟方向相近，但没有明确寻求合作的证据。因此没有生成联系请求。',
            },
            {
              id: 'context',
              time: '09:40',
              title: '从你真正关心的问题开始',
              detail:
                '这轮探索围绕“社会模拟的现实验证伙伴”展开。普通筛选由 Agent 完成，首次联系留给你决定。',
            },
          ].map((event) => (
            <div className="cx-trace-item" key={event.id}>
              <button
                aria-expanded={traceOpen === event.id}
                onClick={() =>
                  setTraceOpen(traceOpen === event.id ? '' : event.id)
                }
              >
                <time>{event.time}</time>
                <h3>{event.title}</h3>
                <ChevronDown
                  size={18}
                  className={traceOpen === event.id ? 'cx-rotate' : ''}
                />
              </button>
              {traceOpen === event.id && <p>{event.detail}</p>}
            </div>
          ))}
        </div>
      )}

      <footer className="cx-footer">
        <span>交汇处</span>
        <small>人物、资料与回执均为演示 · 不发送消息</small>
      </footer>

      {dialog && (
        <Dialog
          title={
            dialog === 'person'
              ? '相遇档案'
              : dialog === 'message'
                ? isPrepared
                  ? '交流提纲预览'
                  : '首次介绍预览'
                : '交流交接简报'
          }
          onClose={() => setDialog(undefined)}
          className="cx-dialog"
        >
          <div className="cx cx-modal">
            {dialog === 'person' ? (
              <>
                <div className="cx-modal-person">
                  <Portrait story={story} large />
                  <div>
                    <span className="cx-kicker">演示人物</span>
                    <h2>{story.person}</h2>
                    <p>{story.role}</p>
                  </div>
                </div>
                <p className="cx-modal-lead">{story.description}</p>
                <div className="cx-modal-section">
                  <h3>为什么把这个人带到你面前</h3>
                  <p>{story.theirs}</p>
                </div>
                <div className="cx-modal-section">
                  <h3>仍需要了解</h3>
                  <p>{story.uncertainty}</p>
                </div>
                <button
                  className="sw-primary cx-primary"
                  onClick={() => {
                    setDialog(undefined);
                    setEvidenceOpen(true);
                  }}
                >
                  查看这次相遇的依据 <ArrowRight size={17} />
                </button>
              </>
            ) : dialog === 'message' ? (
              <>
                <p className="cx-kicker">仅预览 · 未发送</p>
                <div className="cx-letter">
                  <span>给 {story.person}</span>
                  <p>{story.message}</p>
                  <small>由你的 Agent 代为整理</small>
                </div>
                <p className="cx-modal-note">
                  <ShieldCheck size={17} />
                  {story.boundary}
                </p>
                <button
                  className="sw-primary cx-primary"
                  onClick={() => setDialog(undefined)}
                >
                  返回决定
                </button>
              </>
            ) : (
              <>
                <span className="cx-kicker">已整理的交流背景</span>
                <h2>与{story.person}继续交流</h2>
                <div className="cx-letter">
                  <span>这次相遇的简报</span>
                  <p>
                    {story.overlap}。{story.description}
                  </p>
                  <p>{story.reply}</p>
                  <p>下一步需要确认：{story.uncertainty}</p>
                </div>
                <div className="cx-actions">
                  <button
                    className="sw-primary cx-primary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `【elsewhere 演示相遇简报】\n${story.person} · ${story.role}\n${story.overlap}\n${story.reply}\n待确认：${story.uncertainty}`,
                        );
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? '简报已复制' : '复制交流简报'}
                  </button>
                  <button
                    className="sw-secondary cx-text-button"
                    onClick={() => {
                      setDialog(undefined);
                      viewTrace();
                    }}
                  >
                    回看足迹
                  </button>
                </div>
                <p className="cx-modal-note">
                  这是演示简报。复制后可粘贴到宿主对话，尚未发送给任何人。
                </p>
              </>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
