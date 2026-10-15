# 此刻：合并前验收记录

验收日期：2026-10-15。协作分支：`codex/moment-agent-bubbles`。
已将主分支 `2c9e3c6c1e8391e8aa56038606e6dec7bac3f7bc` 合入协作分支；未合并到 main，未部署生产。

## 本次处理

- 整合主分支的账户连接、Companion、头像、社交权限和活动记录，解决 12 处文本冲突。对补丁先展开成上游源码做三方合并，再重新生成补丁，避免拼接出重复 SQL 参数或 CLI 标志。
- 补齐 `/dashboard/crossing` 及其子路径的未登录入口，保留公开发现页面和现有私人页面的登录行为。
- 保留同一套 Attention 和 command 队列。注册 Moment、Companion、头像和社交路由；对审批领取、续租及回执保持执行器绑定和防重复语义。
- 将 `runtime command renew` 登记到能力清单。Web 下载、Core、Host 和安装脚本统一到 CLI `0.0.54-agentnet.14`。
- 修复 Windows 同进程并发心跳读取锁文件时可能阻碍凭证锁删除的问题；保留跨进程文件锁和等待期限，加入原锁测试到协议验收。
- 修复旧 CI 的 npm 锁文件缺项，补全 `@emnapi/core`、`@emnapi/runtime`，空目录干净安装通过。
- 同步主分支新增的 `000133_reconcile_companion_permissions.sql`，避免历史迁移编号冲突导致权限未更新。

## 接口对齐

| 边界 | 当前约定 |
| --- | --- |
| 主页面入口 | 登录用户进入 `/dashboard/crossing`；独立预览仅供开发，不作为真实账号验收 |
| 事项读取 | `GET /api/v2/console/moment`，沿用 Console 登录、所属账户和入网完成校验 |
| 确认 | 沿用 Attention respond；提交事项版本、选项、条件和幂等键，由服务端冻结授权 |
| 保存与执行 | 保存后等待领取，实际执行回执到达后才展示执行结果 |
| 后台执行 | 绑定的宿主先消费 `attention_response`，既有 `human_instruction` 流程继续保留 |
| 当前聊天 | 仅在 MCP Apps 宿主声明消息能力时发送当前聊天输入；发送失败不改投后台，避免重复执行 |
| 续租与回执 | 原执行器、claim token 和 epoch 校验；过期、撤回、失租不能回写成功 |
| 数据库 | Moment 复用已有表；整合版本包含主分支至 000133 的全部迁移 |

详细配置和操作协议见 [MOMENT_HANDOFF.md](MOMENT_HANDOFF.md)。

## 已执行检查

| 检查 | 结果与范围 |
| --- | --- |
| TypeScript、Lint | 通过 |
| `npm test` | 115 项通过，含页面入口、状态归组、当前聊天绑定、决定执行、恢复和主分支权限迁移 |
| `npm run build` | Web 和 MCP 面板均通过；保留现有主包大小提示 |
| npm 干净安装 | 无 node_modules 的独立目录通过；npm 12 补全锁文件后验证安装 |
| `test:moment:core` | 真实 Go handlers + 隔离 PostgreSQL 协议；发布、版本、条件、领取、续租、回执、撤回、到期和隔离通过 |
| `test:host:protocol` | 实际补丁 CLI、SDK 和执行器协议通过；包含 CLI 能力清单和凭证锁测试；服务端及模型为 fixture |
| `test:social:core` | 既有社交、Twin、权限及迁移回滚通过 |
| `test:managed:core` | 完整迁移、账户连接和托管身份回归；包含 Moment 对 Runtime 会话拒绝和对主人会话放行的断言 |
| `test:phone:core` | 手机账户、UID、短信适配协议及安全回滚通过；未发送真实短信 |

## 合并门禁与发布边界

- 远端完整 CI：[合并整合版本验收](https://github.com/hhz-1019/AgentNet/actions/workflows/eigenflux-core.yml?query=branch%3Acodex%2Fmoment-agent-bubbles)。最终以待合并提交对应的最新工作流结果为准；未全绿时不能宣称全部门禁通过。
- 本机没有 Docker；生产镜像构建、网关和整套服务验收由 CI 执行。本地接口测试不等于生产部署成功。
- 本地浏览器预览访问及服务重启被工具策略阻止，本轮未完成本机视觉复验。已有预览地址为 `http://127.0.0.1:4336/preview-moment-live`，不能据此证明其后端已重启到整合版本。
- Codex 桌面中实际点击后向当前聊天送达输入，仍需要在支持 MCP Apps 消息能力、已连接该 MCP 的宿主验收。单纯在普通侧栏中打开 URL 不会自动取得消息权限。
- 发布时需一起更新 Web、Core、CLI/MCP 适配器，并运行主分支全部迁移。后台自动执行还依赖已配置且运行中的授权宿主；不能仅部署网页就视为执行器已上线。
- 不使用真实账号添加好友或发帖来代替隔离验收；本轮没有执行生产社交操作。

本记录说明检查范围，不替代最终提交的 CI 状态或正式环境验收。
