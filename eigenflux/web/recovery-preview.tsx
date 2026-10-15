import { useState } from 'react';
import { BrandLogo } from './brand';
import { useData } from './api';
import { ErrorBox } from './shared';
import { ContentState, ContentBoundary, RecoveryPage } from './recovery';
import { setRecoveryUnavailable } from './recovery-fixture';

function BrokenPanel({ broken }: { broken: boolean }) {
  if (broken) throw new Error('preview-only render failure');
  return <ContentState title="这一部分已恢复" />;
}

export function RecoveryPreview() {
  const [view, setView] = useState('content');
  const [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState('');
  const [broken, setBroken] = useState(false);
  const q = useData<{ message: string; author: string }>(
    'console/preview/recovery',
  );
  if (view === 'page') return <RecoveryPage retry={() => setView('content')} />;
  return (
    <main className="onboarding recovery-review">
      <a href="/preview" className="brand">
        <BrandLogo />
      </a>
      <nav className="row" aria-label="状态预览">
        {[
          ['content', '断连保留'],
          ['loading', '加载中'],
          ['empty', '暂无内容'],
          ['failure', '局部失败'],
          ['action', '操作失败'],
          ['boundary', '局部异常'],
          ['page', '整页恢复'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={id === view}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === 'content' && (
        <>
          <div className="row">
            <h2>消息</h2>
            <button
              onClick={() => {
                setRecoveryUnavailable(!offline);
                setOffline(!offline);
                q.reload();
              }}
            >
              {offline ? '恢复连接' : '模拟断连'}
            </button>
          </div>
          <ErrorBox error={q.error} retry={q.reload} />
          {q.data && (
            <article>
              <strong>{q.data.author}</strong>
              <p>{q.data.message}</p>
            </article>
          )}
          <label>
            回复
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="输入一段文字，再模拟断连"
            />
          </label>
        </>
      )}
      {view === 'loading' && <ContentState title="正在加载此刻" loading quiet />}
      {view === 'empty' && (
        <ContentState
          title="这里还没有动态"
          action={() => setView('content')}
          label="去发现看看"
        />
      )}
      {view === 'failure' && (
        <ContentState
          title="动态暂时没有加载出来"
          action={() => setView('content')}
        />
      )}
      {view === 'action' && (
        <>
          <label>
            回复
            <textarea defaultValue="好呀，周六下午可以吗？" />
          </label>
          <ErrorBox error="消息未发送，请再试一次。" />
          <button onClick={() => setView('content')}>重新发送</button>
        </>
      )}
      {view === 'boundary' && (
        <>
          <button onClick={() => setBroken(!broken)}>
            {broken ? '修复模拟故障' : '模拟局部异常'}
          </button>
          <ContentBoundary key={String(broken)}>
            <BrokenPanel broken={broken} />
          </ContentBoundary>
        </>
      )}
    </main>
  );
}
