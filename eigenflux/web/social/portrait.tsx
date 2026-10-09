import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Eye,
  LockKeyhole,
  Plus,
  Search,
} from 'lucide-react';
import { Dialog } from './dialog';
import {
  emptyMemory,
  portraitFields,
  type EventMemory,
  type Portrait,
  type PortraitField,
} from './portrait-data';
import './profile-design.css';

export function PortraitEditor({
  profile,
  onSave,
  onPublicHome,
  focusMemory = false,
  onComplete,
}: {
  profile: Portrait;
  onSave: (p: Portrait) => void | Promise<void>;
  onPublicHome: () => void;
  focusMemory?: boolean;
  onComplete?: () => void;
}) {
  const formId = useId();
  const [fields, setFields] = useState(profile.fields);
  const [visible, setVisible] = useState(profile.visible);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const [editing, setEditing] = useState<EventMemory>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editorError, setEditorError] = useState('');
  const [removed, setRemoved] = useState<EventMemory>();
  const memorySection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusMemory) memorySection.current?.scrollIntoView({ block: 'start' });
  }, [focusMemory]);
  const filtered = profile.memories.filter((m) =>
    m.content.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function save(next: Portrait, message: string) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      await onSave(next);
      setError('');
      setStatus(message);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '保存失败，输入已保留，请重试。',
      );
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function openMemory(memory: EventMemory) {
    setEditorError('');
    setEditing(memory);
  }
  function changeField(key: PortraitField, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setStatus('');
    setError('');
  }
  return (
    <section className="sn-portrait">
      <header className="sn-page-heading">
        <div>
          <h1>{onComplete ? '确认画像' : '编辑画像'}</h1>
        </div>
        {!onComplete && (
          <button onClick={onPublicHome}>
            查看主页 <ArrowRight size={16} />
          </button>
        )}
      </header>
      <section
        className="sn-portrait-details"
        aria-labelledby={`${formId}-details`}
      >
        <div className="sn-section-intro">
          <h2 id={`${formId}-details`}>我的资料</h2>
        </div>
        <form
          id={formId}
          className="sn-portrait-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!fields.name.trim()) return;
            const saved = await save(
              {
                ...profile,
                fields: { ...fields, name: fields.name.trim() },
                visible,
              },
              '资料已保存。',
            );
            if (saved) onComplete?.();
          }}
        >
          <div className="sn-portrait-grid">
            {portraitFields.map((field) => (
              <div
                className={`sn-portrait-field sn-portrait-field-${field.key}`}
                key={field.key}
              >
                <div>
                  <label htmlFor={`${formId}-${field.key}`}>
                    {field.label}
                    {field.key === 'name' && (
                      <span className="required-mark" aria-hidden="true">
                        {' '}
                        *
                      </span>
                    )}
                  </label>
                  {field.key === 'name' ? (
                    <span className="sn-visibility sn-visibility-fixed">
                      <Eye size={16} aria-hidden="true" /> 固定展示
                    </span>
                  ) : (
                    <label className="sn-visibility">
                      <input
                        type="checkbox"
                        aria-label={`${field.label}在主页展示`}
                        checked={visible.includes(field.key)}
                        onChange={(e) => {
                          setVisible((v) =>
                            e.target.checked
                              ? [...v, field.key]
                              : v.filter((key) => key !== field.key),
                          );
                          setStatus('');
                        }}
                      />
                      主页展示
                    </label>
                  )}
                </div>
                {['name', 'role'].includes(field.key) ? (
                  <input
                    id={`${formId}-${field.key}`}
                    aria-label={field.label}
                    required={field.key === 'name'}
                    maxLength={field.key === 'name' ? 80 : 200}
                    value={fields[field.key]}
                    onChange={(e) => changeField(field.key, e.target.value)}
                  />
                ) : (
                  <textarea
                    id={`${formId}-${field.key}`}
                    rows={2}
                    maxLength={1000}
                    value={fields[field.key]}
                    onChange={(e) => changeField(field.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </form>
        <section
          className="sn-memories"
          ref={memorySection}
          aria-label="事件记忆"
        >
          <header className="sn-page-heading">
            <div>
              <h3>
                事件记忆 <span>{profile.memories.length} 条</span>
              </h3>
            </div>
            <button
              className="sw-primary"
              onClick={() => openMemory(emptyMemory())}
            >
              <Plus size={17} />
              记一件事
            </button>
          </header>
          <label className="sn-memory-search">
            <Search size={17} />
            <input
              aria-label="搜索事件记忆"
              placeholder="搜索记忆内容…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(12);
              }}
            />
          </label>
          {query && (
            <p className="sw-hint">
              找到 {filtered.length} 条记忆{' '}
              <button onClick={() => setQuery('')}>清空搜索</button>
            </p>
          )}
          <div className="sn-memory-list">
            {filtered.slice(0, limit).map((m) => (
              <article className="sn-memory" key={m.id}>
                <div className="sn-memory-meta">
                  {m.showOnHome ? (
                    <Eye size={16} aria-hidden="true" />
                  ) : (
                    <LockKeyhole size={16} aria-hidden="true" />
                  )}
                  <span>{m.showOnHome ? '主页展示' : '仅自己可见'}</span>
                </div>
                <p className="sn-memory-content">{m.content}</p>
                <footer>
                  <button onClick={() => openMemory({ ...m })}>
                    查看 / 编辑
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        await save(
                          {
                            ...profile,
                            memories: profile.memories.filter(
                              (entry) => entry.id !== m.id,
                            ),
                          },
                          '已移除这条记忆，可以撤销。',
                        )
                      )
                        setRemoved(m);
                    }}
                  >
                    移除
                  </button>
                </footer>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="sw-empty">
              <BookOpen size={30} />
              <h3>{query ? '没有找到这段记忆' : '还没有事件记忆'}</h3>
            </div>
          )}
          {filtered.length > limit && (
            <button onClick={() => setLimit((n) => n + 12)}>
              查看更多记忆（还有 {filtered.length - limit} 条）
            </button>
          )}
        </section>
      </section>
      {status && (
        <output className="sn-portrait-status" aria-live="polite">
          {status}
        </output>
      )}
      {removed && (
        <button
          className="sn-memory-undo"
          onClick={async () => {
            if (
              await save(
                { ...profile, memories: [removed, ...profile.memories] },
                '记忆已恢复。',
              )
            )
              setRemoved(undefined);
          }}
        >
          撤销移除「{removed.content.slice(0, 20)}」
        </button>
      )}
      {error && (
        <p role="alert" className="sw-error">
          {error}
        </p>
      )}
      <div
        className={
          onComplete ? 'portrait-confirm-actions' : 'sn-portrait-actions'
        }
      >
        <button
          className="sw-primary"
          type="submit"
          form={formId}
          disabled={busy || !fields.name.trim()}
        >
          {onComplete ? '确认画像，进入 elsewhere' : '保存资料'}
        </button>
      </div>
      {editing && (
        <Dialog
          title={
            profile.memories.some((m) => m.id === editing.id)
              ? '编辑事件记忆'
              : '记一件事'
          }
          busy={busy}
          onClose={() => setEditing(undefined)}
        >
          <form
            className="sn-memory-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!editing.content.trim() || saving.current) return;
              saving.current = true;
              setBusy(true);
              const next = {
                ...editing,
                content: editing.content.trim(),
                updatedAt: Date.now(),
              };
              const exists = profile.memories.some((m) => m.id === next.id);
              try {
                await onSave({
                  ...profile,
                  memories: exists
                    ? profile.memories.map((m) => (m.id === next.id ? next : m))
                    : [next, ...profile.memories],
                });
                setEditing(undefined);
                setStatus(exists ? '记忆已更新。' : '记忆已保存。');
                setQuery('');
                setLimit(12);
                setError('');
              } catch {
                setEditorError('保存失败，输入已保留，请重试。');
              } finally {
                saving.current = false;
                setBusy(false);
              }
            }}
          >
            <label>
              记忆内容
              <textarea
                required
                rows={8}
                maxLength={16000}
                value={editing.content}
                onChange={(e) =>
                  setEditing({ ...editing, content: e.target.value })
                }
              />
            </label>
            <label className="sn-visibility">
              <input
                type="checkbox"
                checked={editing.showOnHome}
                onChange={(e) =>
                  setEditing({ ...editing, showOnHome: e.target.checked })
                }
              />
              在主页展示这条记忆
            </label>
            {editorError && (
              <p role="alert" className="sw-error">
                {editorError}
              </p>
            )}
            <footer className="sw-dialog-footer">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button
                className="sw-primary"
                disabled={busy || !editing.content.trim()}
              >
                保存这条记忆
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </section>
  );
}
