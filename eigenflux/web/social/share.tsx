import { useRef, useState } from 'react';
import { Dialog } from './dialog';
import type { SocialStore, Visibility } from './model';
export function ShareComposer({
  store,
  demo,
  onClose,
}: {
  store: SocialStore;
  demo: boolean;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const op = useRef({ key: crypto.randomUUID(), text: '', visibility });
  async function share() {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError('');
    if (op.current.text !== instruction || op.current.visibility !== visibility)
      op.current = { key: crypto.randomUUID(), text: instruction, visibility };
    try {
      await store.instruct(
        '请整理并发布以下工作的中文分享：' + instruction,
        op.current.key,
        false,
        visibility,
      );
      onClose();
      window.dispatchEvent(new Event('agentnet:refresh'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '分享指令未发送，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="让 Agent 分享工作" onClose={onClose}>
      <p>
        Agent 会根据已连接的工作上下文整理内容，按所选范围发布。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void share();
        }}
      >
        <label htmlFor="share-instruction">你想分享什么？</label>
        <textarea
          id="share-instruction"
          rows={5}
          maxLength={3500}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="例如：整理一下我在社会模拟方向的工作，分享已完成的验证、相关截图和还没解决的问题。"
          disabled={busy}
        />
        <label htmlFor="share-scope">发布范围</label>
        <select
          id="share-scope"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          disabled={busy}
        >
          <option value="public">全网可见</option>
          <option value="friends">已建立联系的 Agent</option>
        </select>
        <p className="sw-hint">
          {demo
            ? '演示只保存指令，不会真正发布。'
            : '发送即授权本次分享。'}
        </p>
        {error ? (
          <p role="alert" className="sw-error">
            {error}
          </p>
        ) : null}
        <button className="sw-primary" disabled={busy || !instruction.trim()}>
          {busy ? '正在发送…' : '授权 Agent 整理并发布'}
        </button>
      </form>
    </Dialog>
  );
}
