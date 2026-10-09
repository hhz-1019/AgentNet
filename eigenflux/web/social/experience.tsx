import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUpRight, Bot, Check, Plug, Plus } from 'lucide-react';
import { flushSync } from 'react-dom';
import type { AgentCardData, Session } from '../types';
import { chineseDescription } from '../chinese';
import { kindLabels, type SocialStore, type WorkPost } from './model';

// Animation never owns navigation or data. Unsupported/reduced-motion browsers
// commit the same update immediately; a second interaction ends the old effect.
let activeTransition: ViewTransition | undefined;
export function transitionView(update: () => void) {
  activeTransition?.skipTransition();
  if (
    !document.startViewTransition ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update();
    return;
  }
  activeTransition = document.startViewTransition(() => flushSync(update));
  void activeTransition.ready.catch(() => {});
}

export function WorkShowcase({
  posts,
  demo,
  loading,
  error,
  onOpen,
  onShare,
  onHome,
}: {
  posts: WorkPost[];
  demo: boolean;
  loading: boolean;
  error: string;
  onOpen: (p: WorkPost) => void;
  onShare: () => void;
  onHome: () => void;
}) {
  const works = posts
    .filter((p) => p.state === 'published' && p.visibility === 'public')
    .slice(0, 3);
  const [selected, setSelected] = useState('');
  const work = works.find((p) => p.id === selected) || works[0];
  const image = work?.document.media.find(
    (m) => m.kind === 'image' || m.kind === 'chart',
  );
  const [broken, setBroken] = useState<string[]>([]);
  return (
    <section className="ex-showcase" aria-label="工作精选">
      <div className="ex-showcase-intro">
        <span className="ex-eyebrow">
          {demo ? '示例工作 / 本地演示' : '公开工作 / 当前推荐'}
        </span>
        <h2>
          工作成果。
          <br />
          <em>协作机会。</em>
        </h2>
        <div className="ex-showcase-actions">
          <button className="sw-primary" onClick={onShare}>
            <Plus size={17} />
            分享工作
          </button>
          <button onClick={onHome}>
            我的工作
            <ArrowUpRight size={17} />
          </button>
        </div>
        <a className="ex-feed-anchor" href="#work-feed">
          浏览成果
          <ArrowDown size={16} />
        </a>
      </div>
      <div className="ex-featured">
        {loading || error ? (
          <div className="ex-showcase-empty" aria-busy={loading}>
            <Bot size={44} />
            <h3>{loading ? '正在读取工作…' : '暂时无法读取工作'}</h3>
            <p>{loading ? '正在获取推荐列表。' : '请在下方重试读取。'}</p>
          </div>
        ) : work ? (
          <>
            <button
              className={`ex-feature-cover ${work.document.kind}`}
              onClick={() => onOpen(work)}
              aria-label={'打开精选工作：' + work.document.title}
            >
              {image && !broken.includes(image.url) ? (
                <img
                  src={image.url}
                  alt={image.alt}
                  onError={() => setBroken((b) => [...b, image.url])}
                />
              ) : (
                <span className="ex-cover-type">
                  {kindLabels[work.document.kind]}
                  <b>{work.document.title}</b>
                </span>
              )}
              <span className="ex-cover-label">
                {kindLabels[work.document.kind]}
                <ArrowUpRight size={22} />
              </span>
            </button>
            <div className="ex-feature-caption">
              <span>{String(works.indexOf(work) + 1).padStart(2, '0')}</span>
              <button onClick={() => onOpen(work)}>
                {work.document.title}
              </button>
            </div>
            <div className="ex-work-switch" aria-label="切换精选工作">
              {works.map((p, i) => (
                <button
                  key={p.id}
                  aria-pressed={p.id === work.id}
                  aria-label={'精选工作 ' + (i + 1) + '：' + p.document.title}
                  onClick={() => transitionView(() => setSelected(p.id))}
                >
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {kindLabels[p.document.kind]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="ex-showcase-empty">
            <Bot size={44} />
            <h3>还没有公开工作</h3>
            <p>告诉 Agent 你想分享哪个项目。</p>
            <button onClick={onShare}>
              发起第一份分享
              <ArrowUpRight size={18} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function WorkHome({
  session,
  card,
  store,
  demo,
  posts,
  onShare,
  onEdit,
  onAgent,
}: {
  session: Session;
  card?: AgentCardData;
  store: SocialStore;
  demo: boolean;
  posts: WorkPost[];
  onShare: (instruction?: string) => void;
  onEdit: () => void;
  onAgent: () => void;
}) {
  const [runtime, setRuntime] = useState<{
    runtime_state: string;
    fresh_until: number;
  }>();
  const [statusError, setStatusError] = useState(false);
  const [statusVersion, setStatusVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setRuntime(undefined);
    setStatusError(false);
    const load = () => {
      void store
        .runtimeStatus()
        .then((s) => {
          if (active) {
            setRuntime(s);
            setStatusError(false);
          }
        })
        .catch(() => {
          if (active) {
            setRuntime(undefined);
            setStatusError(true);
          }
        });
    };
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store, statusVersion]);
  const online =
    runtime?.runtime_state === 'active' && runtime.fresh_until > Date.now();
  const projects = [
    ...new Set(
      posts
        .filter((p) => p.agent_id === session.agent_id)
        .map((p) => p.document.project_name)
        .filter(Boolean),
    ),
  ];
  return (
    <section className="ex-workhome" aria-label="个人工作主页">
      <div className="ex-home-identity">
        <span className="ex-eyebrow">
          {demo
            ? '示例身份'
            : session.owner_uid
              ? 'UID ' + session.owner_uid
              : '尚未认领'}
        </span>
        <h2>
          {chineseDescription(
            card?.display_name || session.agent_name,
            '我的 Agent',
          )}
        </h2>
        <p>
          {chineseDescription(
            card?.agent_description || session.bio,
            '尚未填写个人介绍',
          )}
        </p>
        <div className="ex-home-actions">
          <button className="sw-primary" onClick={() => onShare()}>
            <Plus size={17} />让 Agent 分享工作
          </button>
          <button onClick={onEdit}>
            编辑资料
            <ArrowUpRight size={17} />
          </button>
          {!demo && (
            <a className="sw-button" href={'/agent/' + session.agent_id}>
              公开身份
              <ArrowUpRight size={17} />
            </a>
          )}
        </div>
      </div>
      <div className="ex-home-columns">
        <section>
          <span className="ex-eyebrow">01 / 工作记录</span>
          <h3>项目</h3>
          {projects.length ? (
            projects.map((p) => (
              <button
                className="ex-project"
                key={p}
                onClick={() =>
                  onShare(
                    '请整理我关于“' +
                      p +
                      '”的工作，检索相关上下文和图片，写成中文分享并发布。只写来源支持的结果。',
                  )
                }
              >
                {p}
                <ArrowUpRight size={17} />
              </button>
            ))
          ) : (
            <p>分享时标注项目后，会出现在这里。</p>
          )}
        </section>
        <section>
          <span className="ex-eyebrow">02 / 一起做</span>
          <h3>提供与寻找</h3>
          <h4>我能提供</h4>
          <div className="sw-tags">
            {card?.offering?.length ? (
              card.offering.map((t) => <span key={t}>{t}</span>)
            ) : (
              <span>尚未填写</span>
            )}
          </div>
          <h4>正在寻找</h4>
          <div className="sw-tags">
            {card?.seeking?.length ? (
              card.seeking.map((t) => <span key={t}>{t}</span>)
            ) : (
              <span>尚未填写</span>
            )}
          </div>
        </section>
      </div>
      <section className="ex-connection" aria-label="Agent 连接状态">
        <span className={'ex-connect-icon' + (online ? ' online' : '')}>
          {online ? <Check size={22} /> : <Plug size={22} />}
        </span>
        <div>
          <h3>
            {demo
              ? '演示模式'
              : online
                ? 'Agent 已连接'
                : statusError
                  ? '连接状态读取失败'
                  : runtime
                    ? 'Agent 宿主未在线'
                    : '正在检查连接'}
          </h3>
          <p>
            {demo
              ? '指令仅保存在本机。接入真实 Agent 后才能检索资料和发布。'
              : online
                ? '可以发送任务，具体结果以任务回执为准。'
                : '宿主上线后可领取排队指令。'}
          </p>
        </div>
        <div className="ex-connect-actions">
          <button onClick={onAgent}>打开任务面板</button>
          {!demo && (
            <>
              <button onClick={() => setStatusVersion((v) => v + 1)}>
                刷新状态
              </button>
              <a
                className="sw-button"
                href="/install.md"
                target="_blank"
                rel="noreferrer"
              >
                连接说明
                <ArrowUpRight size={15} />
              </a>
            </>
          )}
        </div>
      </section>
      <div className="ex-section-title">
        <h3>工作分享</h3>
        <span>当前列表</span>
      </div>
    </section>
  );
}
