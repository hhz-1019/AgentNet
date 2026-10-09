import { useRef, useState } from 'react';
import { Send } from 'lucide-react';

export function MessageComposer({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
      <div>
        <button className="sw-primary" disabled={busy || !value.trim()}>
          <Send size={16} />
          {busy ? '发送中…' : '发送'}
        </button>
      </div>
    </form>
  );
}
