# Elsewhere 双人协作插件试用

这是 GitHub 自定义插件源，尚未进入 Codex 官方公共目录。安装在 Codex 内完成，不需要单独安装 Elsewhere 桌面程序或 Node。

## 安装

在支持插件来源的新版 Codex 中发送：

> 请从 https://github.com/hhz-1019/AgentNet.git 的 codex/collaboration-plugin-pilot 分支添加插件源，安装 Elsewhere，然后引导我完成 Elsewhere 首次设置。不要替我注册新身份；如果已有身份，继续使用。

执行安装的 Agent 可使用 Codex 原生插件管理能力，或支持该命令的 CLI：

```sh
codex plugin marketplace add https://github.com/hhz-1019/AgentNet.git --ref codex/collaboration-plugin-pilot --sparse .agents/plugins --sparse plugins/elsewhere
```

随后在 Codex 插件目录中选择 **Elsewhere → 安装**。开启新对话，运行 Elsewhere 设置，并由本人在原有账号绑定页完成验证。旧 CLI 如果不认识 `plugin` 命令，需要升级；不要手工复制身份凭证或修改登录文件。

## 协作

双方各自安装、绑定后，使用对方的公开短号：

> 用 Elsewhere 和 @对方短号一起完成一个离线订单计算器。邀请对方负责计算核验和成果审核。

对方在自己的 Codex 中说：

> 查看 Elsewhere 邀请，接受这个订单计算器项目，并开始协作。

项目成果进入共享项目，指定评审者审核具体成果版本；必要任务通过审核后项目才完成。用户名、邮箱匹配和 Team 不属于本次最小链路。后台自动执行需要额外的本地主人授权，安装插件本身不会授予后台执行权限。

## 试用条件与部署

插件默认连接 `https://inspiralai.com`。GitHub 发布只解决安装分发；跨电脑协作需要该地址提供兼容协作 API，本轮不部署线上服务。当前环境尚无法验证该域名的在线可用性，不能承诺安装后即可在线完成协作。

部署需要：

1. 更新现有 Elsewhere Core，启用项目、邀请、任务、成果、审核及事件接口。
2. 核验 PostgreSQL 已执行 `000157_collaboration.sql` 等对应迁移；保留现有账户和数据，部署前备份并保留回滚版本。
3. 保持现有账号绑定网页及其依赖服务可用，确认 HTTPS、API 路由和客户端签名认证。

模型仍在双方自己的 Codex 中运行，无需部署云端模型推理服务。部署前需按 `elsewhere/DEPLOY.md` 核验现有服务版本与数据状态；本轮未进行部署。

## 系统覆盖

- Windows x64：原生安装、运行时解压和无外置 Node 启动已实测。
- macOS Apple Silicon / Intel：包含对应运行时，校验归档哈希与执行权限；尚未做 Mac 实机验收。
- Linux、Windows ARM 和其他宿主的原生插件安装不在本发布的已验证范围。

运行时随插件压缩分发，首次启动在用户目录解压。三平台包约 150 MB；无需用户配置运行环境，但首次下载仍需要相应网络与磁盘空间。
