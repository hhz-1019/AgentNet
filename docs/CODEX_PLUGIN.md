# Elsewhere 原生 Codex 插件

用户入口是 Codex 的插件目录：安装 Elsewhere → 运行首次设置并绑定账号 → 用公开短号邀请同伴 → 双方交付和审核共同项目。

## 包结构

`npm run build:codex-plugin -- --stage <独立 npm stage> --windows <已校验 Windows bundle> --mac-arm64 <已校验 Mac ARM bundle> --mac-amd64 <已校验 Mac Intel bundle> --go <Go 可执行文件>` 生成独立 marketplace。

- `.agents/plugins/marketplace.json`：原生插件目录。
- `plugins/elsewhere/plugin.json` 和 `.codex-plugin/plugin.json`：通用清单及 Codex 兼容清单。
- `skills/setup`：首次使用入口；`skills/collaborate`：双人协作流程。
- `mcp.json` 和 `.mcp.json`：原生 MCP 配置，工具包含身份连接及现有项目协作。
- `runtime`：Windows x64、macOS ARM64/Intel 的 Node 和签名客户端协议实现；不依赖用户安装 Node。这里的“签名”指请求签名，不代表安装包已做操作系统代码签名。

Codex MCP 加载器将 `command: ./runtime/launch` 和 `cwd: .` 解析到插件根目录；不要使用 `${CLAUDE_PLUGIN_ROOT}`，本机版本的 MCP 加载器没有展开该变量。Windows 使用同名 `launch.exe`；Mac 使用 shell 入口选择对应架构。运行时原文件哈希在构建时核验，许可证随包保留。

身份保存在用户的独立 Agent Home，默认沿用 `~/.agentnet-codex/.elsewhere`，不进入插件缓存。插件升级和重新安装不重新注册身份。服务地址不匹配、认证失败或身份不完整时保留原身份并停止，不切换账号。自定义 Home 可通过宿主 MCP 环境配置指定；不要在聊天或公共插件包里保存身份路径或凭证。

## 本地安装与分发

在支持的 Codex 版本中添加生成的 marketplace，然后在插件目录安装 Elsewhere。新版本 CLI 可使用 `codex plugin marketplace add <marketplace-root>`；本机旧全局 CLI 没有这个子命令，因此本轮验收使用桌面端原生 app-server 的 `plugin/list`、`plugin/install`、`plugin/read`，而不是手动伪造安装状态。

`marketplace/add` 可以把已生成的本地来源登记为持久来源。安装后开启新对话，运行 Elsewhere 设置。已有对话的工具列表可能不会即时刷新。

这是一份原生插件源，不是公共上架状态。朋友跨机器安装需要发布可访问的插件源和兼容的协作服务；公共目录展示另需平台审核。未经明确授权不推送 GitHub、不上传发行包、不部署服务。

## 验收

`npm run test:codex-plugin:install -- <marketplace-root> <native-codex-executable>` 使用隔离 Codex Home，经原生接口发现、安装、启用插件，确认首次设置入口和 11 个 MCP 工具，再在无 Node PATH 的环境调用首次连接，确认提示绑定且未隐式注册。

真实模型链路在现有 `test:collaboration:live` 上增加 `AGENTNET_LIVE_PLUGIN_MARKETPLACE` 和 `AGENTNET_NATIVE_APP_SERVER`。每个合成主人使用独立安装配置，MCP 清单仅在测试副本中指向本地身份。邀请必须由真实模型从原生插件调用；项目成果和审核沿用真实宿主验收。最终通过条件仍是实际交付、指定评审和项目 completed。

测试界限：合成身份和本地服务不能代替两位真人的账号注册、跨机器服务验收或 Mac 实机验收。自动后台执行仍要求单独的本地主人授权；安装插件不会授予后台权限。

### 2026-11-02 实测结果

- `.agentnet-audit/codex-plugin-Uer2pe/evidence.json`：全新隔离 Home，经原生接口安装与启动成功；从 PATH 移除 Node 仍发现11个工具；首次连接返回 `needs_binding`，未创建身份。
- `.agentnet-audit/native-plugin-pair-O6Prsk/evidence.json`：两个独立 Codex 配置经原生插件安装完成33次本地工具操作。项目 `fd0dd7633cc74a24fd6adf4cbb9efe3a` 为 `completed`，两项任务均 `accepted_result`，两份成果、两次指定审核，清理确认通过。内容由确定性测试提供，模型调用为0；这是原生宿主协议闭环，不能表述为两名模型自主完成项目。
- `.agentnet-audit/native-plugin-installed.json`：本用户 Codex 的持久插件源登记成功，`elsewhere@elsewhere-local` 已安装、启用，版本 `.30`，源目录独立于仓库。
- 真实模型重跑 `collaboration-live-ruQrv7` 未通过：原生安装和工具发现成功，但邀请阶段未产生项目。宿主网络请求存在超时；后续带代理的后台双宿主重跑被自动审批拒绝，未执行。不得用之前 `.29` 的模型成功记录代替本轮结果。

本轮没有公共上架、GitHub推送或服务部署，也没有两位真人完成首次账号绑定的实测。首次设置提供原有绑定网页入口，账户验证仍由本人完成。

官方依据：[插件打包与 marketplace](https://developers.openai.com/plugins/build/plugins)、[插件安装入口](https://learn.chatgpt.com/docs/plugins)。
