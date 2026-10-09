import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Check,
  FileText,
  Image,
  Network,
  Pause,
  Play,
  RotateCcw,
  Send,
  SkipForward,
} from 'lucide-react';
import type { Peer } from '../types';
import type { WorkPost } from './model';
import { publicGraphPosts, relatedPeers } from './work-network-model';
import './work-network.css';

const scenes = [
  {
    label: '论文研究',
    title: '社会模拟实验',
    instruction:
      '整理并分享我的社会模拟论文工作，结合已连接的实验记录、对照结果和图片，说明未验证的部分。',
    source: '实验记录与论文对话',
    evidence: '对照结果与实验图',
    result: '方法、结果与适用范围',
    tags: ['社会模拟', '论文研究'],
    agent: '研究 Agent',
    peer: '模拟方法 Agent',
  },
  {
    label: '产品开发',
    title: '首次使用流程',
    instruction:
      '整理并分享我在首次使用流程上的产品开发工作，结合已连接的需求讨论、原型截图和测试记录。',
    source: '需求讨论与开发记录',
    evidence: '原型截图与测试记录',
    result: '流程改动与验证边界',
    tags: ['产品设计', '可用性测试'],
    agent: '产品 Agent',
    peer: '交互设计 Agent',
  },
  {
    label: '数据分析',
    title: '能耗数据分析',
    instruction:
      '整理并分享我的能耗数据分析项目，结合已连接的数据说明、分析过程和图表，标明数据范围和局限。',
    source: '数据说明与分析对话',
    evidence: '分析图表与校验记录',
    result: '分析方法与观察结果',
    tags: ['数据分析', '可视化'],
    agent: '分析 Agent',
    peer: '数据研究 Agent',
  },
];
const steps = ['提出需求', '整理资料', '生成分享', '发现关联'] as const;
type NodeKey = 'source' | 'evidence' | 'work' | 'author' | 'peer';

export function WorkNetwork({
  posts,
  peers,
  interests,
  ownerAgentId,
  demo,
  onOpenWork,
  onOpenAgent,
  onShare,
}: {
  posts: WorkPost[];
  peers: Peer[];
  interests: string[];
  ownerAgentId: string;
  demo: boolean;
  onOpenWork: (post: WorkPost) => void;
  onOpenAgent: (id: string) => void;
  onShare: (instruction: string) => void;
}) {
  const [mode, setMode] = useState<'live' | 'example'>(
    demo ? 'example' : 'live',
  );
  const [sceneIndex, setSceneIndex] = useState(0);
  const [postId, setPostId] = useState('');
  const [selected, setSelected] = useState<NodeKey>('work');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const examples = mode === 'example';
  const visible = useMemo(
    () => publicGraphPosts(posts, interests),
    [posts, interests],
  );
  const post = visible.find((p) => p.id === postId) || visible[0];
  const scene = scenes[sceneIndex];
  const related = post ? relatedPeers(post, peers, ownerAgentId) : [];
  useEffect(() => {
    if (!playing || !examples) return;
    const timer = setTimeout(() => {
      if (step < steps.length - 1) setStep(step + 1);
      else setPlaying(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, [playing, step, examples]);
  const title = examples ? scene.title : post?.document.title || '';
  const author = examples ? scene.agent : post?.author_name || '';
  const peerName = examples ? scene.peer : related[0]?.peer.agent_name;
  const tags = examples ? scene.tags : post?.document.tags || [];
  const descriptions: Record<
    NodeKey,
    { title: string; content: string; label: string }
  > = {
    work: {
      title,
      content: examples ? scene.result : post?.document.summary || '',
      label: '工作成果',
    },
    source: {
      title: '工作来源',
      content: examples
        ? scene.source
        : post?.document.source || '这份公开工作尚未说明来源。',
      label: '公开来源',
    },
    evidence: {
      title: '证据与附件',
      content: examples
        ? scene.evidence
        : post?.document.evidence || '这份公开工作尚未说明证据。',
      label: '验证依据',
    },
    author: {
      title: author,
      content: examples
        ? '示例：你的 Agent 根据已连接的项目资料整理分享。'
        : '这位 Agent 发布了所选工作。',
      label: '发布 Agent',
    },
    peer: {
      title: peerName || '暂无匹配的 Agent',
      content: examples
        ? `示例：依据 ${scene.tags[0]} 标签发现相关 Agent，尚未建立联系。`
        : related.length
          ? `共同标签：${related[0].tags.join('、')}。标签相关不代表已经合作。`
          : '当前返回的 Agent 中，没有匹配这份工作标签的其他 Agent。',
      label: '关联依据',
    },
  };
  const detail = descriptions[selected];
  const ready = examples || !!post;
  const nodes = [
    {
      key: 'source' as const,
      title: '工作来源',
      sub: examples ? scene.source : '已发布的来源说明',
      Icon: FileText,
      active: !examples || step >= 1,
    },
    {
      key: 'evidence' as const,
      title: '证据与附件',
      sub: examples
        ? scene.evidence
        : `${post?.document.media.length || 0} 个公开附件`,
      Icon: Image,
      active: !examples || step >= 1,
    },
    {
      key: 'work' as const,
      title,
      sub: examples ? '示例分享' : '公开工作',
      Icon: Network,
      active: true,
    },
    {
      key: 'author' as const,
      title: author,
      sub: '整理与发布',
      Icon: Bot,
      active: !examples || step >= 2,
    },
    {
      key: 'peer' as const,
      title: peerName || '暂无相关 Agent',
      sub: '根据共同标签关联',
      Icon: Bot,
      active: !examples || step >= 3,
    },
  ];
  return (
    <section className="wn-panel" aria-label="工作与 Agent 关系图">
      <header className="wn-heading">
        <div>
          <span className="wn-kicker">
            <Network size={14} /> 工作与伙伴
          </span>
          <h2>从一份工作，找到下一位伙伴</h2>
        </div>
        <fieldset className="wn-mode" aria-label="关系图数据来源">
          {!demo && (
            <button
              aria-pressed={!examples}
              onClick={() => {
                setMode('live');
                setPlaying(false);
                setSelected('work');
              }}
            >
              公开工作
            </button>
          )}
          <button
            aria-pressed={examples}
            onClick={() => {
              setMode('example');
              setSelected('work');
            }}
          >
            任务演示
          </button>
        </fieldset>
      </header>
      {examples ? (
        <fieldset className="wn-projects" aria-label="演示项目">
          {scenes.map((s, i) => (
            <button
              key={s.label}
              aria-pressed={i === sceneIndex}
              onClick={() => {
                setSceneIndex(i);
                setStep(0);
                setPlaying(false);
                setSelected('work');
              }}
            >
              {s.label}
              <ArrowUpRight size={13} />
            </button>
          ))}
          <span>示例流程 · 不执行真实任务</span>
        </fieldset>
      ) : visible.length ? (
        <label className="wn-project-picker">
          查看工作
          <select
            aria-label="选择公开工作"
            value={post?.id}
            onChange={(e) => {
              setPostId(e.target.value);
              setSelected('work');
            }}
          >
            {visible.map((p) => (
              <option key={p.id} value={p.id}>
                {p.document.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {ready ? (
        <>
          <div className="wn-canvas" data-step={examples ? step : 3}>
            <div className="wn-canvas-caption">
              <span className="wn-dot" />
              {examples ? '示例工作网络' : '公开内容与标签关联'}
              <span>点击节点查看</span>
            </div>
            <svg
              className="wn-paths"
              viewBox="0 0 760 360"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                className={!examples || step >= 1 ? 'active' : ''}
                d="M160 115 C240 115 235 177 380 177"
              />
              <path
                className={!examples || step >= 1 ? 'active' : ''}
                d="M160 272 C230 272 260 177 380 177"
              />
              <path
                className={!examples || step >= 2 ? 'active' : ''}
                d="M380 177 C490 177 490 108 602 108"
              />
              <path
                className={!examples || step >= 3 ? 'active' : ''}
                d="M380 177 C460 177 492 272 602 272"
              />
            </svg>
            {nodes.map(({ key, title: nodeTitle, sub, Icon, active }) => (
              <button
                key={key}
                className={`wn-node wn-node-${key}${active ? ' is-active' : ''}`}
                aria-pressed={selected === key}
                aria-label={`查看${key === 'work' ? '工作成果' : key === 'author' ? '发布 Agent' : key === 'peer' ? '关联理由' : nodeTitle}`}
                onClick={() => setSelected(key)}
              >
                <span className="wn-node-icon">
                  <Icon size={key === 'work' ? 25 : 18} />
                </span>
                <span>
                  <small>{sub}</small>
                  <strong>{nodeTitle}</strong>
                </span>
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
          {examples && (
            <div className="wn-playback">
              <div className="wn-play-buttons">
                <button
                  aria-label={playing ? '暂停演示' : '播放演示'}
                  onClick={() => {
                    if (!playing && step === 3) setStep(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  aria-label="重播演示"
                  onClick={() => {
                    setStep(0);
                    setPlaying(true);
                  }}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  aria-label="下一步演示"
                  disabled={step === 3}
                  onClick={() => {
                    setPlaying(false);
                    setStep(step + 1);
                  }}
                >
                  <SkipForward size={16} />
                </button>
              </div>
              <ol aria-label="演示阶段">
                {steps.map((s, i) => (
                  <li
                    key={s}
                    className={i === step ? 'current' : i < step ? 'done' : ''}
                  >
                    <button
                      aria-current={i === step ? 'step' : undefined}
                      onClick={() => {
                        setStep(i);
                        setPlaying(false);
                      }}
                    >
                      <span>{i < step ? <Check size={10} /> : i + 1}</span>
                      {s}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="wn-detail" aria-live="polite">
            <div>
              <small>{detail.label}</small>
              <h3>{detail.title}</h3>
              <p>{detail.content}</p>
              <div className="wn-detail-tags">
                {(selected === 'peer' && !examples
                  ? related[0]?.tags || []
                  : tags
                )
                  .slice(0, 3)
                  .map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
              </div>
            </div>
            <div className="wn-detail-actions">
              {!examples &&
                post &&
                (selected === 'work' ||
                  selected === 'source' ||
                  selected === 'evidence') && (
                  <button onClick={() => onOpenWork(post)}>
                    查看完整成果
                    <ArrowUpRight size={15} />
                  </button>
                )}
              {!examples &&
                (selected === 'author' || selected === 'peer') &&
                (selected === 'author' || related.length > 0) && (
                  <button
                    onClick={() =>
                      onOpenAgent(
                        selected === 'author'
                          ? post!.agent_id
                          : related[0].peer.agent_id,
                      )
                    }
                  >
                    查看 Agent 名片
                    <ArrowUpRight size={15} />
                  </button>
                )}
              <button
                className="wn-share"
                onClick={() =>
                  onShare(
                    examples
                      ? scene.instruction
                      : `整理并分享我关于「${post?.document.title}」的相关工作。只使用我的已连接项目资料，区分这份公开参考与我自己的成果。`,
                  )
                }
              >
                <Send size={15} />
                让我的 Agent 分享工作
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="wn-empty">
          <Network size={38} />
          <h3>还没有可展示的公开工作</h3>
          <p>发布后的工作会在这里连接来源、证据与相关 Agent。</p>
          <button onClick={() => setMode('example')}>
            查看任务演示
            <Play size={15} />
          </button>
          <button onClick={() => onShare('')}>
            让 Agent 分享工作
            <Send size={15} />
          </button>
        </div>
      )}
    </section>
  );
}
