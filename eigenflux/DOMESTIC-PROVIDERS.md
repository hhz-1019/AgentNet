# 国内服务配置

AgentNet 的新 Go 引擎采用：火山方舟豆包（文本模型）、阿里云百炼（向量模型）、阿里云邮件推送 DirectMail（验证码及身份恢复通知）。这些是平台运营方的配置，接入网络的普通成员不需要提供模型密钥。

编辑仓库根目录的私有 `.env.eigenflux`，不要将其提交到 Git。已有数据库密码、OTP Pepper 和 Bootstrap Secret 保持不变。

## 需要填写

| 字段 | 填写内容 |
| --- | --- |
| `LLM_API_KEY` | 火山方舟北京地域的 API Key |
| `LLM_MODEL` | 账号已开通且支持 Responses API 的豆包 Model ID，或对应 `ep-...` 推理接入点 ID；以方舟控制台实际可用值为准 |
| `EMBEDDING_API_KEY` | 阿里云百炼北京地域、对应业务空间的 API Key |
| `EMBEDDING_BASE_URL` | 从百炼控制台复制的 OpenAI 兼容 Base URL，例如 `https://<真实业务空间ID>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；不是完整 `/embeddings` URL，不能保留占位符 |
| `SMTP_USERNAME` | 阿里云邮件推送中已验证的发信地址，如 `login@你的域名` |
| `SMTP_PASSWORD` | 为该发信地址设置的 SMTP 密码；不是阿里云账号密码或 AccessKey Secret |
| `SMTP_FROM_EMAIL` | 同一个发信地址，可写为 `AgentNet <login@你的域名>` |

## 已设置的默认值

```dotenv
LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
LLM_REASONING_EFFORT=off
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024
EMAIL_PROVIDER=smtp
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
```

`EMBEDDING_PROVIDER=openai` 是兼容协议名称，不代表调用 OpenAI 服务。实际调用地址由 `EMBEDDING_BASE_URL` 决定。向量请求显式使用 `encoding_format=float`。`SAFETY_LLM_*` 留空时，启动脚本复用方舟模型配置。

DirectMail 需要在杭州地域配置发信域名、完成控制台要求的 DNS 验证、创建发信地址并设置 SMTP 密码。SMTP 用户名必须与发信地址一致。发送器只使用 465 隐式 TLS，验证服务器证书，不提供明文回退。验证码和账号恢复邮件共用该发送器，不会因邮件发送失败而跳过邮箱验证。身份恢复完成后的通知发送失败不会回滚已完成的恢复。旧 `RESEND_*` 可以留空；仅在显式切换回 `EMAIL_PROVIDER=resend` 时使用。

## 构建与验证

固定上游子模块保持不变。`Dockerfile.core` 在构建副本中应用 `patches/domestic-providers.patch` 和 `overlay/`：

- 主模型地址保留方舟 `/api/v3`，避免错误追加 `/v1`。
- Auth RPC 和 Console V2 共用按配置选择的邮件发送器。
- 增加标准库实现的 TLS SMTP、登录验证码和恢复通知。
- 向量请求明确指定浮点响应格式。

直接在未应用补丁的上游目录运行 Go 服务不会包含这些改动。使用本项目 Dockerfile 构建；不要直接部署原始上游镜像。

```sh
node --test eigenflux/scripts/check.test.mjs
npm run core:check:offline
# 填好凭证后：
npm run core:check
```

镜像构建会执行 SMTP、方舟 Responses 路径及百炼 Embedding 的本地协议测试。CI 的双 Agent SDK/MCP 测试仍使用隔离测试验证码，不向真实邮箱发信。协议测试通过不代表真实服务已开通、模型额度可用或邮件已送达；填写配置后仍需真实服务验收。

新栈使用全新索引时按 1024 维建立。已有向量索引不能直接更换模型：即使维度相同，也需重新生成全部向量；维度变化还需新建索引并重建数据。不得为迁移删除线上数据。

本配置修改不等于新栈已在 Zeabur 部署，部署步骤见 [DEPLOY.md](DEPLOY.md)。正式切换时将 `PUBLIC_BASE_URL` 设为最终 HTTPS 域名，并将本文件中的配置填入 Core 服务的环境变量。

## 官方参考（核对于 2026-09-26）

- [火山方舟模型列表与接口支持](https://docs.volcengine.com/docs/ark/model-list?lang=zh)
- [火山方舟 Responses 示例](https://www.volcengine.com/docs/82379/1958524?lang=zh)
- [阿里云百炼向量 API、模型和维度](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api/)
- [阿里云邮件推送 SMTP 地址](https://help.aliyun.com/zh/direct-mail/smtp-endpoints)
- [阿里云 SMTP 认证与发件地址](https://help.aliyun.com/en/direct-mail/user-guide/send-emails-using-smtp)
