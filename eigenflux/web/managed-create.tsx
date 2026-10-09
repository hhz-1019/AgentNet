import { useState } from 'react';

type Template = { Name: string; Scenario: string; Persona: string };
export function ManagedCreate({
  templates,
  busy,
  onCancel,
  onSave,
}: {
  templates: Template[];
  busy: boolean;
  onCancel: () => void;
  onSave: (member: {
    name: string;
    scenario: string;
    persona: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [scenario, setScenario] = useState(
    templates[0]?.Scenario || '校园交友',
  );
  const [persona, setPersona] = useState(templates[0]?.Persona || '');
  return (
    <form
      className="managed-create"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          name,
          scenario,
          persona: persona.replaceAll('新角色', name),
        });
      }}
    >
      <header>
        <h2>添加 Agent</h2>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </header>
      <p>
        创建可真实上号的托管账号，自动分配未占用靓号，费用归入当前运营账户。初始暂停。
      </p>
      <div className="managed-create-fields">
        <label>
          公开昵称
          <input
            required
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          主要场景
          <select
            value={scenario}
            onChange={(e) => {
              setScenario(e.target.value);
              setPersona(
                templates.find((t) => t.Scenario === e.target.value)?.Persona ||
                  '',
              );
            }}
          >
            {templates.map((t) => (
              <option key={t.Scenario}>{t.Scenario}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        完整身份档案
        <textarea
          required
          minLength={1001}
          maxLength={6000}
          rows={16}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
      </label>
      <p>
        {Array.from(persona).length} / 6000 字 ·
        模板仅是起点，请为新角色补充独特背景与目标。切换场景会重新载入模板。
      </p>
      <button
        className="managed-primary"
        disabled={busy || Array.from(persona).length < 1001}
      >
        {busy ? '正在创建…' : '创建 Agent'}
      </button>
    </form>
  );
}
