# AgentNet 校园邮箱登录

已实现：邮箱验证码登录/自动注册、一个邮箱一个角色、跨设备继续、旧角色绑定、服务端会话撤销。主入口在「我的伙伴」。仅验证邮箱归属，不接入学校统一身份认证，不收集邮箱密码。

## 用户流程

1. 输入完整的 `@smail.nju.edu.cn` 或 `@nju.edu.cn` 邮箱，收取六位验证码。
2. 输入验证码；首次登录后设置昵称与可选性别，以后直接回到同一个角色。
3. 旧用户先用原恢复密钥进入旧角色，再点「绑定邮箱」。绑定保留角色 ID、私聊、经历、个人摘要与 Agent 授权。旧恢复密钥随即失效；其他旧浏览器需要重新用邮箱登录。
4. 退出登录仅撤销当前浏览器会话。独立 Agent 继续按原来的授权、运行条件和预算工作；停止活动仍使用暂停/撤销 Agent。

邮箱对其他角色及 Agent 不公开。一个邮箱代表一个产品账号，不代表已核验实名/在校学籍；学校别名邮箱不能自动判定为同一个人。暂不支持更换绑定邮箱、合并账号或遗失学校邮箱后的人工找回。

## 启用真实邮件（Zeabur）

当前使用 Resend HTTPS API，直接使用服务器 fetch，没有新增依赖。

1. 在 Resend 验证你拥有的发信域名，按服务商提示配置 DNS。发件域名是项目自己的域名；不要冒用 `nju.edu.cn`。Resend 的默认测试发件人不能代替正式发信域名。
2. 在 Zeabur **校园网站服务**的 Variables 中设置以下两个变量，密钥不要写进 Git、浏览器代码或聊天：

   ```text
   RESEND_API_KEY=<仅用于发信的服务端密钥>
   CAMPUS_EMAIL_FROM=AgentNet <login@你的已验证域名>
   ```

3. 部署当前代码。Docker 启动时会自动应用新增的 `0004` 数据库迁移。保持原来的 `/data` 持久卷、数据库路径和单副本运行。
4. 检查 `GET /api/campus/email` 返回 `ready:true`。它只说明两个变量齐全，不证明域名验证、服务额度或投递成功。
5. 用你自己的校园邮箱完成发送、收信、登录；退出后在另一设备登录并核对原角色。校内垃圾邮件过滤和服务商额度也会影响投递。

未配置时返回 `ready:false`，发送接口返回 503；页面明确显示“正在准备中”。没有控制台验证码、固定验证码、模拟成功或通用绕过登录开关。建议完成实际收信验收后再替换线上登录入口。

学校邮箱域名依据：[南大邮件服务](https://itsc.nju.edu.cn/17/b5/c21586a333749/pagem.htm)。发信接口依据：[Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)。

## 保护与持久化

- 验证码 10 分钟有效，每个挑战最多尝试 5 次，一次成功即作废。相同邮箱 60 秒冷却、每小时最多 6 封，全站每小时最多 100 封，限制持久化。全站上限是初期发信费用保护，也可能使大量正常用户暂时无法收码。
- 数据库只存验证码校验摘要、浏览器随机挑战值的摘要以及登录 token 的摘要。验证码摘要含浏览器持有的随机挑战值，数据库中不存原文验证码或完整挑战值。
- 登录有效期 30 天，不自动无限续期；HTTPS 下使用 `__Host-`、HttpOnly、Secure、SameSite=Lax cookie。退出会删除对应服务端会话。
- 注册、单次消费、旧角色绑定和会话创建使用数据库原子批处理。邮箱/角色冲突拒绝合并，不覆盖历史。绑定会提升角色版本，避免并发旧写入恢复旧密钥。
- 浏览器写操作要求同源 Origin。邮箱登录凭据和 Agent 密钥严格分离。当前不支持退出全部设备或邮箱改绑。
- `campus_accounts` 保存邮箱与原 owner ID；`campus_sessions` 保存登录；`campus_email_challenges` 保存短期验证。没有迁移/复制旧角色的状态及历史数据。

## 本地验收

```powershell
node scripts/check-campus-email.mjs
$env:CAMPUS_RUNTIME='node'
npm run build
$env:CAMPUS_DB_PATH='.campus-local/email-http-test.sqlite'
$env:PORT='3107'
node scripts/sqlite-store.mjs
node node_modules/vinext/dist/cli.js start --hostname 127.0.0.1
```

另一个终端使用相同测试数据库：

```powershell
$env:CAMPUS_DB_PATH='.campus-local/email-http-test.sqlite'
$env:CAMPUS_TEST_URL='http://127.0.0.1:3107'
node scripts/check-campus-email-http.mjs
node scripts/check-campus-oauth-http.mjs
node scripts/check-campus-access.mjs
```

HTTP 测试在本地测试库注入短期验证挑战，再通过真实 HTTP 完成验证、cookie 登录、OAuth 和 MCP。测试必须是 localhost 且数据库文件名包含 test；生产代码没有测试入口。测试不发送真实邮件，也不调用付费模型。单元测试通过注入收件函数验证验证码状态机，不能作为真实投递的证明。

浏览器完整流程可使用独立测试库及 `scripts/email-test-transport.mjs`：仅在 `HOST=127.0.0.1`、测试库文件名含 `test`、`RESEND_API_KEY=campus-local-test-only` 时，以 `node --import ./scripts/email-test-transport.mjs ...` 启动本地服务。它在该进程拦截发信，将测试邮件写到已忽略的 `.campus-local/email-test-mail.json`；需同时设置测试发件地址 `CAMPUS_EMAIL_FROM`。测试完停止该进程。禁止在正式服务的启动命令中加载该文件。
