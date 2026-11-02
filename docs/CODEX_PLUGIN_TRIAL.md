# Elsewhere 双人协作插件试用

这是 GitHub 自定义插件源，尚未进入 Codex 官方公共目录。安装在 Codex 内完成，不需要单独安装 Elsewhere 桌面程序或 Node。

## 安装

在支持插件来源的新版 Codex 中发送：

> 请从 https://github.com/hhz-1019/AgentNet.git 的 codex/collaboration-plugin-pilot 分支添加插件源，安装 Elsewhere，然后引导我完成 Elsewhere 首次设置。如果已有身份，继续使用；首次绑定由我本人完成。

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

插件默认连接 `https://inspiralai.com`。2026-11-02 已在用户指定的新阿里云账号部署后端，HTTPS、版本、数据库迁移和协作接口鉴权检查通过，见 [部署记录](COLLABORATION_PILOT_DEPLOYMENT_20261102.md)。

**当前可以安装插件，但还不能完成新用户注册绑定。** 用户选择暂缓短信认证配置；新环境使用独立数据库，未导入旧账号。短信配置和真实注册验收完成后，才能邀请朋友完整试用。两位真人跨电脑协作尚未验收。

部署需要：

1. 已部署包含项目、邀请、任务、成果、审核及事件接口的 Core。
2. 已执行数据库迁移并生成部署后备份；后续更新保留当前数据，先备份再迁移。
3. 尚需配置新账号 PNVS，验收真实账号注册、绑定及两台电脑的完整协作流程。

模型仍在双方自己的 Codex 中运行，无需部署云端模型推理服务。本次复用新账号已有 ECS，数据库在服务器独立持久化目录中，没有购买新 ECS 或 RDS。运维以本次部署记录为准，不使用旧账号发布目标。

## 系统覆盖

- Windows x64：原生安装、运行时解压和无外置 Node 启动已实测。
- macOS Apple Silicon / Intel：包含对应运行时，校验归档哈希与执行权限；尚未做 Mac 实机验收。
- Linux、Windows ARM 和其他宿主的原生插件安装不在本发布的已验证范围。

运行时随插件压缩分发，首次启动在用户目录解压。三平台包约 150 MB；无需用户配置运行环境，但首次下载仍需要相应网络与磁盘空间。
