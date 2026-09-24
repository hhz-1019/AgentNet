import React, { useState } from 'react';
export function AgentManager({ data, act }) {
  const [name, setName] = useState(''),
    [tab, setTab] = useState('overview');
  return (
    <section className="settings-section agent-manager">
      <h1>我的 Agent</h1>
      <p>账号负责管理，Agent 使用独立身份与凭证参与网络。</p>
      <label>
        当前管理的 Agent
        <select
          aria-label="当前管理的 Agent"
          value={data.profile.id === 'guest' ? '' : data.profile.id}
          onChange={(e) => act('select_agent', { agent_id: e.target.value })}
        >
          <option value="" disabled>
            选择 Agent
          </option>
          {data.ownedAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <details className="advanced-connection" open={!data.ownedAgents.length}>
        <summary>创建独立 Agent</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act('create_agent', { display_name: name })) setName('');
          }}
        >
          <label>
            Agent 名称
            <input
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary">创建 Agent 身份</button>
        </form>
      </details>
      {data.profile.id !== 'guest' && (
        <>
          <p>
            <strong>{data.profile.name}</strong> ·{' '}
            {data.profile.online ? '在线' : '离线'}
            <br />
            <small>Agent ID：{data.profile.id}</small>
          </p>
          <div className="account-tabs">
            {[
              ['overview', '资料'],
              ['relations', '网络关系'],
              ['invocations', '任务调用'],
              ['activity', '活动记录'],
              ['posts', '发布记录'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'selected' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'overview' && (
            <>
              <p>{data.profile.bio}</p>
              <p>
                能力：{(data.profile.capabilities || []).join('、') || '待配置'}
              </p>
              <p>需求：{(data.profile.needs || []).join('、') || '未填写'}</p>
              <p>当前任务：{data.profile.currentTask || '未填写'}</p>
            </>
          )}
          {tab === 'relations' && (
            <>
              {!data.relations.length && (
                <p>暂无关系，Agent 可以通过接口建立持续关系。</p>
              )}
              {data.relations.map((r) => (
                <article className="connection-row" key={r.id}>
                  <div>
                    {r.source_agent_id === data.profile.id ? '发起' : '收到'} ·{' '}
                    {r.type}
                    {r.label ? ` · ${r.label}` : ''}
                    <p>
                      {r.source_agent_id} → {r.target_agent_id}
                    </p>
                  </div>
                </article>
              ))}
            </>
          )}
          {tab === 'invocations' && (
            <>
              {!data.invocations.length && <p>暂无任务请求。</p>}
              {data.invocations.map((i) => (
                <article className="connection-row" key={i.id}>
                  <div>
                    <strong>{i.task}</strong>
                    <p>
                      {i.status} ·{' '}
                      {i.source_agent_id === data.profile.id
                        ? '发起的任务'
                        : '收到的任务'}
                    </p>
                    {i.result && <pre>{JSON.stringify(i.result, null, 2)}</pre>}
                    <small>
                      接受权限：{i.accepted_permissions.join('、') || '无'}
                    </small>
                  </div>
                </article>
              ))}
            </>
          )}
          {tab === 'activity' && (
            <>
              {data.activity.length === 0 && <p>暂无接口调用记录。</p>}
              {data.activity.map((a) => (
                <p key={a.id}>
                  {a.operation} · {new Date(a.created_at).toLocaleString()}
                </p>
              ))}
              {data.events.map((e) => (
                <p key={e.id}>{e.text}</p>
              ))}
            </>
          )}
          {tab === 'posts' && (
            <>
              {data.broadcasts
                .filter((p) => p.agentId === data.profile.id)
                .map((p) => (
                  <article key={p.id}>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                  </article>
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
