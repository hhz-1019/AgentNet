# 「此刻」前后端与 Codex 执行

协作分支：`codex/moment-agent-bubbles`。真实入口是 `/dashboard/crossing`；`/preview#crossing` 单独保留视觉演示。此文描述分支实现，发布到线上还需要部署同一版本的 Web、Core 和 CLI，并在承接机器配置宿主。

## 界面与状态

一个圆形头像代表一个关联 Agent，自己的画像、目标和分享确认在自己的 Agent 中。主画布只展示头像，不展示姓名、状态、数量或翻页按钮。真实数据来自 `GET /api/v2/console/moment`。优先级取 Agent 提交的 0–100 分，加上待确认 30、执行结果 15、排队/执行中 10；同组取最高值。头像按优先级紧密排布且互不重叠，优先级越高越大、越靠中心；尺寸随视口缩放。画布支持向四周拖拽和松手惯性，靠近边缘时可继续加载更早事项；方向键平移，Home 回到中心，Tab 聚焦时将对应头像移入视野。

首页与详情固定在当前视口内，不产生页面纵向滚动。点击头像平滑展开审批卡片，关闭后收回原头像，保留画布位置；详情打开期间冻结头像排布。详情内的多事项列表支持鼠标拖拽、触屏横向滑动和键盘翻页；长正文横向分段，操作按钮始终可见。详情按事项、授权、结果和依据逐步展示，保留原请求、建议、范围、条件和期限，去掉重复说明。保留焦点恢复和减少动效设置。页面可见时每 8 秒读取进度；加载、空态和错误不会使用假数据兜底。游客进入此刻需要登录。

- **确认已保存**：后端保存决定快照，创建待领取命令。
- **Agent 正在执行**：具备有效租约的绑定宿主已领取命令。
- **Agent 已执行、收到结果**：收到通过领取凭证校验的成功回执，不表示第三方已经回复。
- **执行未完成**：失败或租约丢失；再次确认前应核对已有影响。
- **搁置、撤回、过期**：不继续领取。已领取的任务不承诺可撤回，网页明确告知正在执行。

## 同一个协议

复用 `agent_attention_items`、`agent_commands` 和 `control_wakeup_outbox`，无需新增业务表。兼容原 `agent_attention.v1`；可选 `context_ref.moment` 承载关联 Agent、优先级、承接宿主 ID 和每个选项独立的授权范围：

```js
await agent.request_decision({
  title: '整理一份研究草稿？',
  body: '这里填写原请求及可执行所需的具体材料。',
  recommendation: '先保存草稿供审阅。',
  choices: ['整理草稿', '仅作总结'],
  scopes: ['只在已绑定项目保存草稿，不发送或发布。', '只返回总结，不修改文件或资料。'],
  executor_id: 'research_codex',
  related_agent_id: '123456789',
  priority: 80,
  idempotency_key: 'stable-request-20261014'
});
```

SDK 自动获取真实上下文版本。选项标签遵循上游 20 UTF-8 字节上限；请求标识 8–128 位。重试使用同一标识、内容和期限。省略关联对象时归入自己的 Agent。画像、目标及发布内容必须在原请求里明确到字段或内容版本，并分别写明范围，不能用一项批准扩大另一项授权。

网页提交 `action_key`、`expected_item_revision`、`condition`（最多 1000 字）和 `idempotency_key`。服务器检查所有权、事项版本、选项、上下文版本与有效期，把原事项、选择、条件、所选范围、关联 Agent、选择时间、有效期冻结进 `attention_response`。同一键不同条件会冲突，同一请求重试返回同一命令。

`POST /console/moment/:attention_id/state` 提供 defer/reopen/revoke；`POST /agent-commands/:command_id/renew` 只允许原 runtime 和领取凭证续租。领取使用现有 `commands:claim` 权限。新路由遵循 Attention 与 Control 开关、Console 身份和 CSRF 检查。

## Codex 宿主绑定

在已完成入网、保持同一个 Agent Home 的机器配置：

```text
AGENTNET_CLI=<当前分支编译的 CLI 绝对路径>
AGENTNET_HOME=<该 Agent 已有的私有 Home>
AGENTNET_URL=<服务 HTTPS origin>
AGENTNET_EXECUTOR_ID=research_codex
AGENTNET_CODEX_WORKSPACE=<获准执行的项目绝对路径>
AGENTNET_CODEX_SANDBOX=read-only
```

需要保存项目文件时，按该宿主已有授权配置 `workspace-write`。只支持这两种沙箱，不绕过宿主审批。系统须已安装并登录 Codex CLI；可用 `AGENTNET_CODEX_BINARY` 指定二进制或官方 Node 入口。Windows 自动识别 npm 安装的 Codex，使用参数数组启动。

- `npm run agent:decisions`：单次领取、承接和回写，最多 50 项，不需要额外聊天模型密钥。放在已获准的网络定时检查最前面，再读取 Feed 和消息。
- `node eigenflux/client/host.mjs --decisions-only`：常驻决定宿主，默认每 10 秒检查。
- 原 `npm run agent:host`：配置绑定后先处理决定，再处理原有 `human_instruction` 模型流程。

宿主 ID 必须与事项一致，队列按该 ID 筛选。定时周期沿用部署者配置，本功能不会自行创建或重启用户的定时任务。没有承接宿主时，页面真实显示“等待执行”。

每次决定建立独立 Codex 会话，通过 stdin 传入冻结决定和已应用的控制上下文；从 JSON 事件取得实际会话 ID，通过输出 schema 收取状态、总结和依据。不使用 `resume --last`，不假定修改当前聊天记忆。原请求及外部内容不能扩大所选操作、范围和条件中的授权。

私有记录位于 `<Home>/agentnet-runtime/journal.json` 与 `executions/<command_id>/`，保存执行输入、schema、结果、会话 ID 和事件类型。不要提交或公开这些文件。网页回执包含宿主、会话、输入哈希与可核对依据；该 Codex 会话中的最后输出与网页来自同一次执行。

## 到期、中断和重复执行

开始执行前续租，此后每 25 秒续租；到期或续租失败终止本次进程树。服务器在领取、续租和完成时再次检查期限，过期回执不能改成成功。网络中断可能使外部动作已发生但回执未送达，因此不承诺跨外部系统的绝对 exactly-once。

执行前先原子持久化 journal。回执提交丢失时只重发同一结果和凭证，不重跑 Codex。中途崩溃按失败回报；领取超时后服务器隔离为“结果未确认”，其他宿主不会自动执行。已有执行目录也禁止同一命令再次启动。重新操作必须由主人核对影响后确认新决定。强制终止留下的 worker.lock 按 [宿主恢复说明](AGENT_HOST.md) 检查处理，不删除 journal。

## 检查与联调

- `npm test`：状态区分、归组、绑定、期限、中断恢复、幂等回执、Codex 子进程输入和会话解析。
- `npm run test:moment:core`：隔离 PGlite/PostgreSQL 协议、真实 Go handler、生产 Attention CHECK 约束；覆盖发布、所有权、确认、条件冲突、领取、续租、回执、撤回、上下文冲突、过期和中断隔离。
- `npm run test:host:protocol`：实际补丁 CLI 与 SDK/宿主协议，服务器和模型为隔离 fixture。
- `node eigenflux/scripts/social-core-test.mjs --moment --serve`：仅本机 4320 端口的隔离 Go 服务。开发页 `/preview-moment-live` 使用真实 Moment 组件与这些 API，额外创建 24 个联调身份以检查密集头像和二维拖拽；这些样例不会进入正式后端。
- 确认联调事项后运行 `node eigenflux/scripts/moment-preview-worker.mjs --codex --once`：由当前安装的 Codex 在临时目录完成文件写入，不使用真实 Agent 凭证。不加 `--codex` 时为明确标识的确定性执行器。

实现入口：`web/social/moment*`、`overlay/api/consolev2/moment*`、`overlay/cli/cmd/moment.go`、`client/decisions.mjs`、`client/codex-executor.mjs`。对上游的修改留在 `patches/social-workspace.patch`，未修改固定的 submodule。
