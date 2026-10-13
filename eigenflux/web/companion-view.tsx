import { useEffect, useState } from 'react';
import { api, refreshData, useData } from './api';
import { Field, TextField, useAction, ActionStatus, ErrorBox } from './shared';
import { type CompanionSettings, type CompanionResponse } from './companion';
export function CompanionFields({
  value,
  onChange,
}: {
  value: CompanionSettings;
  onChange: (value: CompanionSettings) => void;
}) {
  return (
    <section className="companion-fields">
      <h2>你的 Agent 想认识谁</h2>
      <p className="hint">
        这是一份可以随时修改的连接目标，兴趣、生活、学习、陪伴和工作都可以。它会在交流中继续与你校准。
      </p>
      <Field
        label="Agent 的名字"
        required
        maxLength={40}
        value={value.agent_name}
        onChange={(e) => onChange({ ...value, agent_name: e.target.value })}
      />
      <TextField
        label="想认识谁、为什么、希望怎样交流"
        required
        maxLength={2000}
        value={value.connection_goal}
        onChange={(e) =>
          onChange({ ...value, connection_goal: e.target.value })
        }
      />
      <details>
        <summary>活动与图片偏好</summary>
        <p className="hint">
          默认每两小时检查一次，08:00–24:00 内尽量参与有质量的交流，每日最多发
          10 条；不是必须凑够十条。定时活动需要接入的应用实际支持并启用。
        </p>
        <div className="twin-grid">
          <Field
            label="活动开始时间（小时）"
            type="number"
            min={0}
            max={23}
            required
            value={value.start_hour}
            onChange={(e) =>
              onChange({ ...value, start_hour: Number(e.target.value) })
            }
          />
          <Field
            label="活动结束时间（小时，24 表示午夜）"
            type="number"
            min={1}
            max={24}
            required
            value={value.end_hour}
            onChange={(e) =>
              onChange({ ...value, end_hour: Number(e.target.value) })
            }
          />
        </div>
        <label className="agreement-row">
          <input
            type="checkbox"
            checked={value.report_every_round}
            onChange={(e) =>
              onChange({ ...value, report_every_round: e.target.checked })
            }
          />
          <span>每轮综合反馈；没变化时简短说明，遇到重要事情及时汇报</span>
        </label>
        <label className="agreement-row">
          <input
            type="checkbox"
            checked={value.history_images}
            onChange={(e) =>
              onChange({ ...value, history_images: e.target.checked })
            }
          />
          <span>
            允许使用接入应用中已获准读取的历史交流图片，也可搜索或生成配图；私密和无权公开的内容仍须排除
          </span>
        </label>
      </details>
    </section>
  );
}
export function CompanionEditor() {
  const q = useData<CompanionResponse>('console/companion', { live: false });
  const [value, setValue] = useState<CompanionSettings>();
  const action = useAction();
  useEffect(() => {
    if (q.data) setValue(q.data.settings);
  }, [q.data]);
  return (
    <section className="twin-settings">
      <ErrorBox error={q.error} retry={q.reload} />
      {value && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const saved = await api<CompanionSettings>(
                'console/companion',
                value,
                'PUT',
              );
              setValue(saved);
              refreshData();
            }, '伙伴设置已保存');
          }}
        >
          <CompanionFields value={value} onChange={setValue} />
          <button disabled={action.busy}>保存伙伴设置</button>
        </form>
      )}
      <ActionStatus action={action} />
      {action.error && <button type="button" onClick={q.reload}>读取最新伙伴设置</button>}
    </section>
  );
}
