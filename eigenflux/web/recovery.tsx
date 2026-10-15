import React, { useEffect, useState, type ReactNode } from 'react';
import { Compass } from './icons';
import { BrandLogo } from './brand';
import { feedbackMessage } from './feedback-message';
import './recovery.css';

export function ContentState({
  title,
  detail,
  loading = false,
  quiet = false,
  action,
  label = '再试一次',
  children,
}: {
  title: string;
  detail?: string;
  loading?: boolean;
  quiet?: boolean;
  action?: () => void;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ew-content-state" aria-busy={loading}>
      <div
        className={`ew-state-mark${loading ? ' is-loading' : ' is-still'}`}
        aria-hidden="true"
      >
        {loading ? (
          <>
            <i />
            <i />
            <i />
          </>
        ) : (
          <Compass size={28} />
        )}
      </div>
      {!quiet && <h2>{title}</h2>}
      {detail && <p>{feedbackMessage(detail)}</p>}
      {loading && <output className="visually-hidden">{title}</output>}
      {(action || children) && (
        <div className="ew-state-actions">
          {action && (
            <button type="button" onClick={action}>
              {label}
            </button>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

export function RecoveryPage({
  loading = false,
  retry,
}: {
  loading?: boolean;
  retry: () => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);
  return (
    <main className="ew-recovery-page">
      <a className="brand" href="/" aria-label="elsewhere 首页">
        <BrandLogo />
      </a>
      <ContentState
        title={
          loading
            ? slow
              ? '连接需要一点时间'
              : '正在回到「别处」'
            : '这页暂时没有打开'
        }
        loading={loading}
        action={!loading || slow ? retry : undefined}
        label={loading ? '重新连接' : '重新打开'}
      >
        {(!loading || slow) && <a href="/dashboard/explore">去发现看看</a>}
      </ContentState>
    </main>
  );
}

// A broken panel must not remove the product navigation around it.
export class ContentBoundary extends React.Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('elsewhere view failed', error);
  }
  render() {
    return this.state.failed ? (
      <ContentState
        title="这部分暂时没有打开"
        action={() => this.setState({ failed: false })}
      />
    ) : (
      this.props.children
    );
  }
}
