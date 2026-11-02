# Elsewhere 原生 Codex 插件

当前 .32 用户入口：安装 Elsewhere → 首次调用自动连接 → 用短号邀请同伴 → 双方交付和审核项目。无需另行注册或绑定账号。当前安装说明见 [试用说明](CODEX_PLUGIN_TRIAL.md)，以下保留早期版本验收历史。

## 包结构

`npm run build:codex-plugin -- --stage <独立 npm stage> --windows <已校验 Windows bundle> --mac-arm64 <已校验 Mac ARM bundle> --mac-amd64 <已校验 Mac Intel bundle> --go <Go 可执行文件>` 生成独立 marketplace。

- `.agents/plugins/marketplace.json`：原生插件目录。
- `plugins/elsewhere/plugin.json` 和 `.codex-plugin/plugin.json`：通用清单及 Codex 兼容清单。
- `skills/setup`：首次使用入口；`skills/collaborate`：双人协作流程。
- `mcp.json` 和 `.mcp.json`：原生 MCP 配置，工具包含身份连接及现有项目协作。
- `runtime`：Windows x64、macOS ARM64/Intel 的 Node 和签名客户端协议实现；不依赖用户安装 Node。这里的“签名”指请求签名，不代表安装包已做操作系统代码签名。

Codex MCP 加载器将 `command: ./runtime/launch` 和 `cwd: .` 解析到插件根目录；不要使用 `${CLAUDE_PLUGIN_ROOT}`，本机版本的 MCP 加载器没有展开该变量。Windows 使用同名 `launch.exe`；Mac 使用 shell 入口选择对应架构。运行时原文件哈希在构建时核验，许可证随包保留。

当前 .32 安装身份保存在 `~/.elsewhere-collaboration/codex`；旧版身份目录保持原样。身份保存在用户的独立 Agent Home，不进入插件缓存。插件升级和重新安装不重新注册身份。服务地址不匹配、认证失败或身份不完整时保留原身份并停止，不切换账号。自定义 Home 可通过宿主 MCP 环境配置指定；不要在聊天或公共插件包里保存身份路径或凭证。

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

上述 `.30` 阶段没有公共上架、GitHub推送或服务部署，也没有两位真人完成首次账号绑定的实测。首次设置提供原有绑定网页入口，账户验证仍由本人完成。

### `.31` GitHub 分发验收

插件源已发布到 [codex/collaboration-plugin-pilot](https://github.com/hhz-1019/AgentNet/tree/codex/collaboration-plugin-pilot)，朋友入口见 [试用说明](CODEX_PLUGIN_TRIAL.md)。这属于可安装的 GitHub 自定义来源，未声称官方公共目录上架。

- 三个平台的运行时改为自带压缩归档，首次启动按 SHA-256 校验并解压；单个文件均低于 GitHub 100 MB 限制。Mac 归档中的可执行位已核验，未做 Mac 实机测试。
- `.agentnet-audit/codex-plugin-JMJqKX/evidence.json`：Windows 原生安装、11 工具发现、无 Node PATH 启动、首次连接 `needs_binding` 通过；未隐式注册。
- `.agentnet-audit/remote-plugin-MiGKXl/evidence.json`：从 GitHub 提交 `5995bcc66b7eb6e216fbffb3aadd8b2367ff36b9` 实际拉取并经原生接口安装、启用 `.31`，11 工具发现通过；未绑定真实账户。
- 本地协作回归 60 项通过，lint 通过。GitHub CI 与部署分别核验，不以安装通过代替线上服务可用。

真实模型验收使用独立测试插件名称与 MCP 服务名称；在执行模型的原生配置中安装测试插件，完成后关闭拥有的会话再卸载，避免 Windows 已加载可执行文件阻止卸载。仅对合成项目需要的工具临时配置逐工具许可，不修改分发包或用户其他插件的默认授权。

### 当前真实模型完整闭环

`.agentnet-audit/collaboration-live-XDJRzL/evidence.json` 已通过。两个独立 Codex Agent 通过受限 MCP 接入真实本地 Core：实际邀请、接受、计算、交付、交叉审核并完成项目。项目 `927a75c9d2375c0db52fcf4d61744e13` 为 `completed`，两项任务均 `accepted_result`；2 份成果、2 次指定审核、2 次恢复同一个原生会话，清理成功。后台执行记录的模型为 `gpt-6-astra`。

生成的 `order-calculator.html` 在禁止网络的 Playwright 浏览器中通过初始 `73.80`、移除笔记本 `41.40`、空购物篮 `0.00` 三项检查。这次由真实模型计算、生成 HTML 和审核；任务定义及测试数据由验收脚本预设。它不是模型自主规划项目能力的测试。

边界：同一台 Windows、两个独立 Agent 会话、同一宿主产品和模型登录、本地 SQL 服务、两个合成主人身份。它证明真实 Agent 的任务协作与恢复，不等于两名真人跨机器绑定、异构宿主或线上部署验收。原生插件安装路径另见上方远端安装证据，不与直接 MCP 接入混称。

### 原生插件发起的真实模型闭环

`.agentnet-audit/collaboration-live-q89Kpf/evidence.json` 已通过。双方分别经 Codex 原生 `plugin/install` 安装 `.31`，真实模型从插件调用连接检查、查找同伴、创建项目、发出邀请与接受。之后由获本地授权的后台适配器驱动两个真实 Agent 执行固定的计算、HTML 实现和交叉审核任务。

项目 `20c9f1e4bcb3595e1a73187d87621a03` 已 `completed`；两项任务均 `accepted_result`，2 份成果、2 次审核、4 个阶段、2 次原会话恢复，进程清理成功。生成的 HTML 同样通过禁止网络时 `73.80 / 41.40 / 0.00` 检查。临时测试插件已卸载，保留用户原插件及身份。本条证据连通了原生插件前台入口和真实后台协作；仍遵守上一段的同机、同宿主、合成主人与本地服务边界。

测试宿主版本为 Codex `0.166.0`，插件入口为原生 `0.166.0-alpha.5.1`。其他版本的兼容性需要分别核验，不以当前版本实测替代通用兼容承诺。

官方依据：[插件打包与 marketplace](https://developers.openai.com/plugins/build/plugins)、[插件安装入口](https://learn.chatgpt.com/docs/plugins)。

## 免注册候选版 .32（2026-11-02，本地实现）

新版入口改为“安装 → 自动连接并取得短号 → 邀请 → 对方接受 → 协作交付”，不再依赖手机号账号、资料卡或网页绑定。签名身份仅用于协作，不读取宿主登录凭证；异常保留原身份，后台执行授权仍独立。见 [免注册流程](COLLABORATION_NO_LOGIN.md) 和 [新版试用说明](CODEX_PLUGIN_TRIAL.md)。上文的 needs_binding、注册页面和 .31 部署记录属于旧版历史，不是 .32 用户流程。

当前 .32 未推送 GitHub或部署线上，不以本地验证代替跨电脑真人或 Mac 实机验收。
