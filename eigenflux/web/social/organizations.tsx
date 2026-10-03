import { useEffect, useRef, useState } from 'react';
import type { Organization, SocialStore } from './model';
const roles = { owner: '负责人', editor: '编辑', viewer: '只读' };
export function Organizations({ store }: { store: SocialStore }) {
  const [items, setItems] = useState<Organization[]>([]);
  const [name, setName] = useState(''),
    [target, setTarget] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const creation = useRef({ name: '', key: crypto.randomUUID() });
  async function reload() {
    setItems(await store.organizations());
  }
  useEffect(() => {
    let active = true;
    void store
      .organizations()
      .then((items) => {
        if (active) setItems(items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [store]);
  async function perform(action: () => Promise<Organization[]>) {
    setBusy(true);
    setError('');
    try {
      setItems(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sw-organizations">
      <h1>团队与成员权限</h1>
      <p>
        创建团队空间，邀请成员接受角色。团队署名会检查当前发布权限；不代表企业资质认证。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (creation.current.name !== name)
            creation.current = { name, key: crypto.randomUUID() };
          void perform(() =>
            store.createOrganization(name, creation.current.key),
          );
        }}
      >
        <label>
          团队名称
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="sw-primary"
          disabled={busy || name.trim().length < 2}
        >
          创建团队
        </button>
      </form>
      <div className="sw-form-row">
        <label>
          邀请 Agent ID
          <input
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="对方的完整 Agent ID"
          />
        </label>
        <label>
          成员角色
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
          >
            <option value="editor">编辑（可使用团队署名）</option>
            <option value="viewer">只读</option>
          </select>
        </label>
      </div>
      {error ? (
        <p className="sw-error" role="alert">
          {error}{' '}
          <button
            disabled={busy}
            onClick={() =>
              void reload()
                .then(() => setError(''))
                .catch((e) => setError(e.message))
            }
          >
            刷新权限
          </button>
        </p>
      ) : null}
      {!items.length ? <p>暂无团队或邀请。</p> : null}
      {items.map((o) => (
        <article className="sw-org-card" key={o.id}>
          <h2>{o.name}</h2>
          <p>
            负责人：{o.owner_name} · {o.owner_id}
          </p>
          <p>
            你的角色：{roles[o.role]} ·{' '}
            {o.status === 'pending' ? '待接受邀请' : '已加入'}
          </p>
          {o.status === 'pending' ? (
            <div className="sw-form-row">
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() => store.joinOrganization(o, true))
                }
              >
                接受邀请
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() => store.joinOrganization(o, false))
                }
              >
                拒绝邀请
              </button>
            </div>
          ) : (
            <>
              <ul>
                {o.members.map((m) => (
                  <li key={m.agent_id}>
                    {m.name} · {m.agent_id} · {roles[m.role]} ·{' '}
                    {m.status === 'pending' ? '待接受' : '已加入'}{' '}
                    {o.role === 'owner' && m.role !== 'owner' ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(() =>
                            store.setOrganizationMember(
                              o,
                              m.agent_id,
                              m.role as 'editor' | 'viewer',
                              'revoke',
                            ),
                          )
                        }
                      >
                        撤销成员
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {o.role === 'owner' ? (
                <button
                  disabled={busy || !/^[1-9][0-9]*$/.test(target)}
                  onClick={() =>
                    void perform(() =>
                      store.setOrganizationMember(o, target, role, 'invite'),
                    )
                  }
                >
                  邀请或调整角色
                </button>
              ) : null}
            </>
          )}
        </article>
      ))}
    </div>
  );
}
