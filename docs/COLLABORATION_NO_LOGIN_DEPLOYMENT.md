# 免注册协作发布 · 2026-11-03

.32 原生插件已推送，免注册后端已上线。用户明确授权 GitHub 推送与上线。

- 入口：https://inspiralai.com
- 应用提交：`dad89258a11eb869ddfe29a2e8bcaf78eecd1fc7`；后续文档提交不改变应用镜像。
- 插件：`0.0.54-agentnet.32`，GitHub `codex/collaboration-plugin-pilot` 自定义来源，非官方公共目录上架。
- [完整 CI](https://github.com/hhz-1019/AgentNet/actions/runs/41481176729) 全部成功，未跳过失败测试。Core/Web 制品 SHA-256、内部校验和、revision 和载入镜像配置摘要均通过。
- STS 核验账号 `1901289966137185`、RAM `hhz`；目标香港 ECS `i-j6c3bjaw8vp6z315yjvj`。复用本项目数据库及已有 ECS，无新购资源，没有操作旧账号。
- Cloud Assistant 部署任务 `t-hk071wzldjqq5fk` 最终 Success / ExitCode 0。迁移 158 成功，Core、PostgreSQL、Redis、etcd、Elasticsearch healthy，Web 公网响应通过。
- 本机正常 TLS 读取公开 release：提交相符，migration 158、installation-key-v1。8 个插件入口未签名请求均 401。

## 实际验收

从 GitHub 重新获取插件，经 Codex 原生接口安装 .32，11 个 MCP 工具正常。另在无 Node PATH、全新隔离身份、未开启 loopback 测试开关的情况下调用原生插件，成功连接真实公网，返回 connected。无需手机号、网页绑定、短信服务或宿主登录凭证。

两个独立安装身份在真实公网完成短号查找、邀请、接受、任务领取、启动、成果提交、指定版本审核和项目完成。项目 `d5c7112a309d586058e0765f1aeb8f68` 为 completed，任务 accepted_result；未接受邀请读取被拒绝、自审被拒绝、重启保留身份、重放请求被拒绝。

数据库核对：3 个验收安装身份，对应 agent_owners 行数为 0。没有创建手机号主人账号；SMS 和云端模型 Key 仍为空。验收身份和已完成测试项目保留，密钥仅在本机隔离目录，不随仓库发布。

上述公网内容由确定性脚本提供，是服务与原生安装验收，不是新增真实模型或跨电脑实测。两个真实 Codex Agent 的本地完整项目证据仍见 [模型验收](COLLABORATION_NO_LOGIN_ACCEPTANCE.json)。Mac 实机和两位真人跨电脑由用户后续手动验收。机器可读结果见 [公网验收](COLLABORATION_NO_LOGIN_PUBLIC_ACCEPTANCE.json)。

## 备份和回退

根目录：`/srv/elsewhere/collaboration-pilot`。Docker 使用 `unix:///run/companion-docker/docker.sock`；不启动默认 daemon。核心私有环境文件保持原样，数据服务不映射公网。

- 发布前备份：`backups/pre-dad89258a11eb869ddfe29a2e8bcaf78eecd1fc7-20261102T164455Z.dump`，pg_restore -l 可读。
- 发布后备份：`backups/post-dad89258a11eb869ddfe29a2e8bcaf78eecd1fc7.dump`。
- 当前应用：`releases/dad89258a11eb869ddfe29a2e8bcaf78eecd1fc7/compose.json`。
- 上一版应用：`releases/43558a413740211d7bc2dfde9831e8fedf4a7d89/compose.json`，镜像和配置保留。
- 回退只更新本项目应用，保留数据库和安装身份映射。已有安装身份后不得删除 migration 158 表；旧应用也无法提供新插件连接，需恢复新服务后再使用。

Caddy 配置哈希未变。本次部署脚本仅更新本项目 core/web；其他稳定服务容器 ID 未变。检查期间 simulator-acceptance-20261103 的测试容器出现并发重建，因此没有将全机容器列表完全相同作为通过结论，亦未干预该测试环境。未配置定时异地备份。
