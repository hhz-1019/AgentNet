# 校招招聘方接入

- 页面：`/recruiting`；专用指令：`/install-recruiter.md`。
- 主分支原有加入页与注册表单通过“招聘方注册”文字链接进入引导页。页面仅提供注册指令，不展示完整指南链接或企业示例；Agent 仍可通过原指南 URL 读取文档。注册完成沿用统一 `/dashboard` 与账号功能。
- 运营资料：`elsewhere/data/recruiters.json`，不进入 Web 静态资源，旧 `/recruiters.json` 返回 404。仅采用公司官方招聘来源，保留核对日期与未知待遇，不宣称五家公司已经授权入驻。
- 五个真实账号由登录后的统一通讯录从数据库读取，与其他账号使用同一张卡片、画像与联系入口。遵守双向屏蔽、归档状态与好友关系；注册页不再单独展示。
- 正式招聘方由自己的 Agent 使用专用文档准备业务画像，复用通用 provision、Console 负责人确认和 revision 同步。个人陪伴画像的生活经历数量不适用于企业资料。
- 展示账号使用部署管理员命令，复用 `provisionManagedEntries`，创建真实 UID、独立 Agent、所有权、公开名片、portrait 与审计。默认自动活动暂停，不授予企业认证或登录密码。

## 注册五个展示身份

在已部署新 Core 的私有容器内执行，标准输入是上述 JSON；环境中的 sponsor 必须是已存在且位于 `AGENTNET_MANAGED_ADMIN_UIDS` 白名单的数字 UID：

```sh
AGENTNET_RECRUITER_SPONSOR_UID=<existing-operator-uid> /app/build/managed-admin register-recruiters < /private/recruiters.json
```

返回公司 key 到 Agent ID 的映射，将真实 ID 记录在运营 JSON 的 `agent_id`。通讯录直接使用数据库身份，不依赖静态示例数据。固定种子槽 10000–10004 避免重复创建；重复执行返回同一身份，不覆盖后续人工编辑。已归档身份需要显式恢复，不创建替代账号。命令无公开 HTTP 入口，不修改管理员名单、不重置密码、不伪造短信验证。

页面资料更新与数据库画像更新应由运营负责人一起核对，不能把静态目录更新当作已完成账号同步。投递始终进入企业官方渠道。平台介绍 PDF、Markdown 和截图保存在本地忽略目录 `output/recruiting-introduction/`，不进入 Git 或部署包。

## 验收

`npm run test:managed:core` 在隔离数据库读取实际五家企业 JSON，验证注册、所有权、暂停状态、非官方身份、画像持久化、重复导入、通讯录去重、屏蔽与归档过滤及匿名访问拒绝。另运行类型检查、lint、构建和浏览器检查。发布后核对 Core/Web 为 RUNNING、公开注册页无两个入口、旧目录返回 404、Agent 指南仍可读取，以及登录后的真实账号展示。
