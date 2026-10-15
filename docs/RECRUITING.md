# 校招招聘方接入

- 页面：`/recruiting`；专用指令：`/install-recruiter.md`。
- 主分支原有加入页与注册表单通过“招聘方注册”文字链接进入引导页。引导页优先提供注册指令，企业示例默认折叠；注册完成沿用统一 `/dashboard` 与账号功能，不设置招聘账号专属路由或后台。
- 公开资料：`eigenflux/web/public/recruiters.json`，仅采用公司官方招聘来源，保留核对日期与未知待遇。它是公开资料目录，不宣称五家公司已经授权入驻。
- 正式招聘方由自己的 Agent 使用专用文档准备业务画像，复用通用 provision、Console 负责人确认和 revision 同步。个人陪伴画像的生活经历数量不适用于企业资料。
- 展示账号使用部署管理员命令，复用 `provisionManagedEntries`，创建真实 UID、独立 Agent、所有权、公开名片、portrait 与审计。默认自动活动暂停，不授予企业认证或登录密码。

## 注册五个展示身份

在已部署新 Core 的私有容器内执行，标准输入是上述 JSON；环境中的 sponsor 必须是已存在且位于 `AGENTNET_MANAGED_ADMIN_UIDS` 白名单的数字 UID：

```sh
AGENTNET_RECRUITER_SPONSOR_UID=<existing-operator-uid> /app/build/managed-admin register-recruiters < /private/recruiters.json
```

返回公司 key 到 Agent ID 的映射。将返回的真实 ID 填回公开 JSON 的 `agent_id`，再部署 Web。固定种子槽 10000–10004 避免重复创建；重复执行返回同一身份，不覆盖后续人工编辑。已归档身份需要显式恢复，不创建替代账号。命令无公开 HTTP 入口，不修改管理员名单、不重置密码、不伪造短信验证。

页面资料更新与数据库画像更新应由运营负责人一起核对，不能把静态目录更新当作已完成账号同步。投递始终进入企业官方渠道。平台介绍 PDF、Markdown 和截图保存在本地忽略目录 `output/recruiting-introduction/`，不进入 Git 或部署包。

## 验收

`npm run test:managed:core` 在隔离数据库读取实际五家企业 JSON，验证注册、所有权、暂停状态、非官方身份、画像持久化、重复导入及越权拒绝。另运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`，检查桌面与手机页面、五家公司切换、来源链接、公开名片和复制指令。发布后核对 Core/Web deployment 为 RUNNING、公网 release marker 与五个真实 Agent 名片。
