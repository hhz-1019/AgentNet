# 双人协作后端部署记录 · 2026-11-02

用户授权在新账号部署后端，暂缓 PNVS 配置和两位真人跨电脑验收。

## 发布与验证

- 入口：https://inspiralai.com
- 应用提交：`43558a413740211d7bc2dfde9831e8fedf4a7d89`；后续仅文档提交不改变线上版本。
- [完整 CI](https://github.com/hhz-1019/AgentNet/actions/runs/41437847415) 最终全部成功。Web 提示框测试首轮超时，重跑通过，未删除或跳过测试。
- STS 核验 RAM `hhz` 属于账号 `1901289966137185`。
- 香港 ECS `i-j6c3bjaw8vp6z315yjvj`，EIP `8.212.24.135`，已核验网卡归属。
- 复用已有 ECS，无新购 ECS/RDS。独立数据库，未导入旧用户或复制旧凭证，未修改旧账号资源。
- CI 镜像外层 GitHub SHA-256、内层 SHA256SUMS、revision、载入后的配置摘要全部通过。Docker containerd manifest ID 与 config digest 分开核验。
- 数据库迁移退出码 0，协作项目、事件、运行、成果、审核等表存在。
- Core、PostgreSQL、Redis、etcd、Elasticsearch healthy；Web 实际 HTTP 检查通过。
- 本机和服务器均通过正常 TLS 校验读取公网 `/release.json` 和 `/api/v1/website/stats`；版本匹配。
- `/api/v2/collaboration/` 下 project、membership、tasks、context、updates、submit、review 的未认证 POST 均返回 401。
- Caddy 新增 apex 入口后全部既有 host 路由保留。
- 部署后 PostgreSQL 备份已生成，`pg_restore -l` 可读。

这些结果证明后端部署、连通性及鉴权边界，不代表生产用户的已认证协作验收。此前真实 Codex 会话的本机项目验收仍按 `CODEX_PLUGIN_ACCEPTANCE.json` 的原始范围解释。

## 运维

根目录 `/srv/elsewhere/collaboration-pilot`：

- `releases/<应用提交>/compose.json`：项目名 `elsewhere-collaboration`。
- `private/core.env`：服务器私有配置，0600；不得打印或提交。
- `data/{postgres,redis,etcd,elasticsearch}`：独立持久化数据。
- `backups/post-deployment-43558a4.dump`：首次上线后备份；尚未配置定时异地备份。
- `edge-backup-path`：发布前活跃 Caddy 配置备份目录。
- `revision-active`：线上应用提交。

Docker socket 为 `unix:///run/companion-docker/docker.sock`，不要启动默认 daemon。Web 仅绑定 `127.0.0.1:18084`，数据服务无公网映射。Core/Web 接入额外普通 Docker 网络，数据服务只在 internal 网络中。

活跃 Caddy 二进制 `/srv/swm-app/bin/caddy`，配置 `/srv/swm-app/current/deploy/Caddyfile`，管理端口本机 2019。历史 `/srv/elsewhere/edge/Caddyfile` 不活跃。

官方 CLI 显式使用 OAuth profile `elsewhere-1901289966137185-hhz`，每次先核对 STS 账号与实例。此次通过 Cloud Assistant 执行并等待最终 ExitCode，未开放公网 SSH。后续先备份、核验 CI 和镜像，再迁移更新并检查公网版本；不要运行指向旧账号的历史发布脚本。

暂停/回退时只停止本项目 core/web，保留数据库和持久化目录。从当前 Caddy 配置精确移除新增的 `inspiralai.com` 块，验证后 reload；若已有后续修改，不得整份覆盖为历史备份。必要时仅删除新增 DNS 记录 `2117226879743830016`，其他记录不动。

## 暂缓事项

- PNVS 未配置，新用户不能完成手机号注册绑定；没有测试验证码或认证绕过。
- 云端模型 Key 和自动社交运营任务未启用；协作工作由用户宿主内 Agent 执行。
- 宿主关闭 IPv4 forwarding；本次内网和公网入口通过，启用短信/云模型时仍需另验容器外连。
- 两位真人跨电脑首次绑定与线上协作、Mac 实机及其他宿主验收仍待补充。
