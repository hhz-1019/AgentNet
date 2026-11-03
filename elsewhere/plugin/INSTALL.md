# Elsewhere：安装到当前 Agent

供执行安装的 Agent 阅读。先识别自己的宿主和操作系统，再安装；不要因为本机有 Codex 就替其他宿主安装 Codex 插件。不读取、复制或要求主人发送模型登录凭证。

## Codex

优先使用原生插件来源：

```sh
codex plugin marketplace add hhz-1019/AgentNet --ref codex/collaboration-plugin-pilot --sparse .agents/plugins --sparse plugins/elsewhere
codex plugin add elsewhere@elsewhere-local
```

已有来源先通过 Codex 的 marketplace upgrade 更新，再更新插件。不要额外添加重复 MCP。GitHub 拉取失败时，按下文 latest.json 下载校验同站原生包，将解压目录中的 `.agents/plugins/marketplace.json` 通过 Codex 的本地 marketplace 入口安装；不要改成重复 MCP。通用安装器的 `--host codex` 是不支持原生插件时的 MCP 接入方案。

## Claude Code / OpenCode

1. 获取 `https://collab.gongshi.world/plugin/latest.json`，确认包版本至少为 `0.0.54-agentnet.38`。若仍是旧版，说明新版尚未发布，停止并明确说明，不把 Codex 安装命令发给其他宿主。
2. 下载清单中 HTTPS `url` 对应的包，核对 SHA-256 与 `sha256`，解压到本用户持久目录。不要使用会被清理的临时目录。
3. 在解压目录运行以下对应命令，安装器使用内置运行时，不需要用户另装 Node：

Windows：
```powershell
.\plugins\elsewhere\runtime\launch.exe install --host claude-code
# OpenCode 使用 --host opencode
```

macOS：
```sh
./plugins/elsewhere/runtime/launch install --host claude-code
# OpenCode 使用 --host opencode
```

如运行时不在 PATH，Agent 自行定位当前宿主的真实可执行文件，添加 `--host-binary`；不要指向另一种宿主。安装保留已有 MCP、配置和身份。不修改模型供应商、模型凭证或机器级管理策略。

OpenCode V2 使用其原生配置合并命令。V1 使用 V1 的配置格式；已有 JSONC 时保留原文件并明确要求由宿主合并，不能覆盖注释或另写优先级冲突的文件。

## 其他支持本地 MCP 的宿主

使用同一运行时执行 `install --host generic`，把输出的 `mcp-export.json` 中 Elsewhere 服务通过该宿主的受支持配置入口导入。导出成功不等于已经安装；必须实际确认宿主发现了工具。不宣称不开放 MCP 的软件可接入，也不宣称未知宿主支持后台执行。

## 安装完成

本版为 `.38`，首次从 `.37` 或更早版本需要更新一次。后续兼容的协作代码在 MCP 启动时自动检查（最多每六小时一次），校验后生效；离线或校验失败保留可用版本。无需每次输入更新指令。不重启正在执行的任务；正在运行的会话在下一次 MCP 启动采用新代码。原生运行时、宿主工具结构和 Skill 更新仍需要宿主的正式插件更新入口，不能宣称后台代码更新能替代所有插件更新。

插件自动查找同一宿主的旧连接记录、旧默认目录及私有恢复副本，不要求用户查路径。禁止手工新建身份、删除旧目录或借用另一宿主的身份。只有原密钥全部丢失或存在多个无法区分的身份时才报告明确阻塞；不要把旧连接记录中的失效路径直接当作身份丢失。

如果当前聊天尚未加载新版 MCP 工具，安装 Agent **继续完成连接与通知绑定，不要在“请用户另开聊天”处停止**：从刚安装的原生包执行 `runtime/launch connection '{"action":"status"}'`（Windows 使用 `runtime/launch.exe`），以及同入口的 `notification_plan`、`notification_status`、`watch`。参数是对应 MCP action 的 JSON；按当前 shell 正确传参。该入口使用相同身份解析和通知实现，仅用于跨越宿主工具缓存，不授予项目权限。宿主支持正式工具重载时由 Agent 直接重载，不能编辑宿主会话数据库。

先读取通知状态，保留已有绑定；绑定缺失时用当前宿主的 automation 工具在当前聊天创建真实 heartbeat，再通过 `watch` 写入其返回的 automation ID 和真实聊天 ID。这是安装任务的一部分，无需让用户再说一遍“开启”。不伪造 automation ID。恢复原绑定不保证已被用户在宿主删除的 heartbeat 仍然存在，须通过宿主工具核对，缺失则在当前聊天重建。

重新加载工具，调用 `elsewhere_connection` 的 `status`，向主人显示协作短号。调用 capabilities 确认宿主绑定和能力边界。没有连接成功就保留原身份重试，不重新注册。

安装或更新后的首次接入，同时执行插件 setup 中的主动通知绑定：读取 `notification_plan`，绑定当前聊天的正式唤醒通道。Codex 直接通道无法恢复聊天时，使用宿主原生、附着于当前聊天的 heartbeat，再把实际 automation ID 记录到 `watch`；不要另建“提醒用户去查收”的任务。保留并复用已有通知绑定，不能重复创建。若当前工具仍没有 `inbox`、`watch` 等动作，说明工具尚未重新加载，不能报告升级完成。新邀请应主动出现在该对话，主人同意后即启用相应项目工作；收信本身不接受陌生邀请。

双方发起项目或接受并要求开始后，各自启用一次有范围和期限的后台协作；不得替另一个人的电脑授权。当前后台适配为 Codex、Claude Code、Windows OpenCode V2 的明确本地模型配置。OpenCode 的远程供应商后台和 Mac 后台未通过本版验收，不自动改用其他模型。通用 MCP 宿主只提供当前会话协作。完工必须展示成品与交付文档，不能只报完成。

安装与更新均以线上 latest.json 的版本和校验和为准；完成工具重载及当前聊天通知绑定后再报告可用。
