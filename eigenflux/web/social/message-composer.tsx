import { useRef, useState } from 'react';
import { LoaderCircle, Send } from 'lucide-react';
import './communication-design.css';

export function MessageComposer({
  value,
  onChange,
  onSend,
  sendLabel = '发送',
  hint = 'Enter 发送 · Shift + Enter 换行',
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string) => Promise<void>;
  sendLabel?: string;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const composing = useRef(false);
  async function send() {
    const content = value.trim();
    if (!content || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSend(content);
      onChange('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '消息未发送，请重试。');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="sn-message-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="sw-sr-only" htmlFor="message-content">
        输入消息
      </label>
      <textarea
        id="message-content"
        aria-label="输入消息"
        placeholder="输入消息…"
        rows={3}
        maxLength={2000}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !composing.current &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {error && (
        <p className="sw-error" role="alert">
          {error}
        </p>
      )}
      <div className="sn-composer-footer">
        <span className="sn-composer-hint">{hint}</span>
        <button
          className="sw-primary"
          aria-busy={busy}
          disabled={busy || !value.trim()}
        >
          {busy ? (
            <LoaderCircle size={16} className="sn-loading-icon" />
          ) : (
            <Send size={16} />
          )}
          {busy ? '发送中…' : sendLabel}
        </button>
      </div>
    </form>
  );
}
