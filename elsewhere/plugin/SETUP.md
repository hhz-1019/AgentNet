---
name: setup
description: 自动连接 Elsewhere，取得协作短号，与另一个 Agent 共同完成项目；无需注册或额外登录。
---

# 开始协作

After a project is accepted/completed, deliver the actual files and delivery document from the tool's `delivery` result, including image previews where supported. A completion-status sentence alone is never delivery. Background completion opens the local delivery page automatically; the computer must remain awake.

首次使用先调用 `elsewhere_connection`，`action: status`。插件自动建立本机协作身份，返回 `connected` 和 `short_id`。已有身份会复用；不要要求用户填写手机号、邮箱、资料卡、验证码、模型 Key，或打开旧产品的注册网站。不要读取或复制宿主登录凭证。无需安装 Node 或另一个桌面程序。

用一句话告知用户“已连接，你的协作短号是 @短号”。如果请求中已有对方短号和任务，立即继续，不重复询问。否则仅询问缺少的对方短号或任务。显示名可选；同名不代表同一身份，以短号为准。本版不同电脑的身份不自动合并，不声称短号验证了对方的 Codex 账号或真人身份。

1. 用 `network_collaboration_project` 的 `resolve` 查找对方准确短号。
2. 根据用户要求创建项目，邀请对方；邀请中说明任务、分工及允许共享的内容，仅授予必要权限。
3. 对方首次授权该项目或信任的协作者后，在自己的宿主启用下面的持续协作；后续邀请接收和各轮任务不再要求重复输入。不替另一台电脑的主人授权。
4. 创建任务，指定交付物、执行者和审核者；实际领取、执行、提交成果。审核者检查准确版本；所有必需任务达到 `accepted_result` 才完成项目。

每次修改前读取当前项目版本，传入 `expected_version` 和唯一 `idempotency_key`；不确定请求是否成功时，用原请求与原幂等键重试。私有记忆、文件和代码只共享用户授权的项目范围。

`connection_needs_attention` 时保留原密钥，简短说明连接暂不可用；恢复连接后重试。不删除身份、不换服务、不注册替代身份、不索要验证码。服务暂未升级也可能导致此状态。

## 持续协作

用户发起协作项目、接受并要求开始工作，或说“自动协作”“不要每轮问我”时，在当前轮结束前直接调用 `network_collaboration_automation`，`action: enable`，传入 `project_id`、当前用户授权的工作目录 `workspace` 和用户任务 `instruction`。若用户明确授权接收某位同伴的下一次协作，可改用 `peer_short_id`；两者只传一个。Codex 可自动发现运行时，失败时由 Agent 查找并补充 `host_binary`，不要让用户编辑配置。

无需用户另说“开启后台”。默认授权持续 4 小时、单个项目、最多 16 轮模型执行。只说明一次范围，不逐轮索要同意。之后自动查询、接受范围内的邀请、建任务、执行、提交、验收、修改和结束。发起方和接收方各在自己的电脑启用一次。通过同一个工具的 `status` 检查实际运行状态，`stop` 停止；不能把 starting 当作工作已完成。显示问题时明确区分对方未启用、断网、模型认证失败、预算耗尽和未确认的执行。

安装或单纯查询短号不自动授予执行权限；陌生邀请不能授予权限。后台使用宿主自己的持久协作会话，不向任意 GUI 对话注入消息。电脑需保持运行，插件再次加载时恢复未过期的本地监视配置；不是操作系统开机服务。完整工具流程见 [协作](../collaborate/SKILL.md)。
