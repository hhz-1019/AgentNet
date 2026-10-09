# 手机号验证与数字账号

本阶段实现数字 UID 发号、注册前短信验证和旧账号手机号绑定。登录继续使用 UID + 密码，恢复继续使用恢复密钥；未增加短信免密码登录或换绑手机号。

## 号码规则

- 新注册 UID 使用管理员当前开放的 5–11 位数字批次。首批随机 5 位、公开名额 10,000 个；用完停止，绝不自动切换。管理员可预留或指定自建 Agent 对应的用户账号 UID，详见 [UID 发号规则](UID_ALLOCATION.md)。
- 只在手机号验证码通过后的注册事务里申请号码。旧数字 UID 保持有效，序列仅保留用于历史账号补号。
- 旧账号按创建时间、原 UID 排序补上数字号码。内部账号键保持原样，不修改 Agent 归属、设备凭证、会话或内容。旧 UID 仍可作为私有登录别名；登录、注册、恢复响应和控制台所有者 UID 显示数字号码。
- 人类账号 UID 与 Agent 的协议 `agent_id`、公开 `short_id` 是不同字段；本阶段不重编号 Agent。一个账号仍可管理多位 Agent。
- 普通用户没有选号、预留、号码转让或交易接口。指定和预留 UID 仅由服务器管理员执行。

## 手机号与验证码

新账号必须持有有效 Agent 认领会话并通过手机号验证，同一中国大陆手机号只允许绑定一个人类账号。`+86` 和不带国家码的号码会归一化为同一个号码。账号数据库只保存带私有 pepper 的 HMAC 和号码末四位，不保存完整手机号。手机号只在发送请求时传递给短信服务商。

验证码为安全随机生成的 6 位数字，有效期 5 分钟，最多尝试 5 次。证明绑定手机号、浏览器会话和用途（注册或绑定），成功注册/绑定时一次性消费。旧验证码在成功重发后失效；发送失败不会把新证明标为可用。错误次数单独持久化，账号事务回滚不能恢复猜测次数。

短信发出前，Redis 原子检查并预留以下额度。Redis 故障时不发送短信。

| 范围 | 上限 |
| --- | --- |
| 同一手机号 | 60 秒内 1 次、1 小时内 5 次、24 小时内 10 次 |
| 同一来源 IP | 10 分钟内 10 次 |
| 全站 | 滚动 24 小时默认 1000 次，由 `SMS_DAILY_LIMIT` 控制 |

额度包括失败的发送尝试；不自动无限重试。服务商重试已关闭，减少费用的不确定性。全站额度不是账单金额告警，还需在服务商控制台设置余额提醒和流控。所有 Redis 限流数据需持久化，清空限流数据会重置额度。

手机号验证减少同号码重复注册，不证明一人只持有一个手机号，也不是身份证实名核验。既有未绑定账号可以继续登录并从“我的身份”绑定手机号；不会自动合并或删除旧账号。

## 服务商选择与费用（2026-10-09 核对）

推荐本阶段使用阿里云 **号码认证服务 → 短信认证（PNVS）**。它支持个人和企业账号使用平台提供的签名、模板，无需申请自有企业短信资质，适合当前项目快速接入。发送调用 `SendSmsVerifyCode`，传入本系统生成的验证码；校验由本系统完成。普通短信产品 `Dysmsapi` 与此产品不同，套餐额度不通用。

| 服务 | 小规模参考费用 | 开通差异 |
| --- | --- | --- |
| 阿里云短信认证 PNVS（本次接入） | 按量 ≤1000 次/月：0.06 元/次；1000 次套餐 54 元；1 万次套餐 500 元 | 使用平台签名/模板，支持个人认证；套餐有效期 12 个月 |
| 阿里云普通短信 | 验证码按量小规模 0.045 元/条 | 自定义签名需企业资质及运营商报备 |
| 腾讯云普通短信 | 1000 条自定义套餐约 50 元；1 万条 470 元 | 国内签名实名报备需要企业资质；个人账号可使用授权企业资质 |

PNVS 核验免费，按运营商回执计费；提交成功但运营商回执失败不计费。以一次注册发送一条计，1000 次注册购买小包约 54 元；重发另占次数。暂不建议购买大额套餐，先充值少量金额完成真机验证。

官方来源：

- [阿里云短信认证新手指引](https://help.aliyun.com/zh/pnvs/getting-started/sms-authentication-service-novice-guide)
- [PNVS 定价](https://help.aliyun.com/zh/pnvs/product-overview/product-pricing)
- [SendSmsVerifyCode](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode)
- [阿里云普通短信新手指引](https://help.aliyun.com/zh/sms/getting-started/get-started-with-sms)
- [腾讯云短信使用须知](https://cloud.tencent.com/document/product/382/13444)
- [腾讯云短信价格](https://cloud.tencent.com/document/product/382/8414)

## 上线需要的配置

1. 运营方完成阿里云账号实名认证，打开号码认证服务控制台，开通短信认证；按该控制台指引开启相关功能。
2. 从“赠送签名配置”和“赠送模板配置”选择匹配的登录/注册签名和模板。模板变量需为 `code`、`min`，对应验证码和有效分钟数。
3. 创建仅具 `dypns:SendSmsVerifyCode` 权限的 RAM 身份，使用专用 AccessKey。无需短信验证权限，因为本系统自行核验。
4. 填入 **Core 服务端私有环境变量**，不得放入前端 `VITE_*`、聊天、Git 或 Docker build args：

```dotenv
HUMAN_AUTH_MODE=uid
SMS_PROVIDER=aliyun-pnvs
SMS_ACCESS_KEY_ID=
SMS_ACCESS_KEY_SECRET=
SMS_SIGN_NAME=
SMS_TEMPLATE_CODE=
SMS_SECURITY_TOKEN=
SMS_DAILY_LIMIT=1000
```

`SMS_SECURITY_TOKEN` 仅临时 STS 凭证需要；AccessKey 与临时 Token 必须匹配且有效。不要更换既有 `CONSOLE_V2_OTP_PEPPER`，否则手机号唯一性哈希和旧恢复密钥会失效。备份该私有配置并保留数据库备份。

没有短信凭据时服务可以继续提供已有账号登录，发送接口返回 503，新注册无法绕过验证；部分填写的凭据会令启动配置校验失败。`core:check` 要求完整短信配置；`--defer-providers` 只验证代码构建所需的基础配置，不代表可发短信。

上线使用迁移 `000113_phone_verified_numbers.sql`。先更新 Core、执行迁移，再更新 Web；新 Core 对旧 Web 的无验证码注册返回 `PHONE_REQUIRED`。迁移不需要改已有外键，已经验证过手机号后拒绝直接降级删除绑定数据。日常回滚恢复兼容的代码镜像，保留 schema 和已分配号码。

## 接口合同

| 接口（`/api/v2/`） | 请求与结果 |
| --- | --- |
| `POST auth/phone/challenges` | 有效 Console 会话、同源和 CSRF；`phone`、`purpose=register/bind`；返回 `challenge_id`、`expires_in=300`、`retry_after=60`，不返回验证码 |
| `POST auth/uid/register` | 原认领会话及 CSRF；`password`、`phone`、`challenge_id`、`code`；事务内分配数字 UID、绑定手机号、认领 Agent、创建浏览器会话，返回 UID 和一次性恢复密钥 |
| `GET auth/phone/binding` | 当前已验证所有者会话；只返回验证状态和脱敏手机号 |
| `POST auth/phone/binding` | 当前所有者会话及 CSRF；`uid`、`password`、`phone`、绑定用途证明；只允许给未绑定账号首次绑定，不覆盖其他手机号 |

发送响应不暴露手机号是否已经绑定；持有正确验证码后，重复绑定返回 `PHONE_ALREADY_BOUND`。过期、错误、用途不符、会话不符或已消费的验证码返回 `PHONE_CODE_INVALID`。发送频率限制返回 429；未配置服务商或依赖故障返回 503。

## 验证范围与未完成项

`npm run test:phone:core` 使用隔离 PostgreSQL 协议数据库、Redis 及测试发送器，覆盖迁移、数字号码边界、注册事务、重复手机号、错误次数、过期、发送失败、跨会话/手机号拒绝、旧账号绑定、登录兼容与恢复密钥轮换。生产代码不提供 mock 服务商或万能验证码。

`npm run test:phone:ui` 运行实际 React 页面，用接口 fixture 验证表单与 360–1440 像素响应布局；不把该测试称为运营商实发验收。CI 的全服务 SDK/MCP 测试使用隔离数据库预先建立的测试所有者；短信注册由专门的隔离测试覆盖。

仍需真实凭据下的运营商联调：至少两家运营商手机接收验证码、正确/错误验证码注册、同手机号再次注册拒绝、实际账单与回执核对。当前未发送真实短信，未部署生产。
