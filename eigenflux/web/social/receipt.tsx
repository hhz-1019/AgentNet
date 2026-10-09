import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { chineseDescription } from '../chinese';
import { commandResult, type Command, type SocialStore } from './model';
import { shareReceipt } from './work-network-model';
import './work-network.css';

export function ShareReceipt({
  store,
  commandId,
  instruction,
  demo,
  onOpenPost,
}: {
  store: SocialStore;
  commandId: string;
  instruction: string;
  demo: boolean;
  onOpenPost?: (id: string) => void | Promise<void>;
}) {
  const [command, setCommand] = useState<Command>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!commandId) {
      setError('接口未返回任务编号，可在个人 Agent 对话中查看记录。');
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      let terminal = false;
      try {
        const found = (await store.commands()).find((c) => c.id === commandId);
        if (!active) return;
        setCommand(found);
        setError('');
        terminal = shareReceipt(found, demo).terminal;
      } catch {
        if (active) setError('回执暂时无法读取，任务状态未更新。');
      }
      if (active && !terminal) timer = setTimeout(() => void read(), 4000);
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [store, commandId, demo, refresh]);
  const state = shareReceipt(command, demo);
  const Icon =
    state.tone === 'success'
      ? CheckCircle2
      : state.tone === 'error'
        ? TriangleAlert
        : Clock3;
  const rawReply = command ? commandResult(command.result) : '';
  const reply = rawReply
    ? chineseDescription(rawReply, '宿主回执尚未提供中文说明。')
    : '';
  return (
    <section className={`wr-receipt ${state.tone}`} aria-label="分享任务回执">
      <header>
        <Icon size={25} />
        <div>
          <h3>
            <output>{state.label}</output>
          </h3>
          <small>任务编号 · {commandId || '暂不可用'}</small>
        </div>
      </header>
      <p>{state.detail}</p>
      <p className="wr-instruction">{instruction}</p>
      {reply && <p>{reply}</p>}
      {state.postId && onOpenPost && (
        <button
          className="wr-post-button"
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            try {
              await onOpenPost(state.postId);
            } catch {
              setError('发布回执已返回，成果暂时无法读取，请稍后重试。');
            } finally {
              setOpening(false);
            }
          }}
        >
          查看已发布成果
          <ArrowUpRight size={15} />
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="wr-refresh" onClick={() => setRefresh((v) => v + 1)}>
        <RefreshCw size={14} />
        刷新回执
      </button>
    </section>
  );
}
