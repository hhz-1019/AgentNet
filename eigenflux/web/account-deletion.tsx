import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ActionStatus, Field, useAction } from './shared';
import './account-deletion.css';

export interface DeletionPreview {
  account: string;
  agents: number;
  posts: number;
  messages: number;
  memories: number;
}

export function AccountDeletion({
  account,
  preview,
}: {
  account: string;
  preview?: DeletionPreview;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DeletionPreview>();
  const [loadError, setLoadError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useAction();
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    let active = true;
    setSummary(undefined);
    setLoadError('');
    void (
      preview
        ? Promise.resolve(preview)
        : api<DeletionPreview>('console/account')
    )
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            error instanceof Error ? error.message : '无法读取账号，请重新打开',
          );
      });
    return () => {
      active = false;
    };
  }, [open, preview]);
  function close() {
    if (action.busy) return;
    dialog.current?.close();
    setOpen(false);
    setPassword('');
    setConfirmation('');
    setAccepted(false);
  }
  const matches =
    summary?.account === account && confirmation.trim() === account;
  return (
    <div className="account-deletion">
      <button className="account-delete-link" onClick={() => setOpen(true)}>
        注销账号
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby="delete-account-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!matches || !accepted || !password || preview) return;
              void action.run(async () => {
                const receipt = await api<{ deleted: boolean }>(
                  'console/account',
                  { account, password, confirm: accepted },
                  'DELETE',
                );
                if (!receipt.deleted)
                  throw new Error('未收到注销成功确认，请重新检查账号状态');
                setPassword('');
                location.assign('/dashboard?account_deleted=1');
              });
            }}
          >
            <h2 id="delete-account-title">永久注销账号 {account}</h2>
            <p>
              资料、记忆、帖子、消息和关系将被删除，所有设备与 Agent
              连接将失效。此操作无法撤销。
            </p>
            {summary && (
              <p className="deletion-counts">
                {summary.agents} 个 Agent · {summary.posts} 条帖子 ·{' '}
                {summary.messages} 条消息 · {summary.memories} 条画像记忆
              </p>
            )}
            {!summary && !loadError && <output>正在核对账号…</output>}
            {loadError && <p role="alert">{loadError}</p>}
            {summary && summary.account !== account && (
              <p role="alert">当前账号已切换，请关闭后重新打开。</p>
            )}
            <p className="deletion-note">
              手机号解除绑定后可重新注册。旧账号号码不再使用；搜索缓存将在后台清理。
            </p>
            <Field
              label="确认账号号码"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              disabled={action.busy}
              required
            />
            <Field
              label="当前账号密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={72}
              disabled={action.busy}
              required
            />
            <label className="deletion-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={action.busy}
              />
              我确认永久删除此账号及关联数据
            </label>
            <ActionStatus action={action} />
            {preview && <output>本地预览，不会删除账号。</output>}
            <div className="deletion-actions">
              <button type="button" onClick={close} disabled={action.busy}>
                保留账号
              </button>
              <button
                className="deletion-confirm"
                type="submit"
                disabled={
                  action.busy ||
                  !summary ||
                  !matches ||
                  !accepted ||
                  !password ||
                  !!preview
                }
              >
                {action.busy ? '正在注销…' : '永久注销'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
