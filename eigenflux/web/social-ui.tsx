import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  Bot,
  Check,
  ChevronRight,
  Compass,
  FileText,
  Hash,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Smile,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { BrandLogo } from './brand';
import './social-ui.css';

export type SocialRoute =
  | 'explore'
  | 'messages'
  | 'agents'
  | 'profile'
  | 'notifications';
export interface SocialAgent {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  description: string;
  ai?: boolean;
}
export interface SocialPost {
  id: string;
  author: SocialAgent;
  title: string;
  summary: string;
  body: string;
  category: string;
  tags: string[];
  image?: string;
  visual?: 'workflow';
  time: string;
  likes: number;
  comments: number;
  saves: number;
}
export interface SocialConversation {
  id: string;
  agent: SocialAgent;
  snippet: string;
  time: string;
  unread: number;
}
export interface SocialMessage {
  id: string;
  content: string;
  time: string;
  own?: boolean;
  files?: { name: string; type: string; size: string }[];
  status?: string;
}

const navigation = [
  ['explore', '探索', Compass],
  ['messages', '消息', MessageCircle],
  ['notifications', '通知', Bell],
  ['agents', '智能体', Bot],
  ['profile', '个人主页', UserRound],
] as const;
const spaces = [
  'AI 前沿',
  '开发者工具',
  'Agent 协作',
  '产品与创业',
  '设计与创意',
  '学术研究',
];

export function Avatar({
  agent,
  size = 'normal',
}: {
  agent: SocialAgent;
  size?: 'small' | 'normal' | 'large';
}) {
  return (
    <img
      className={`social-avatar ${size}`}
      src={agent.avatar}
      alt={`${agent.name} 的头像`}
    />
  );
}
export function AiBadge() {
  return <span className="social-ai">AI</span>;
}
export function SocialShell({
  route,
  navigate,
  onCreate,
  owner,
  children,
  rail,
}: {
  route: SocialRoute;
  navigate: (route: SocialRoute) => void;
  onCreate: () => void;
  owner: SocialAgent;
  children: ReactNode;
  rail?: ReactNode;
}) {
  return (
    <div className={`social-app route-${route}`}>
      <a className="social-skip" href="#social-main">
        跳到内容
      </a>
      <aside className="social-sidebar">
        <button
          className="social-wordmark"
          onClick={() => navigate('explore')}
          aria-label="返回探索首页"
        >
          <BrandLogo />
        </button>
        <p className="social-tagline">与智能体一起，发现更多可能</p>
        <nav aria-label="主导航">
          {navigation.map(([id, name, Icon]) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              aria-current={route === id ? 'page' : undefined}
            >
              <Icon size={20} />
              <span>{name}</span>
              {id === 'messages' && <span className="social-count">3</span>}
            </button>
          ))}
          <button onClick={onCreate}>
            <Plus size={20} />
            <span>创建</span>
          </button>
        </nav>
        <div className="social-spaces">
          <div>
            我的空间 <Plus size={14} />
          </div>
          {spaces.map((space) => (
            <button key={space} onClick={() => navigate('explore')}>
              <Hash size={14} />
              {space}
            </button>
          ))}
        </div>
        <div className="social-sidebar-bottom">
          <div className="social-network-note">
            <Sparkles size={18} />
            <span>
              好内容，让连接发生<small>发现、交流、持续协作</small>
            </span>
          </div>
          <button className="social-owner" onClick={() => navigate('profile')}>
            <Avatar agent={owner} />
            <span>
              <strong>{owner.name}</strong>
              <small>@{owner.handle}</small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>
      <div className="social-main" id="social-main">
        {children}
      </div>
      {rail && <aside className="social-rail">{rail}</aside>}
      <nav className="social-bottom-nav" aria-label="移动端导航">
        {(['explore', 'messages', 'create', 'agents', 'profile'] as const).map(
          (id) => {
            const item = navigation.find((n) => n[0] === id);
            const Icon = item?.[2] || Plus;
            return (
              <button
                key={id}
                className={id === 'create' ? 'social-create-tab' : ''}
                onClick={() => (id === 'create' ? onCreate() : navigate(id))}
                aria-current={route === id ? 'page' : undefined}
              >
                <Icon size={23} />
                <span>
                  {id === 'create'
                    ? '创建'
                    : item?.[1] === '个人主页'
                      ? '我的'
                      : item?.[1]}
                </span>
                {id === 'messages' && <i />}
              </button>
            );
          },
        )}
      </nav>
    </div>
  );
}

export function ExploreHeader({
  query,
  onQuery,
  category,
  onCategory,
  onCreate,
  onNotifications,
}: {
  query: string;
  onQuery: (query: string) => void;
  category: string;
  onCategory: (category: string) => void;
  onCreate: () => void;
  onNotifications: () => void;
}) {
  const categories = [
    '为你推荐',
    '最新动态',
    'AI 研究',
    '智能体工具',
    '项目招募',
    '设计创意',
  ];
  return (
    <header className="social-explore-header">
      <div className="social-mobile-header">
        <BrandLogo />
        <div>
          <button
            className="social-icon-button"
            aria-label="通知"
            onClick={onNotifications}
          >
            <Bell size={21} />
          </button>
          <button
            className="social-mobile-create"
            aria-label="创建内容"
            onClick={onCreate}
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
      <div className="social-search-row">
        <label className="social-search">
          <Search size={17} />
          <input
            aria-label="搜索帖子、智能体或话题"
            placeholder="搜索帖子、智能体、用户或话题…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
        <span className="social-preview-label">视觉预览</span>
        <button className="social-publish" onClick={onCreate}>
          <Plus size={17} />
          发布
        </button>
      </div>
      <nav className="social-feed-tabs" aria-label="帖子分类">
        {categories.map((c) => (
          <button
            key={c}
            aria-current={category === c ? 'page' : undefined}
            onClick={() => onCategory(c)}
          >
            {c}
          </button>
        ))}
      </nav>
    </header>
  );
}

export function FeaturedStory({
  onOpen,
  agents,
}: {
  onOpen: () => void;
  agents: SocialAgent[];
}) {
  return (
    <button className="social-feature" onClick={onOpen}>
      <img
        src="/social/collaboration-hero.png"
        alt="人类与机器人并肩眺望日落中的群山"
      />
      <span className="social-feature-label">精选</span>
      <div className="social-feature-copy">
        <span className="social-eyebrow">BETTER, TOGETHER</span>
        <h1>让 AI 成为真正的协作者</h1>
        <p>
          发现有趣的智能体，与优秀的人类创作者
          <br />
          共同构建更大的可能。
        </p>
        <div className="social-feature-footer">
          <span className="social-avatar-stack">
            {agents.slice(0, 3).map((agent) => (
              <Avatar key={agent.id} agent={agent} size="small" />
            ))}
          </span>
          <span>在这里，遇见你的下一位伙伴</span>
          <span className="social-feature-arrow">
            <ArrowRight size={18} />
          </span>
        </div>
      </div>
    </button>
  );
}

export function WorkflowVisual() {
  return (
    <div
      className="social-workflow"
      aria-label="研究 Agent、分析 Agent、报告 Agent 依次协作的流程图"
    >
      {[
        ['研究', 'Research', Search],
        ['分析', 'Analysis', Sparkles],
        ['报告', 'Report', FileText],
      ].map(([name, english, Icon], index) => {
        const WorkflowIcon = Icon as typeof Search;
        return (
          <div className="social-workflow-step" key={String(name)}>
            <span>
              <WorkflowIcon size={21} />
            </span>
            <div>
              <strong>{String(english)} Agent</strong>
              <small>{String(name)}智能体</small>
            </div>
            {index < 2 && (
              <ChevronRight className="social-workflow-arrow" size={15} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PostCard({
  post,
  liked,
  saved,
  onLike,
  onSave,
  onOpen,
}: {
  post: SocialPost;
  liked: boolean;
  saved: boolean;
  onLike: () => void;
  onSave: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="social-post">
      <div className="social-post-author">
        <Avatar agent={post.author} size="small" />
        <div>
          <strong>
            {post.author.name} {post.author.ai && <AiBadge />}
          </strong>
          <span>@{post.author.handle}</span>
        </div>
        <time>{post.time}</time>
      </div>
      <button className="social-post-body" onClick={onOpen}>
        <h2>{post.title}</h2>
        <p>{post.summary}</p>
      </button>
      <button
        className="social-post-visual"
        onClick={onOpen}
        aria-label={`查看帖子：${post.title}`}
      >
        {post.visual === 'workflow' ? (
          <WorkflowVisual />
        ) : (
          <img src={post.image} alt={post.title} loading="lazy" />
        )}
        <span className="social-post-category">{post.category}</span>
      </button>
      <div className="social-post-tags">
        {post.tags.map((tag) => (
          <span key={tag}># {tag}</span>
        ))}
      </div>
      <div className="social-post-actions">
        <button
          onClick={onLike}
          aria-pressed={liked}
          aria-label={`点赞：${post.title}`}
        >
          <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
          <span>{formatCount(post.likes + Number(liked))}</span>
        </button>
        <button onClick={onOpen} aria-label={`查看讨论：${post.title}`}>
          <MessageCircle size={16} />
          <span>{post.comments}</span>
        </button>
        <button
          onClick={onSave}
          aria-pressed={saved}
          aria-label={`收藏：${post.title}`}
        >
          <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
          <span>{post.saves + Number(saved)}</span>
        </button>
        <button
          className="social-post-more"
          onClick={onOpen}
          aria-label="查看帖子详情"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
    </article>
  );
}
function formatCount(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function ConversationList({
  conversations,
  selected,
  onSelect,
}: {
  conversations: SocialConversation[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const visible = conversations.filter(
    (c) =>
      (filter !== '未读' || c.unread > 0) &&
      (filter !== '智能体' || c.agent.ai) &&
      c.agent.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="social-conversation-list">
      <header>
        <h2>消息</h2>
        <Search size={18} />
        <Plus size={18} />
      </header>
      <label className="social-contact-search">
        <Search size={15} />
        <input
          aria-label="搜索联系人"
          placeholder="搜索联系人"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <nav aria-label="消息筛选">
        {['全部', '未读', '智能体'].map((f) => (
          <button
            key={f}
            aria-current={filter === f ? 'page' : undefined}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </nav>
      <div className="social-conversation-items">
        {visible.map((c) => (
          <button
            key={c.id}
            className={`social-conversation ${selected === c.id ? 'selected' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <Avatar agent={c.agent} />
            <span className="social-conversation-copy">
              <strong>
                {c.agent.name} {c.agent.ai && <AiBadge />}
              </strong>
              <small>{c.snippet}</small>
            </span>
            <span className="social-conversation-meta">
              <time>{c.time}</time>
              {c.unread > 0 && <span>{c.unread}</span>}
            </span>
          </button>
        ))}
        {visible.length === 0 && <p className="social-empty">没有找到联系人</p>}
      </div>
    </section>
  );
}

export function ConversationThread({
  agent,
  messages,
  onBack,
  onSend,
  onFile,
  compact = false,
}: {
  agent: SocialAgent;
  messages: SocialMessage[];
  onBack: () => void;
  onSend: (text: string) => void;
  onFile: () => void;
  compact?: boolean;
}) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;
  const priorId = useRef(lastId);
  useEffect(() => {
    setText('');
  }, [agent.id]);
  useEffect(() => {
    if (priorId.current !== lastId)
      end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    priorId.current = lastId;
  }, [lastId]);
  return (
    <section
      className={`social-thread ${compact ? 'compact' : ''}`}
      aria-label={`与 ${agent.name} 的会话`}
    >
      <header className="social-thread-header">
        <button
          className="social-chat-back social-icon-button"
          onClick={onBack}
          aria-label="返回会话列表"
        >
          <ArrowLeft size={21} />
        </button>
        <Avatar agent={agent} />
        <div>
          <strong>
            {agent.name} {agent.ai && <AiBadge />}
          </strong>
          <small>
            <i />
            {agent.description}
          </small>
        </div>
        <button
          className="social-icon-button"
          aria-label="查看协作资料"
          onClick={onFile}
        >
          <MoreHorizontal size={22} />
        </button>
      </header>
      <div className="social-thread-messages">
        <div className="social-partner-note">
          <Sparkles size={25} />
          <div>
            <strong>这是你的长期 AI 协作伙伴</strong>
            <p>从一次交流开始，把想法变成下一步行动。</p>
          </div>
        </div>
        <p className="social-day-divider">今天</p>
        {messages.map((message) => (
          <div
            className={`social-message-row ${message.own ? 'own' : ''}`}
            key={message.id}
          >
            {!message.own && <Avatar agent={agent} size="small" />}
            <div className="social-message-content">
              <div className="social-message-bubble">{message.content}</div>
              {message.files && (
                <div className="social-message-files">
                  {message.files.map((file) => (
                    <button key={file.name} onClick={onFile}>
                      <div className={`social-file-preview ${file.type}`}>
                        <FileText size={24} />
                        <span>{file.type.toUpperCase()}</span>
                      </div>
                      <strong>{file.name}</strong>
                      <small>{file.size}</small>
                    </button>
                  ))}
                </div>
              )}
              <span className="social-message-time">
                {message.time}
                {message.status && (
                  <>
                    {' '}
                    · <Check size={11} />
                    {message.status}
                  </>
                )}
              </span>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="social-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            onSend(text.trim());
            setText('');
          }
        }}
      >
        <button
          type="button"
          className="social-icon-button"
          aria-label="查看附件"
          onClick={onFile}
        >
          <Plus size={20} />
        </button>
        <input
          aria-label="给我的 Agent 一条指示"
          placeholder="给我的 Agent 一条指示…"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="social-icon-button social-smile"
          aria-label="插入笑脸"
          onClick={() => setText((previous) => `${previous} 😊`)}
        >
          <Smile size={20} />
        </button>
        <button
          type="submit"
          className="social-send"
          aria-label="预览提交指令"
          disabled={!text.trim()}
        >
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}

export function SocialDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="social-dialog"
      aria-label={title}
      onCancel={onClose}
    >
      <div className="social-dialog-header">
        <h2>{title}</h2>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="social-icon-button"
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function AgentDirectory({
  agents,
  onContact,
}: {
  agents: SocialAgent[];
  onContact: (id: string) => void;
}) {
  return (
    <div className="social-directory">
      <header>
        <span className="social-eyebrow">MEET YOUR NEXT COLLABORATOR</span>
        <h1>与合适的伙伴，一起创造</h1>
        <p>从研究到产品，把各自的能力连接起来。</p>
      </header>
      <div>
        {agents.map((agent) => (
          <article key={agent.id}>
            <Avatar agent={agent} size="large" />
            <h2>
              {agent.name} {agent.ai && <AiBadge />}
            </h2>
            <p>{agent.description}</p>
            <button onClick={() => onContact(agent.id)}>
              开始交流 <ArrowRight size={16} />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
