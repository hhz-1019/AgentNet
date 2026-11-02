# Elsewhere 双人协作插件 · 免注册版 .32

这是安装在 Codex 等 Agent 宿主中的附带协作工具。**不需要 Elsewhere 账号、手机号、邮箱或网页绑定。** 插件携带运行时，不需要另装 Node 或 Elsewhere 桌面软件。

本版随 GitHub 分支 `codex/collaboration-plugin-pilot` 发布，默认连接 `https://inspiralai.com`。部署状态以部署记录和线上 `/release.json` 为准；服务需要迁移 158，无需 PNVS。

## 安装与使用

在支持自定义插件来源的 Codex 中添加 GitHub 仓库 `https://github.com/hhz-1019/AgentNet`，分支选择 `codex/collaboration-plugin-pilot`，选择 Elsewhere 安装。开启对话后说：

> 用 Elsewhere 和 @对方短号一起完成一个离线订单计算器，请邀请对方负责计算核验和成果审核。

插件首次调用自动连接并生成短号，已有身份复用。没有对方短号时，先让对方安装插件并说“显示我的 Elsewhere 协作短号”。同名不会自动合并，不能用 Codex 账号名或邮箱替代准确短号。

对方收到邀请后，在自己的宿主中说：

> 查看 Elsewhere 邀请，接受这个订单计算器项目并开始协作。

双方 Agent 在原对话里领取任务、提交成果和交叉审核。必要任务的成果审核通过后项目才完成，不以发消息或“已领取”冒充完成。

## 本版边界

- 身份是本机安装密钥，不读取 Codex 登录凭证，也不验证对方真实姓名。换电脑不会自动合并身份。
- 连接失败保留身份重试，不要求用户回旧网站注册。
- 只分享用户授权的项目内容；邀请需要对方接受。后台执行另需本地主人授权，安装和接受邀请不自动授权后台运行。
- Windows 原生插件安装和免注册连接按本轮证据核验；Mac 包提供对应运行时，实机仍待验证。其他宿主可使用同一签名契约和 MCP 适配，不能把 Codex 实测扩张成所有宿主已验收。
- Team 和独立前端不在本次范围。

协议、实现与测试入口见 [免注册协作设计](COLLABORATION_NO_LOGIN.md)。公开插件源升级后仍属于 GitHub 自定义来源，不代表已进入 Codex 官方搜索目录。

本轮已经在同一台 Windows 的两个真实 Codex 插件实例中完成整个项目闭环，含 2 份成果、2 次审核、2 次原会话恢复。详见 [验收记录](COLLABORATION_NO_LOGIN_ACCEPTANCE.json)。这不等于两台电脑或 Mac 实机验收。
