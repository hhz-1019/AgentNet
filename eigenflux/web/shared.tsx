import React, { useRef, useState, type ReactNode } from 'react';
import { normalizeBoundary } from './onboarding';
import type { Boundary } from './types';

const boundaryLabels: Record<keyof Boundary, string> = {
  recurring_publish: '允许持续发布公开广播',
  auto_reply_pm: '允许 Agent 自动回复私信',
  auto_comment: '允许 Agent 自动回应广播',
  show_add_friend: '允许在公开名片显示添加好友入口',
};

export function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export const time = (n?: number) =>
  n
    ? new Date(n).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未记录';

export function Blank({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  return error ? (
    <div role="alert" className="error">
      {error}
      {retry && <button onClick={retry}>重新读取</button>}
    </div>
  ) : null;
}

export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label>
      {label}
      {props.required && (
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      )}
      <input
        {...props}
        onInvalid={(event) => {
          const details = event.currentTarget.closest('details');
          if (details) details.open = true;
          props.onInvalid?.(event);
        }}
      />
    </label>
  );
}

export function TextField({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label>
      {label}
      {props.required && (
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      )}
      <textarea
        rows={4}
        {...props}
        onInvalid={(event) => {
          const details = event.currentTarget.closest('details');
          if (details) details.open = true;
          props.onInvalid?.(event);
        }}
      />
    </label>
  );
}

export function BoundaryFields({
  value,
  onChange,
}: {
  value: Boundary | undefined;
  onChange: (value: Boundary) => void;
}) {
  const boundary = normalizeBoundary(value);
  return (
    <div className="checks">
      {(Object.keys(boundaryLabels) as (keyof Boundary)[]).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={boundary[key]}
            onChange={(e) => onChange({ ...boundary, [key]: e.target.checked })}
          />
          {boundaryLabels[key]}
        </label>
      ))}
    </div>
  );
}

export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const pending = useRef(false);
  return {
    error,
    busy,
    note,
    run: async (fn: () => Promise<void>, success = '已保存') => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError('');
      setNote('');
      try {
        await fn();
        setNote(success);
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
  };
}

export function ActionStatus({
  action,
}: {
  action: ReturnType<typeof useAction>;
}) {
  return (
    <>
      <ErrorBox error={action.error} />
      {action.note && <output className="success">{action.note}</output>}
    </>
  );
}

export function Pager({
  cursor,
  next,
  onChange,
}: {
  cursor: string;
  next?: string;
  onChange: (cursor: string) => void;
}) {
  return (
    <div className="actions">
      {cursor && <button onClick={() => onChange('')}>返回第一页</button>}
      {next && <button onClick={() => onChange(next)}>下一页</button>}
    </div>
  );
}
