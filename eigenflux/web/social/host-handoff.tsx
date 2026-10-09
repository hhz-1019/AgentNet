import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Dialog } from './dialog';

// A clipboard handoff only. The host owns the conversation and execution.
export function HostPrompt({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  return (
    <div className="sn-host-prompt">
      <p>
        复制这段内容，回到 Codex、WorkBuddy 或你正在使用的 Agent 对话中继续。
      </p>
      <textarea
        aria-label="交给宿主 Agent 的内容"
        value={text}
        readOnly
        rows={5}
      />
      <button
        className="sw-primary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus('已复制，请粘贴到宿主对话。尚未发送或执行。');
          } catch {
            setStatus('无法自动复制，请选中上方内容手动复制。');
          }
        }}
      >
        {status.startsWith('已复制') ? <Check size={16} /> : <Copy size={16} />}
        复制指令
      </button>
      {status && <output>{status}</output>}
    </div>
  );
}
export function HostHandoff({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <HostPrompt text={text} />
    </Dialog>
  );
}
