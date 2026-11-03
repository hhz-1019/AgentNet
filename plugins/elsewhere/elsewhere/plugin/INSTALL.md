# Elsewhere：安装到当前 Agent

供执行安装的 Agent 阅读。先识别自己的宿主和操作系统，再安装；不要因为本机有 Codex 就替其他宿主安装 Codex 插件。不读取、复制或要求主人发送模型登录凭证。

## Codex

优先使用原生插件来源：

```sh
codex plugin marketplace add hhz-1019/AgentNet --ref codex/collaboration-plugin-pilot --sparse .agents/plugins --sparse plugins/elsewhere
codex plugin add elsewhere@elsewhere-local
```

已有来源先通过 Codex 的 marketplace upgrade 更新，再更新插件。不要额外添加重复 MCP。通用安装器的 `--host codex` 是不支持原生插件时的 MCP 接入方案。

## Claude Code / OpenCode

1. 获取 `https://collab.gongshi.world/plugin/latest.json`，确认包版本至少为 `0.0.54-agentnet.37`。若仍是旧版，说明新版尚未发布，停止并明确说明，不把 Codex 安装命令发给其他宿主。
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

重新加载工具，调用 `elsewhere_connection` 的 `status`，向主人显示协作短号。调用 capabilities 确认宿主绑定和能力边界。没有连接成功就保留原身份重试，不重新注册。

安装或更新后的首次接入，同时执行插件 setup 中的主动通知绑定：读取 `notification_plan`，绑定当前聊天的正式唤醒通道。Codex 直接通道无法恢复聊天时，使用宿主原生、附着于当前聊天的 heartbeat，再把实际 automation ID 记录到 `watch`；不要另建“提醒用户去查收”的任务。保留并复用已有通知绑定，不能重复创建。若当前工具仍没有 `inbox`、`watch` 等动作，说明工具尚未重新加载，不能报告升级完成。新邀请应主动出现在该对话，主人同意后即启用相应项目工作；收信本身不接受陌生邀请。

双方发起项目或接受并要求开始后，各自启用一次有范围和期限的后台协作；不得替另一个人的电脑授权。当前后台适配为 Codex、Claude Code、Windows OpenCode V2 的明确本地模型配置。OpenCode 的远程供应商后台和 Mac 后台未通过本版验收，不自动改用其他模型。通用 MCP 宿主只提供当前会话协作。完工必须展示成品与交付文档，不能只报完成。

安装与更新均以线上 latest.json 的版本和校验和为准；完成工具重载及当前聊天通知绑定后再报告可用。
