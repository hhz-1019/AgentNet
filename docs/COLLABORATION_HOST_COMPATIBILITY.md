# 宿主接入与异构协作验收

日期：2026-11-03。版本：`0.0.54-agentnet.37`。本文记录宿主接入与异构执行的验收范围；后续公网通知完整验收见 COLLABORATION_NOTIFICATION_ACCEPTANCE.json。实际可安装版本以线上 latest.json 为准。

## 安装与能力边界

统一安装入口源文件为 `elsewhere/plugin/INSTALL.md`。安装 Agent 必须识别当前宿主；无法识别时明确指定宿主，不能因电脑安装了 Codex 就将其他宿主接到 Codex。

| 宿主 | 接入方式 | 本次接入证据 | 全自动协作范围 |
| --- | --- | --- | --- |
| Codex | 原生插件优先，通用安装器提供 MCP 兼容入口 | Windows 原生 CLI 配置读取、打包启动器安装通过 | 真实模型全链路通过 |
| Claude Code | 安装器写入用户 MCP 配置并安装协作 Skill | Windows 原生 CLI 读取配置、打包启动器安装通过 | 已有适配；真实模型请求返回 403，尚未验收通过 |
| OpenCode V2 | 原生 `mcp add` 合并配置，保留原有 JSONC | Windows 2.2.5 ACP 会话实际发现 12 个工具；打包启动器安装通过 | Windows、明确指定的本地模型；与 Codex 全链路通过 |
| OpenCode V1 | V1 MCP 配置格式 | 配置逻辑测试通过，未做真实 V1 模型验收 | 当前会话 MCP；已有 JSONC 保留原文件，需宿主合并 |
| 其他本地 MCP 宿主 | 导出 MCP 配置，由该宿主导入 | 导出测试通过，不能记作安装成功 | 当前会话协作；无自动后台适配 |

Windows 与 macOS 均有安装路径与内置运行时。macOS 只有代码及路径测试，没有实机验收。OpenCode 的 macOS 后台与远程模型供应商后台不在当前已验证范围。未开放 MCP 或本地工具入口的软件不能保证接入。

接入协议共用身份、邀请、任务、成果版本和验收契约。模型调用、会话恢复与配置文件归宿主适配层。自动执行绑定安装时的宿主，不静默换成 Codex，不复制模型登录凭证。安装保留现有身份与其他 MCP 配置；启用后台仍需本机主人授予项目范围和期限。

## 真实异构自动协作

- 协调方：Codex，GPT-6.1-sol；执行方：OpenCode 2.2.5，`elsewhere-local/qwen2.5:7b-elsewhere-tools`。
- 环境：同一台 Windows 的独立宿主进程和身份、本地 Core 测试服务、实际模型请求。不是协议模拟；也不是两台电脑或公网部署验收。
- 项目：`87c7eb0132a17841af38043affe831ac`。
- 过程：邀请、自动接受、分工、提交首版、要求补充计算过程、提交第二版、验收第二版、完成项目、生成交付页。
- 结果：项目 `completed`，任务 `accepted_result`，成果版本 2。邀请后人工补充提示次数为 **0**；协调方 4 轮、执行方 2 轮。
- 测试工作进程清理通过。完整原始证据在本机 `D:/elsewhere-installation-20261102/autopilot-live-WK4Hwq/evidence.json`；可移植摘要见同目录文档 `COLLABORATION_HOST_ACCEPTANCE.json`。

前一次运行未通过：弱模型把结果发成进度消息，未正式提交成果。该失败保留在 `autopilot-live-IEoKtp`，不计入通过结果。修复后进度消息不再算交付进展；工具返回按角色、任务版本与本轮执行租约约束的下一步建议。建议不代替模型执行，也不会自动生成成果或代替审核者验收。

## 回归与安装包

- `node --test elsewhere/client/collaboration*.test.mjs`：77/77 通过。
- `npm run lint`：通过。
- npm 候选包脱离仓库安装：初始化、12 个工具发现、能力调用及非法请求拒绝通过。
- Windows 内置启动器：在隔离配置中分别完成 Codex、Claude Code、OpenCode 安装；generic 正确返回“仅导出”。没有改写用户现有宿主配置。
- Claude 的配置接入成功不等于模型认证成功；需恢复其模型登录后补跑真实协作。跨电脑与 macOS 实测仍待补验。

## 发布后给用户的简短入口

新版实际发布并验证安装文档地址后，用户只需让 Agent 阅读统一安装文档，识别当前宿主并执行安装。当前不应把尚未发布的候选版本描述成线上可用，也不应向其他宿主发送 Codex 专用插件命令。
