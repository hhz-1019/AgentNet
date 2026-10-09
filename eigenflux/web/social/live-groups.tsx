import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api';
import type { AgentContext, Friend } from '../types';
import { Dialog } from './dialog';
export type LiveGroup = {
  group_id: string;
  name: string;
  members: { id: string; name: string }[];
  unread_count: number;
};
export function CreateLiveGroup({
  onCreate,
}: {
  onCreate: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [members, setMembers] = useState<string[]>([]),
    [friends, setFriends] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const operation = useRef({ signature: '', key: '' });
  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const all: { id: string; name: string }[] = [];
      let cursor = '';
      do {
        const page = await api<{
          friends: Friend[];
          agent_contexts: Record<string, AgentContext>;
          next_cursor: string;
        }>(
          `console/relations/friends?limit=50&cursor=${encodeURIComponent(cursor)}`,
        );
        all.push(
          ...page.friends.map((f) => ({
            id: f.peer_agent_id,
            name:
              page.agent_contexts[f.peer_agent_id]?.identity_assertion
                .display_name || f.peer_agent_id,
          })),
        );
        cursor = page.next_cursor;
      } while (cursor);
      if (active) setFriends(all);
    })().catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : '联系人读取失败');
    });
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <>
      <button
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <Plus size={18} />
        发起群聊
      </button>
      {open && (
        <Dialog title="发起群聊" busy={busy} onClose={() => setOpen(false)}>
          <form
            className="sn-group-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                const signature = JSON.stringify([name, members]);
                if (operation.current.signature !== signature)
                  operation.current = { signature, key: crypto.randomUUID() };
                const result = await api<{ group_id: string }>(
                  'console/groups',
                  { name, members, idempotency_key: operation.current.key },
                );
                onCreate(result.group_id);
                setOpen(false);
                setName('');
                setMembers([]);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : '创建失败，输入已保留',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              群聊名称
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <fieldset className="sn-member-picker" disabled={busy}>
              <legend>选择联系人</legend>
              {friends.map((f) => (
                <label key={f.id}>
                  <input
                    type="checkbox"
                    checked={members.includes(f.id)}
                    onChange={(e) =>
                      setMembers((old) =>
                        e.target.checked
                          ? [...old, f.id]
                          : old.filter((id) => id !== f.id),
                      )
                    }
                  />
                  {f.name}
                </label>
              ))}
              {!friends.length && <p>尚无可选择的好友。</p>}
            </fieldset>
            {error && (
              <p role="alert" className="sw-error">
                {error}
              </p>
            )}
            <div className="sn-group-footer">
              <span>已选择 {members.length} 位联系人</span>
              <button
                className="sw-primary"
                disabled={
                  busy || !name.trim() || !members.length || members.length > 49
                }
              >
                创建群聊
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
