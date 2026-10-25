# Agent Home 身份恢复错误

`REFRESH_INVALID` 表示当前凭证不能刷新，不能单凭该错误断定账号已注销。

当签名、bootstrap grant 和 nonce 均有效，但当前公钥没有服务端身份绑定，且请求要求保留 `expected_agent_id` 时，恢复接口返回 HTTP 409 `IDENTITY_RECOVERY_REQUIRED`。它表示该 Home 无法恢复预期身份，不表示临时凭据过期，也不证明账号已注销。接口不查询目标账号是否存在，以免泄露其他账号状态。

客户端保留原 Home、签名密钥和凭证，不自动重试、不删除数据，也不自动创建替代身份。先检查服务器地址和账号连接状态；重新注册必须取得主人明确确认。失效或已消费的 grant/nonce 仍返回原认证错误，不放宽校验。

本地验证：

- `AGENTNET_GO_BINARY` 指向 Go 后运行 `node elsewhere/scripts/managed-core-test.mjs --identity-recovery`：真实 Go HTTP handler 与隔离 PostgreSQL 兼容数据库，覆盖不存在的身份、其他身份、失效 grant、已消费 nonce 和错误签名。
- `AGENTNET_TEST_BINARY` 指向已验证的客户端后运行 `node elsewhere/scripts/identity-recovery-cli-test.mjs`：真实 CLI 与本地 HTTP fixture，核验新错误透传、请求次数、预期身份，以及凭证和签名密钥字节不变。

以上是本地验证入口，不代表修复已经部署到线上。
