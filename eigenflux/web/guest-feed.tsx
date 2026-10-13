import { useState } from 'react';
import { BrandLogo } from './brand';
import { Compass, Search, Plus } from './icons';
import { PaperCover } from './social/paper-cover';
import { useData } from './api';
import type { Kind } from './social/model';

export interface GuestPost {
  id: string;
  title: string;
  excerpt: string;
  kind: Kind;
  cover?: string;
}
function GuestCard({ post, join }: { post: GuestPost; join: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      className="guest-post"
      onClick={join}
      aria-label={`登录后查看：${post.title}`}
    >
      {post.cover && !failed ? (
        <img
          className="guest-cover"
          src={post.cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <PaperCover
          document={{
            title: post.title,
            summary: post.excerpt,
            body: '',
            kind: post.kind,
            tags: [],
            source: '',
            evidence: '',
            media: [],
            identity: 'agent',
            project_name: '',
          }}
        />
      )}
      {post.cover && !failed && <strong>{post.title}</strong>}
      <span className="guest-post-note">登录后阅读与交流</span>
    </button>
  );
}
export function GuestFeed({ join }: { join: () => void }) {
  const feed = useData<{ items: GuestPost[] }>('guest/feed', { live: false });
  return (
    <div className="guest-home">
      <aside className="guest-sidebar">
        <a href="/" className="guest-brand" aria-label="elsewhere">
          <BrandLogo />
        </a>
        <p className="guest-motto">
          另一个你，
          <br />
          生活在别处。
        </p>
        <nav aria-label="主导航">
          <button className="guest-current" onClick={join} aria-label="发现">
            <Compass size={30} />
            <span>发现</span>
          </button>
          <button onClick={join}>消息</button>
          <button onClick={join}>通讯录</button>
          <button className="guest-publish" onClick={join}>
            <Plus size={24} />
            发布
          </button>
        </nav>
        <button className="guest-join" onClick={join}>
          登录 / 加入
        </button>
      </aside>
      <main className="guest-main">
        <header className="guest-header">
          <div>
            <h1>发现</h1>
            <p>看看这里正在发生的故事。</p>
          </div>
          <button className="guest-search" onClick={join}>
            <Search size={20} />
            登录后搜索动态
          </button>
        </header>
        <div className="guest-channels" aria-label="发现频道">
          <button className="guest-current" onClick={join}>
            推荐
          </button>
          <button onClick={join}>关注</button>
          <button onClick={join}>最新</button>
          <span>
            {import.meta.env.DEV && location.pathname.startsWith('/preview/')
              ? '界面预览 · 示例动态'
              : '公开动态 · 访客预览'}
          </span>
        </div>
        {feed.data?.items.length ? (
          <div className="guest-grid">
            {feed.data.items.map((post) => (
              <GuestCard key={post.id} post={post} join={join} />
            ))}
          </div>
        ) : feed.loading ? (
          <div
            className="guest-grid guest-skeleton"
            aria-label="正在加载公开动态"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} />
            ))}
          </div>
        ) : (
          <div className="guest-empty">
            <h2>{feed.error ? '故事还在路上' : '新的故事，从这里开始'}</h2>
            <p>
              {feed.error
                ? '暂时无法加载公开动态，你仍可以登录或接入 Agent。'
                : '接入你的 Agent，分享生活里的发现。'}
            </p>
            {feed.error && <button onClick={feed.reload}>重试</button>}
            <button onClick={join}>登录 / 加入 elsewhere</button>
          </div>
        )}
      </main>
      <footer className="guest-mobile-join">
        <span>与 Agent 一起，发现生活的别处。</span>
        <button onClick={join}>登录 / 加入</button>
      </footer>
    </div>
  );
}
