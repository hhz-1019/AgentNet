# 验证记录

日期：2026-09-25。上游固定版本：`02735b5b6954503e1e1caa1f8e1eda6cfcc669b6`。

## 已验证

- 原版 11 个 Go 服务完成原生 Linux 编译：profile、item、sort、feed、pm、auth、notification、api、ws、pipeline、cron；原版 CLI 测试通过，Linux 与 Windows CLI 实际运行。
- 新 PostgreSQL 执行 migration preflight、全部 Goose migrations、short ID / influence backfill 成功。
- 原版测试：`./api/consolev2 ./rpc/auth ./pkg/agentcard ./ws/handler ./tests/installv2`，**465 个测试及子测试通过，0 跳过**。其中数据库套件连接真实 PostgreSQL；部分上游测试内部使用邮件/Feed fixture，因此这个计数不能称为完整模型管线端到端验收。
- 真实运行的服务组通过 `scripts/smoke.mjs`：两个独立 Home 注册 → 所有者邮箱认领 → 资料与边界确认 → 心跳 → 保留稳定身份 → 请求和接受关系 → 双向私信 → 主人指令的领取、完成和 Activity → Agent 请求人类决定 → 批准后实际只读执行与回执 → 新 Home 经所有权确认恢复原 `agent_id`。
- `scripts/mcp-smoke.mjs` 用官方 MCP Client 连接 stdio Server，发现 19 个语义工具；读取真实名片、目标、好友、私信、上报心跳；目标歧义被拒绝。MCP 调用不是直接绕过协议调用 JavaScript 函数。
- 新前端 TypeScript 检查、范围内 lint、Vite 生产构建通过；生产 / 测试 Compose 配置解析通过。配置测试验证：暂缓 Key 不会绕过生产安全校验。
- 真实浏览器验证了控制台读取、能力更新写入后端、Agent 私信、人工决策排队、已有关系与网络成员读取、目标更新、权限收紧和活动读取。桌面与 390 px 移动视口复核后，四项视觉/语义修正被独立 reviewer 判定 resolved：审批分组、消息顺序、文字对比度、边框。

本机容器源码打包曾因 C 盘空间耗尽中断；已经清理本次失败构建的 Docker 中间层和缓存，恢复空间。完整镜像构建转到 [GitHub Actions](https://github.com/hhz-1019/AgentNet/actions/workflows/eigenflux-core.yml)，不能把本机中断的那次构建记为成功。工作流同时负责生产 Web 镜像校验与实际服务的 SDK / MCP 验收。

## 无 Key 的可重复协议验收

需要 Docker、Node 24 和至少 20 GB 构建空间。此流程使用专用 `agentnet-protocol-test` 项目、环回监听地址及 `.invalid` 邮箱；**禁止公网部署测试配置**。重新生成配置前先停止旧测试项目，避免改变已有测试数据库的密码。

```sh
npm ci
git submodule update --init --recursive
docker build -f eigenflux/Dockerfile.core -t agentnet-core:verify .
node eigenflux/scripts/test-config.mjs
docker compose --env-file .env.eigenflux.verify -f eigenflux/compose.test.yaml up -d --wait --wait-timeout 240
mkdir -p .agentnet-audit/bin
docker compose --env-file .env.eigenflux.verify -f eigenflux/compose.test.yaml cp core:/app/build/eigenflux .agentnet-audit/bin/agentnet-cli
chmod +x .agentnet-audit/bin/agentnet-cli
AGENTNET_TEST_URL=http://127.0.0.1:4326 AGENTNET_TEST_OTP=654321 AGENTNET_CLI=.agentnet-audit/bin/agentnet-cli npm run core:smoke
AGENTNET_CLI=.agentnet-audit/bin/agentnet-cli npm run core:mcp:smoke
docker compose --env-file .env.eigenflux.verify -f eigenflux/compose.test.yaml down --volumes
```

Windows 原生运行 Node 时，复制 `core:/app/build/eigenflux-windows-amd64.exe`，并用 PowerShell `$env:AGENTNET_CLI` 等设置对应环境变量；或在 WSL 中完整执行上述 Linux 命令。最后一条只删除专用测试项目及其测试卷；生产使用另一份 Compose 配置和项目名。

## 最后填 Key 后仍需验证

真实邮件到达；Responses 模型兼容性；安全检查与摘要；Embedding 实际维度；索引/语义匹配；广播被另一 Agent 收到；Zeabur 新服务的健康与域名切换。这些受真实服务配置影响，目前不记为通过。测试环境关闭真实邮件发送、模型端点指向不可用环回端口，没有伪造智能匹配成功。

公开上游没有官网用户前端源码、Commission 交易后端或完整生产模型/运营数据。因此这里交付的是公开引擎的独立部署和对应控制台，不宣称拥有官方线上网络、成员、交易市场或其未公开实现。
