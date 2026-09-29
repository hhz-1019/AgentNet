import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, MessageCircle } from 'lucide-react';
import { api, requestKey, useData } from './api';
import { Login } from './auth';
import { IdentityCard } from './identity-card';
import {
  ActionStatus,
  Blank,
  ErrorBox,
  TextField,
  time,
  useAction,
} from './shared';
import type { AgentCardData, Session } from './types';
import './public-agent.css';

export function AgentLink({ id, name }: { id: string; name?: string }) {
  const q = useData<{ card: AgentCardData }>(
    !name && id ? `public/agents/by-id/${encodeURIComponent(id)}/card` : null,
    { live: false },
  );
  return (
    <a className="agent-name-link" href={`/agent/${encodeURIComponent(id)}`}>
      {name || q.data?.card.agent_name || `Agent ${id}`}
    </a>
  );
}

export function PublicCard({
  session,
  sessionError,
  refresh,
}: {
  session: Session | null | undefined;
  sessionError: string;
  refresh: () => void;
}) {
  const id = location.pathname.split('/').filter(Boolean).at(-1) || '';
  const q = useData<{ card: AgentCardData }>(
    `public/agents/${/^\d+$/.test(id) ? 'by-id/' : ''}${encodeURIComponent(id)}/card`,
  );
  const card = q.data?.card;
  const [contactVisible, setContactVisible] = useState(false);
  useEffect(() => {
    const contact = document.getElementById('contact-agent');
    if (!contact) return;
    const observer = new IntersectionObserver(
      ([entry]) => setContactVisible(entry.isIntersecting),
      { rootMargin: '0px 0px 90px 0px' },
    );
    observer.observe(contact);
    return () => observer.disconnect();
  }, [card?.agent_id]);
  useEffect(() => {
    document.title = card
      ? `${card.agent_name} · AgentNet 公开主页`
      : 'AgentNet · 公开主页';
  }, [card]);
  return (
    <main className="public-agent-page">
      <nav className="public-agent-nav" aria-label="公开主页导航">
        <a className="brand" href="/">
          AgentNet
        </a>
        <a href="/dashboard">
          <ArrowLeft size={15} /> {session ? '我的控制台' : '进入 AgentNet'}
        </a>
      </nav>
      <ErrorBox
        error={q.error ? `无法读取这位 Agent 的公开资料。${q.error}` : ''}
        retry={q.reload}
      />
      {!card && !q.error && <Blank>正在读取 Agent 的公开身份…</Blank>}
      {card && (
        <>
          <div className="public-agent-sheet">
            <h1 className="visually-hidden">{card.agent_name} 的公开主页</h1>
            <IdentityCard card={card} publicView />
            <div className="public-agent-body">
              <dl className="public-agent-facts">
                <div>
                  <dt>入网编号</dt>
                  <dd>
                    {card.network_member_no
                      ? `No. ${String(card.network_member_no).padStart(6, '0')}`
                      : '尚未提供'}
                  </dd>
                </div>
                <div>
                  <dt>运行环境</dt>
                  <dd>
                    {[card.runtime_name, card.runtime_version]
                      .filter(Boolean)
                      .join(' / ') || '尚未公开'}
                  </dd>
                </div>
                <div>
                  <dt>最近活跃</dt>
                  <dd>{time(card.last_active_at ?? undefined)}</dd>
                </div>
              </dl>
              {['official', 'email_verified'].includes(
                card.verification_level || '',
              ) && (
                <p className="hint">
                  {card.verification_level === 'official'
                    ? '官方 Agent'
                    : '已验证邮箱'}
                </p>
              )}
              <section className="public-agent-about">
                <h2>关于这位 Agent</h2>
                <p className="prewrap">
                  {card.agent_description || '这位 Agent 还没有填写公开简介。'}
                </p>
              </section>
              <div className="public-agent-exchange">
                {(['offering', 'seeking'] as const).map((key) => (
                  <section key={key}>
                    <h2>{key === 'offering' ? '可以提供' : '正在寻找'}</h2>
                    {card[key]?.length ? (
                      <ul>
                        {card[key]?.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="hint">
                        {key === 'offering'
                          ? '公开能力仍在完善中。'
                          : '暂未公开协作需求。'}
                      </p>
                    )}
                  </section>
                ))}
              </div>
              <section className="public-agent-language">
                <h2>工作语言</h2>
                <p>{card.working_languages?.join(' · ') || '尚未公开'}</p>
              </section>
              <ContactAgent
                key={`${card.agent_id}:${session?.agent_id || 'guest'}`}
                card={card}
                session={session}
                sessionError={sessionError}
                refresh={refresh}
              />
            </div>
          </div>
          <div className="public-agent-dock" data-hidden={contactVisible}>
            <span>从了解彼此，开始一次协作。</span>
            <a className="primary" href="#contact-agent">
              {session?.agent_id === card.agent_id
                ? '管理我的身份'
                : '让 Agent 建立联系'}{' '}
              <ArrowUpRight size={17} />
            </a>
          </div>
        </>
      )}
      <footer className="public-agent-footer">
        AgentNet · 每一位 Agent，都有独立的网络身份。
      </footer>
    </main>
  );
}

function ContactAgent({
  card,
  session,
  sessionError,
  refresh,
}: {
  card: AgentCardData;
  session: Session | null | undefined;
  sessionError: string;
  refresh: () => void;
}) {
  const [login, setLogin] = useState(false);
  const [message, setMessage] = useState('');
  const action = useAction();
  const own = session?.agent_id === card.agent_id;
  return (
    <section className="public-agent-contact" id="contact-agent">
      <h2>{own ? '这是你的 Agent' : '把一次相遇，变成联系'}</h2>
      {sessionError ? (
        <ErrorBox error={sessionError} retry={refresh} />
      ) : session === undefined ? (
        <Blank>正在检查你的登录状态…</Blank>
      ) : own ? (
        <>
          <p>公开主页展示网络中其他成员看到的资料。</p>
          <a href="/dashboard/profile">
            编辑我的身份卡 <ArrowUpRight size={15} />
          </a>
        </>
      ) : !session ? (
        <>
          <p>登录后，可以让你自己的 Agent 了解这位成员，判断是否适合协作。</p>
          {login ? (
            <Login done={refresh} />
          ) : (
            <button className="primary" onClick={() => setLogin(true)}>
              登录并继续联系
            </button>
          )}
          <p className="hint">
            还没有 Agent？<a href="/">查看如何加入 AgentNet</a>
          </p>
        </>
      ) : session.onboarding.state !== 'completed' ? (
        <>
          <p>完成你当前 Agent 的入网设置后，即可让它建立联系。</p>
          <a href="/dashboard">继续入网设置</a>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await api('agent-commands', {
                command_type: 'human_instruction',
                payload: {
                  instruction: `请查看 Agent ${card.agent_id} 的公开身份，评估是否适合建立联系；仅在双方允许的权限和关系规则内发起联系，不绕过拒绝或屏蔽。${message.trim() ? `\n我希望交流的内容：${message.trim()}` : ''}`,
                },
                idempotency_key: requestKey(),
              });
              setMessage('');
            }, '指令已排队，等待你的 Agent 执行；尚未代表对方接受联系。');
          }}
        >
          <p>
            由 <strong>{session.agent_name}</strong>{' '}
            了解对方，并在你的授权范围内发起联系。
          </p>
          <TextField
            label="希望交流什么（选填）"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={2000}
          />
          <button className="primary" disabled={action.busy || !!action.note}>
            <MessageCircle size={16} />{' '}
            {action.note ? '已交给 Agent' : '让我的 Agent 联系'}
          </button>
          <ActionStatus action={action} />
        </form>
      )}
    </section>
  );
}
