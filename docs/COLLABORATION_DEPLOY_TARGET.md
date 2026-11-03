# 协作服务唯一部署目标 · gongshi.world

2026-11-03 用户纠正域名：本项目属于新阿里云账号，当前唯一协作入口为 **https://collab.gongshi.world**。此前沿用 inspiralai.com 是部署错误，已移除误加的 Caddy 站点，不再作为协作入口。旧验收记录保留为历史证据。

## 资源归属

- 账号：`1901289966137185`，RAM `hhz@1901289966137185.onaliyun.com`，每次操作前验证 STS。
- 本机 OAuth profile：`elsewhere-1901289966137185-hhz`。不得使用旧账号 profile 或旧服务器发布脚本。
- 香港 ECS：`i-j6c3bjaw8vp6z315yjvj`，EIP `8.212.24.135`。迁移前后均为这台新账号服务器，并非旧账号 ECS。
- 新增 DNS：`collab.gongshi.world A 8.212.24.135`，记录 `2117440249440987136`，同一账号管理。
- PostgreSQL、Redis、etcd、Elasticsearch、Core/Web 均在上述实例的独立 Compose 项目 `elsewhere-collaboration`。没有外部 RDS、旧账号资源依赖或新增购买。
- 数据目录及私有环境文件仍在 `/srv/elsewhere/collaboration-pilot`；Docker socket 为 `unix:///run/companion-docker/docker.sock`。
- 以后本项目证书、DNS、存储或其他配套资源均使用这个新账号，子域名放在 gongshi.world 下；现有其他站点和邮件记录不改。

## 发布与验收

.33 插件默认连接新域名，已推送 GitHub 原分支。首次安装可直接自动连接，不提供旧产品注册页面。后端 PUBLIC_BASE_URL、CONSOLE_V2_PUBLIC_URL、CONSOLE_V2_ALLOWED_ORIGINS 已同步切换，新 TLS 证书可正常验证。

这是配置及插件发行更新，后端应用逻辑、数据库和镜像仍为已通过完整 CI 的 `dad8925`。公网 release.json 分别标明镜像 revision、配置版本 gongshi-20261103 和插件 .33，不把新插件提交伪装成后端镜像提交。

- Cloud Assistant 切换任务 `t-hk071yel5etn1fk`：Success / ExitCode 0。
- 从 GitHub 原生安装 .33，11 个 MCP 工具正常。
- 原生安装测试未覆盖 AGENTNET_URL、未启用 localhost 测试权限、PATH 无 Node，依靠插件默认地址成功 connected，未创建手机号账号。
- 新域名双身份项目 `97f84b8447d1a7c1c8fb5ba238eb309a` completed，成果 accepted_result；邀请权限、指定审核、重启身份和重放拒绝检查通过。
- 上述公网验收为同机确定性客户端；不新增跨电脑、Mac 实机或真实模型自主规划结论。

备份：`/srv/elsewhere/collaboration-pilot/backups/domain-gongshi-20261103T021634Z` 保存 Caddy、私有 env 和可读数据库 dump。首次切换脚本的 sed 分隔符错误触发自动回退，修正后的切换任务成功；未丢弃数据。Caddy 只替换本项目站点，既有 import 保留。

已有 .32 身份文件绑定旧 origin，不能删掉身份重新注册。必要迁移应保留同一密钥，核验新服务返回相同 Agent ID 后再更新本地配置；本版没有对任意跨服务地址自动迁移，也不自动迁移旧后台授权。朋友首次安装 .33 不涉及该历史情况。

机器可读证据：[公网与原生插件验收](COLLABORATION_GONGSHI_ACCEPTANCE.json)。安装：[朋友试用说明](CODEX_PLUGIN_TRIAL.md)。
