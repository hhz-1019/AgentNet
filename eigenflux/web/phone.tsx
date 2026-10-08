import { useEffect, useState } from 'react';
import { api, refreshData, useData } from './api';
import { ActionStatus, ErrorBox, Field, useAction } from './shared';

export function usePhoneVerification() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const tick = () =>
      setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  return {
    phone,
    code,
    challenge,
    seconds,
    setPhone: (value: string) => {
      setPhone(value);
      setChallenge('');
      setCode('');
    },
    setCode,
    reset: () => {
      setPhone('');
      setCode('');
      setChallenge('');
    },
    send: async (purpose: 'register' | 'bind') => {
      const result = await api<{ challenge_id: string; retry_after: number }>(
        'auth/phone/challenges',
        { phone, purpose },
      );
      setChallenge(result.challenge_id);
      setCode('');
      setRetryAt(Date.now() + result.retry_after * 1000);
      setSeconds(result.retry_after);
    },
    payload: { phone, code, challenge_id: challenge },
  };
}

export function PhoneFields({
  verification,
  purpose,
  busy,
}: {
  verification: ReturnType<typeof usePhoneVerification>;
  purpose: 'register' | 'bind';
  busy: boolean;
}) {
  const action = useAction();
  return (
    <>
      <Field
        label="手机号"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required
        pattern={'(?:\\+86)?1[3-9][0-9]{9}'}
        maxLength={14}
        placeholder="中国大陆手机号"
        value={verification.phone}
        disabled={busy || action.busy}
        onChange={(e) => verification.setPhone(e.target.value)}
      />
      <div className="phone-code-row">
        <Field
          label="短信验证码"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="6 位验证码"
          value={verification.code}
          onChange={(e) => verification.setCode(e.target.value)}
        />
        <button
          type="button"
          disabled={
            busy ||
            action.busy ||
            verification.seconds > 0 ||
            !/^(?:\+86)?1[3-9]\d{9}$/.test(verification.phone.trim())
          }
          onClick={() =>
            void action.run(
              () => verification.send(purpose),
              '验证码已发送，5 分钟内有效',
            )
          }
        >
          {action.busy
            ? '发送中…'
            : verification.seconds > 0
              ? `${verification.seconds} 秒后重发`
              : '获取验证码'}
        </button>
      </div>
      <ActionStatus action={action} />
    </>
  );
}

export function PhoneBinding({ uid }: { uid: string }) {
  const status = useData<{ verified: boolean; masked_phone: string }>(
    'auth/phone/binding',
    { live: false },
  );
  const verification = usePhoneVerification();
  const [password, setPassword] = useState('');
  const action = useAction();
  return (
    <section className="phone-binding">
      <h2>手机号验证</h2>
      <ErrorBox error={status.error} retry={status.reload} />
      {status.data?.verified ? (
        <p>已验证 · {status.data.masked_phone}</p>
      ) : status.data ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api('auth/phone/binding', {
                uid,
                password,
                ...verification.payload,
              });
              setPassword('');
              verification.reset();
              status.reload();
              refreshData();
            }, '手机号已绑定');
          }}
        >
          <p>一个手机号可绑定一个账号。</p>
          <PhoneFields
            verification={verification}
            purpose="bind"
            busy={action.busy}
          />
          <Field
            label="账号密码"
            type="password"
            required
            maxLength={72}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="primary"
            disabled={action.busy || !verification.challenge}
          >
            验证并绑定
          </button>
          <ActionStatus action={action} />
        </form>
      ) : (
        <p>正在读取验证状态…</p>
      )}
    </section>
  );
}
