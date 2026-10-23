import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { feedbackMessage } from './feedback-message';
import './account-deletion.css';

const receiptKey = 'elsewhere:account-deletion:receipt';
const progressEvent = 'elsewhere-account-deletion';
const completedKey = 'elsewhere:account-deletion:completed';
function clearPrivateCopies() {
  for (const storage of [localStorage, sessionStorage])
    for (const key of Object.keys(storage))
      if (
        /^(elsewhere:|agentnet:|ef:)/.test(key) &&
        !key.startsWith('elsewhere:entry-') &&
        key !== receiptKey &&
        key !== completedKey
      )
        storage.removeItem(key);
}
type Progress = { status: 'not_started' | 'pending' | 'completed' };
function savedReceipt() {
  try {
    return sessionStorage.getItem(receiptKey) || '';
  } catch {
    return '';
  }
}
function saveReceipt(receipt: string) {
  // Do not send a destructive request if its recovery receipt cannot be saved.
  sessionStorage.setItem(receiptKey, receipt);
}
function forgetReceipt() {
  sessionStorage.removeItem(receiptKey);
}
function status(receipt: string) {
  return api<Progress>('account-deletion/status', { receipt });
}

export function AccountDeletion({
  uid,
  ownerBound,
}: {
  uid: string;
  ownerBound: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function close() {
    if (busy) return;
    dialog.current?.close();
    setPassword('');
    setConfirmation('');
    setError('');
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    let receipt = '';
    try {
      const prepared = await api<{ receipt: string }>(
        'console/account/deletion-receipt',
      );
      receipt = prepared.receipt;
      saveReceipt(receipt);
      await api(
        'console/account',
        { password, confirmation, receipt },
        'DELETE',
      );
      setPassword('');
      dialog.current?.close();
      window.dispatchEvent(new Event(progressEvent));
    } catch (e) {
      if (receipt) {
        try {
          const result = await status(receipt);
          if (result.status !== 'not_started') {
            setPassword('');
            dialog.current?.close();
            window.dispatchEvent(new Event(progressEvent));
            return;
          }
          forgetReceipt();
        } catch {
          setPassword('');
          dialog.current?.close();
          window.dispatchEvent(new Event(progressEvent));
          return;
        }
      }
      setError(feedbackMessage(e, '注销未提交，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()}>
        注销账号
      </button>
      {createPortal(
        <dialog
          className="account-erasure"
          ref={dialog}
          aria-labelledby="account-erasure-title"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <form onSubmit={submit}>
            <h2 id="account-erasure-title">注销账号</h2>
            <p>
              永久删除这个账号及其
              Agent、帖子、消息、创建的群组和组织、资料与记忆。手机号与 账号
              将释放回注册池，重新注册需要重新填写资料。此操作无法撤销。
            </p>
            {ownerBound ? (
              <>
                <label>
                  当前密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={72}
                    value={password}
                    disabled={busy}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  输入 账号 {uid} 确认
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={confirmation}
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <output>请先退出登录，再使用账号密码登录后注销。</output>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="account-erasure-actions">
              <button type="button" disabled={busy} onClick={close}>
                取消
              </button>
              {ownerBound && (
                <button
                  type="submit"
                  className="account-erasure-submit"
                  disabled={busy || !password || confirmation !== uid}
                >
                  {busy ? '正在提交…' : '永久注销'}
                </button>
              )}
            </div>
          </form>
        </dialog>,
        document.body,
      )}
    </>
  );
}

// Sibling of App: receipt polling survives expired sessions and page reloads.
export function AccountDeletionProgress() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [receipt, setReceipt] = useState(savedReceipt);
  const [state, setState] = useState<Progress['status'] | 'unknown'>('unknown');
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => {
      setReceipt(savedReceipt());
      setState('unknown');
    };
    window.addEventListener(progressEvent, sync);
    const erasedElsewhere = (event: StorageEvent) => {
      if (event.key === completedKey && event.newValue) {
        clearPrivateCopies();
        location.reload();
      }
    };
    window.addEventListener('storage', erasedElsewhere);
    return () => {
      window.removeEventListener(progressEvent, sync);
      window.removeEventListener('storage', erasedElsewhere);
    };
  }, []);
  useEffect(() => {
    if (!receipt) return;
    dialog.current?.showModal();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await status(receipt);
        if (stopped) return;
        setState(result.status);
        setError('');
        if (result.status === 'completed') {
          clearPrivateCopies();
          localStorage.setItem(completedKey, String(Date.now()));
        }
        if (result.status !== 'pending') return;
      } catch {
        if (stopped) return;
        setError('暂时无法确认结果，正在重试。请勿重复提交注销。');
      }
      timer = setTimeout(check, 3000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [receipt]);
  function finish() {
    forgetReceipt();
    if (state === 'completed') {
      clearPrivateCopies();
    }
    location.assign('/dashboard');
  }
  if (!receipt) return null;
  return (
    <dialog
      className="account-erasure"
      ref={dialog}
      aria-labelledby="account-erasure-progress"
      onCancel={(e) => e.preventDefault()}
    >
      <h2 id="account-erasure-progress">
        {state === 'completed'
          ? '账号已注销'
          : state === 'not_started'
            ? '注销尚未提交'
            : '正在注销账号'}
      </h2>
      <output>
        {state === 'completed'
          ? '账号数据与记忆已删除，手机号和 账号 已释放。再次注册将创建全新的账号。'
          : state === 'not_started'
            ? '账号仍然保留。返回设置后可重新确认注销。'
            : '正在确认并清理账号数据。完成前手机号和 账号 暂不释放。'}
      </output>
      {error && <p role="alert">{error}</p>}
      {(state === 'completed' || state === 'not_started') && (
        <div className="account-erasure-actions">
          <button type="button" onClick={finish}>
            {state === 'completed' ? '返回登录 / 注册' : '返回设置'}
          </button>
        </div>
      )}
    </dialog>
  );
}
