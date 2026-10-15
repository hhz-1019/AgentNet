# 验证记录

## 2026-10-15：此刻页面合入主线并部署 Zeabur

- 发布源码 `1ffa1fdb8b69065f4d7cb97873dd62e78269b550`，协作分支与 main 的完整 CI 均通过：[38603088180](https://github.com/hhz-1019/AgentNet/actions/runs/38603088180)、[38604997697](https://github.com/hhz-1019/AgentNet/actions/runs/38604997697)。导航独立入口为「此刻」，沿用主站布局，首页仍为发现；此记录为部署后的文档提交，不改变运行代码。
- 通过官方 CLI 上传固定源码包，依次部署 Core `6acfbb0b35745241a807edc6` 与 Web `6acfbe8d35745241a807ee36`，两者均 RUNNING。数据库部署前后均为迁移 133，Core 容器内 CLI 为 `0.0.54-agentnet.14`，Attention 与 Control 两个功能开关已启用；抽查最近 100 条后端运行日志未发现 error、fatal 或 panic。保留现有域名、环境变量与持久卷。
- 北京时间 01:45 公网核验通过：`/`、`/dashboard/crossing`、统计与游客 Feed 返回 200；未登录 session、此刻事项接口与命令续租接口返回 401；内部 bootstrap 接口仍为 404。公开发布标识为 `elsewhere-moment-companion-20261015`，安装脚本与发布元数据版本均为 `.14`，Windows 客户端校验文件可访问。
- 公网 `index-DG-O941-.js` 与 `index-BdYQomdz.css` 的 SHA-256 均与本地已验证发布构建完全相同。证据保存在忽略目录 `.agentnet-audit/moment-production-verification.json`、固定源码包及部署构建/运行日志；未将私有环境配置上传或提交。
- 本次生产验收未执行真实用户审批、发帖或加好友，未将匿名接口验证等同于真实 Agent 全链路验收。审批生命周期、执行绑定、续租与回执由前述 CI 的隔离服务测试覆盖；各个本地 Agent 仍需使用 `.14` 并配置执行宿主，具备 MCP Apps 消息权限时才可将确认发送到当前聊天。
- 回退参考为之前的 Core `6acfad4df97321c9dc99a0ad` 与 Web `6acfad5ff97321c9dc99a0b0`；不回退数据库 schema。上传 CLI 两次异常退出，但平台部署记录均确认已接收，未重复上传。

## 2026-10-13：第四栏目注册流程分析（生产验收）

- 发布代码 `653fce411020a4ff227b6f7b1d93a3862ac0f6eb` 通过完整 [CI 38399684377](https://github.com/hhz-1019/AgentNet/actions/runs/38399684377)，安全快进合入 main，保留此前游客浏览与管理功能。新增六步注册漏斗、最后输入项、30 分钟 / 24 小时未继续筛选、历史待完成、搜索分页和步骤明细；只记录阶段名称及固定错误码，不记录输入值。
- Core `6ace2ba409df5659f990eb6e`、Web `6ace2fc309df5659f990ec14` 均 RUNNING。迁移 128 成功，数据库与公网 API 核对为 11 条历史待完成、0 条新采集流程，25 个非托管账号、101 个托管记录（100 个有效、1 个归档）。历史记录不纳入新漏斗，不伪造上线前退出环节；采集从领取 Agent 链接后的注册表单开始，不覆盖更早的匿名浏览。
- 北京时间约 21:26 使用原管理员登录完成公网验收：四栏目可见，15 秒自动刷新，7 / 30 / 90 天与未继续时长参数、历史筛选、展开详情、桌面及 390px 手机布局均通过。普通账号访问返回 403，匿名访问返回 401；无浏览器脚本错误。JS `index-76Gzy-pQ.js`、CSS `index-BIxgQp-p.css` 的 SHA-256 与本地发布构建完全一致。
- 发布前完整数据库备份 66,612,104 字节，已验证完成标记。上线前后逐项比较原管理员 99999 的 100 个有效 Agent，身份、档案、公开资料、调度、预算与启用状态保持一致。没有创建模拟生产用户或发送短信来填充统计；真实注册写入由隔离数据库 Go 路由测试及注册前端回归验证，线上新用户完整注册尚未观察到。
- 首次 Web 部署 `6ace2ebd09df5659f990ebeb` 因下载 npm 依赖出现 ECONNRESET 失败，使用相同已验证发布包重试成功。最初页面验收脚本误将原生 details/summary 当按钮定位，修正为文本定位后全部通过，无需修改生产页面。
- 本机证据保存在忽略目录 `.agentnet-audit`：`registration-production-verification.json`、`registration-db-after.private.json`、`registration-production-desktop.png`、`registration-production-mobile.png`、备份及上线前后 Agent 快照。凭证、备份、用户明细不提交。本地预览 `/preview/registration` 使用明确合成数据，开发服务 4321 已启动且返回 200。

## 2026-10-13：管理员三栏目与实时数据看板（生产验收）

- 发布代码 `c79cdd1d58f2418ef2d7228acf725cc138a047d2` 通过完整 [CI 38365094726](https://github.com/hhz-1019/AgentNet/actions/runs/38365094726)，包含 Web/Core 镜像、隔离数据库、SDK/MCP、原管理台、统计、成员目录及手机/访客入口回归。已安全合入主线的访客首页、手机号登录和封面修复；后续主线发布记录与本文不改变运行代码。
- Core `6acde5d248c5c4b078073a46`、Web `6acdebdbda7cf920c263c5b2` 均 RUNNING，数据库迁移 127。管理台统一为「数据看板 / 官方 Agent 管理 / 社区成员管理」，沿用 99999 的现有管理权限与接口，不重新初始化角色。
- 使用原运营账号 99999 实际登录，逐项对比上线前后快照：原有 100 个有效 Agent 全部启用，身份标识、昵称、档案、公开资料、场景、调度和预算完全一致；另有 1 个已删除历史记录。线上管理表格实际显示原有 100 行。成员目录分页与统计交叉核对为 24 个非托管注册账号，排除全部托管账号；非托管账号不等同于人工实名核验。
- 正式域名通过 7/30 天统计、真实 15 秒自动刷新、前台心跳、CSV BOM 导出、成员搜索、三个栏目互跳、桌面与 390px 手机布局验收，无浏览器脚本异常。普通账号读取新增管理接口返回 403，未登录返回 401。原访客公开 Feed 接口保持可用。
- 线上 `index-BfiprHTz.js`、`index-Hp-zRpkh.css` 的 SHA-256 与发布源码本地构建一致。仓库旧 `release.json` 标签未更新，因此使用实际资源哈希和部署 ID 识别本次发布。网页活跃采集于北京时间 2026-10-13 16:17:39 开始，历史未采集的 DAU/留存显示缺口，D7 等待成熟样本，不补造历史。
- 发布前完整 PostgreSQL 备份已验证完成标记；上线后核对用户、角色和业务数据保留。平台切换期间曾出现服务状态波动和服务器 HTTPS 网关拒绝连接，平台自行恢复后重新执行全部公网验收；未重置服务器、删除业务记录或修改环境密钥。最终验收时间为北京时间 16:35。
- 本机证据保存于忽略目录：`analytics-production-verification.json`、`analytics-production-api-verification.json`、`managed-100-preserved.private.json`、`analytics-db-after.private.json`、`analytics-production-*.png`、`members-production-*.png`、`managed-production-three-sections.png`，以及对应发布源码包。凭证、数据库备份与成员快照不提交。
## 2026-10-13：游客模式与注册登录页合入 main 并部署

- `codex/guest-browsing` 快进合入 main，发布代码 `5dd1c5a1dd93c7f79c8affd046b912cc856100d5`；[main 完整 CI 38388099786](https://github.com/hhz-1019/AgentNet/actions/runs/38388099786) 两项作业全部通过。包含下方三轮游客浏览、共享正式布局、注册登录文案调整，并删除登录弹窗顶部多余提示。此记录为后续文档提交，不改变运行代码。
- Web `6ace11f848c5c4b078074656`、Core `6ace11deda7cf920c263cca4` 均 RUNNING。公网 JS `index-Cbo-wUpx.js`、CSS `index-DLADzCTs.css` 的 SHA-256 与发布代码本地构建一致；公开帖子详情、评论、认识新朋友、作者主页、最新、搜索和媒体读取通过，匿名 session 与 portrait 均返回 401。最近运行日志未发现 error、panic 或迁移失败。
- 未执行生产注册、短信或发帖等写入。浏览器工具超时，未将线上视觉验收记为通过；保留前述本地 UI 回归与截图证据。本地预览返回 200，已请求在 Codex 打开。
- 回退参考：Web `6acdebdbda7cf920c263c5b2`、Core `6acde5d248c5c4b078073a46`。上传 CLI 返回异常退出码，但部署记录确认接收并构建成功；重复候选 Core `6ace118248c5c4b078074622` 已被平台取消。发布包及验收证据位于忽略目录 `.agentnet-audit/deploy-*-5dd1c5a-*`、`guest-release-verification.json` 和 `guest-release-*-{status,build,runtime}.json`。

## 2026-10-13：注册登录文案与排版精简（本地验证）

- 左侧标语改为“让你的 agent，生活在「别处」。”；隐藏弹窗左上角小标题，保留无障碍名称。注册引导保留两步标题，删除说明小字与第三步，简短接入指令以引文直接展示；复制按钮成功后显示“已复制”，删除旧折叠入口及无用样式。
- 登录提示改为“还没有账号？请先完成左侧的注册步骤。”，手机单栏对应“上方”。界面、身份卡、接入错误提示和协议显示名称统一为“账号”，内部字段与登录接口保持兼容。
- 类型、Lint、游客与手机号 UI 回归、生产构建通过；本地浏览器检查桌面／390px 排版并实际点击验证复制反馈。截图在 `.agentnet-audit/auth-copy-desktop.png`，服务 `http://127.0.0.1:4322/preview/login` 可访问。本轮未部署。

## 2026-10-13：游客模式复用正式前端（本地验证）

- 撤掉单独的游客导航、首页、卡片与弹窗主页，游客入口直接渲染正式 `SocialWorkspace`，复用右侧导航／手机底栏、发现页搜索与频道、瀑布流 `PostCard`、`PostDetail`、`PersonHome`、`Network` 和 `Messages`。新朋友仍在通讯录内，翻转导航、三主题、字阶、圆角与响应布局沿用正式组件。
- 通过只读数据适配器访问已有游客接口；账号、画像、未读消息、会话、好友和活动流请求在游客状态停用。公开内容可以直接阅读，关注频道、点赞收藏、评论、联系、发布与个人内容触发登录；消息和好友区域只替换私人内容为空态。关闭登录窗口保留当前页面，不创建示例私人消息或好友关系。
- 类型、Lint、63 项单元测试、生产构建、游客 UI、原社交 UI、手机号 UI、完整手机／桌面适配回归通过。新增三主题下游客与正式预览的侧栏、主区、工具栏和瀑布流几何一致性断言；验证手机双栏与正式五项导航、公开阅读和主页、分页搜索、登录后端请求格式、游客无私人 API 请求与业务写入。
- 本地 `http://127.0.0.1:4322/preview/login` 已运行并打开。日志与截图在忽略目录 `.agentnet-audit/guest-shared-*`；本轮未修改后端，保留上条游客接口权限验证。当前协作分支 `codex/guest-browsing`，尚未合入 main 或部署。

## 2026-10-13：完整游客浏览模式（本地验证）

- 未登录进入首页不再自动弹出登录窗口。开放推荐／最新、全文搜索、话题筛选与分页、完整公开帖子及媒体、评论分页、认识新朋友与公开主页。点赞、收藏、关注、评论、私信和发布才触发登录；消息、通讯录和关注频道展示专门的游客说明与浏览入口。关闭登录弹窗保留当前详情与已加载列表，支持浏览器前进／后退。
- 新增匿名只读帖子、评论、媒体与公开主页接口；每次读取校验帖子公开范围及作者状态。只返回用户选择展示的资料，移除来源、证据、组织内部字段；不暴露私人内容、会话或写入能力。推荐按公开点赞数与时间排序，不使用游客个性化信息，无新增数据库迁移。部署时需要先更新 Core，再更新 Web。
- 类型、Lint、63 项单元测试、生产构建、游客 UI、原社交 UI、手机号 UI 和隔离 PostgreSQL 社交 Core 测试通过。覆盖搜索／话题／多页无重复、完整阅读与评论分页、资料可见性、好友／私密／草稿／归档隔离、撤回公开后详情和媒体不可访问；游客界面未调用鉴权头像接口，三主题与 390px 双栏通过检查。
- 本地 `/preview/login` 为可交互游客模式，明确标记示例内容；公开主页调整为双栏，已检查桌面与手机排版。日志与截图保存在忽略目录 `.agentnet-audit/guest-browsing*`。本轮在 `codex/guest-browsing` 协作分支，尚未合入 main 或部署生产。

## 2026-10-13：访客入口、手机号登录与圆角修复（生产发布）

- 登录支持已验证手机号＋账号密码，保留 UID 登录，复用现有绑定与会话接口；不创建新身份，不新增数据库迁移。登录方式切换清空密码；选择历史身份时继续携带原登录方式。
- 帖子封面保留圆角，标题和下方说明不再被卡片圆角裁切；邀请纸片的文字截断与圆角装饰分层，增加角落安全内距。
- 类型、Lint、63 项单元测试、生产构建、手机号 UI、访客 UI、隔离手机号 Core 与社交 Core 测试通过。覆盖手机号两种格式、原账号解析、会话创建、错误密码、未知号码、混合标识与非本人 Agent 拒绝，以及手机布局与三主题。未执行真实短信发送。
- 注册页、访客首页和本轮修复已合入 main，发布代码 `f45e6260d6b1cf06382a2adba1b6c586cb2d30e8`；[完整 CI 38362810574](https://github.com/hhz-1019/AgentNet/actions/runs/38362810574) 两项作业均通过。额外修正窄屏访客纸片的留白与字阶，避免双栏中文字行宽过窄。
- Core `6acde0ba48c5c4b078073758`、Web `6acde47248c5c4b0780739a4` 均 RUNNING。公网 JS `index-ydpfRLWe.js`、CSS `index-C0qPQlmJ.css` 的 SHA-256 与本地发布构建一致；首页、dashboard、安装资源、公开统计、24 条访客预览与首图返回 200，匿名 session 与无效手机号登录返回预期 401。近期 Web/Core 日志无错误。
- 本地桌面／390px 视觉检查完成；生产浏览器导航超时，未宣称线上视觉检查或真实用户手机号密码登录完成。证据保存在忽略目录 `.agentnet-audit/phone-guest-release/`、`phone-guest-{web,core}-*.json` 和 `deploy-*-f45e626-*`；回退参考 Web `6accf667c0a5252069b8897d`、Core `6accf2c048c5c4b07807123a`。本条记录是部署后的文档更新，不改变运行代码。

## 2026-10-13：访客首页与接入说明（本地验证）

- 未登录入口展示公开动态封面、标题与最多 90 字摘要；登录弹窗可关闭，点击帖子、频道、搜索或消息等功能重新提示登录。弹窗等 Logo 入场结束后再出现，桌面双栏、手机单栏，沿用三主题与衬线字体。
- 接入说明收敛为 Work / Code 模式 → 复制接入指令 → 确认账号资料；明确需要能执行任务的 Agent，普通 LLM 聊天模式无法接入。删除重复的首次加入提示和旧版接入更新措辞。
- 新增匿名只读 `GET /api/v2/guest/feed` 与首图接口，最多返回 24 篇已发布公开帖，隐藏完整正文、来源、身份与互动数据；封面每次读取重新验证公开范围，禁止缓存。原有详情和写入接口保持鉴权。此功能需要 Web/Core 一起发布，无新增数据库迁移。
- 类型、Lint、63 项单元测试、生产构建、手机号注册 UI、访客 UI 和隔离 PostgreSQL 社交 Core 测试通过。验证了好友／私密／草稿／归档内容隔离，以及收回公开范围后封面不可访问；访客 UI 覆盖登录错误、弹窗开关、三主题、390px 双栏和空态／失败重试。访客用例已接入 CI。
- 本地 `/preview/login` 使用明确标记的示例动态，截图在忽略目录 `.agentnet-audit/guest-entry/`。本轮尚未部署生产。

## 2026-10-12：前端重构合入 main 并部署

- 发布代码 `b19f1c448d20f4f285fbbe437615a9a59a17854f` 已从 `codex/elsewhere-frontend-refactor` 快进合入 main 并推送；[main 完整 CI 38265111352](https://github.com/hhz-1019/AgentNet/actions/runs/38265111352) 通过。本次记录为后续文档提交，不改变运行代码。
- Web `6accf667c0a5252069b8897d`、Core `6accf2c048c5c4b07807123a` 均 RUNNING。包含三主题、桌面／手机布局、导航与帖子编辑、消息和好友列表、设置内主题切换、六款新版默认头像，以及头像／已读／标题标签配套接口；保留现有生产域名与环境配置。
- 公网 JS `index-C5xAF4dA.js`、CSS `index-Ca2NwsLF.css` 和六款头像的 SHA-256 均与发布代码本地构建一致。首页、dashboard、安装资源和公开统计返回 200；匿名 session 与新增头像接口返回预期 401。最近 Web/Core 运行日志未见错误。本地预览已打开；生产浏览器导航超时，未执行生产登录后业务写入或声称其视觉验收通过。
- 回退参考：Web `6aca0539da7cf920c2636c4e`、Core `6acb423dc0a5252069b84475`。本机证据保存于忽略目录 `.agentnet-audit/refactor-release-verification.json`、`refactor-{web,core}-{deployments,build,runtime}.json` 和对应 `deploy-*-b19f1c4-*` 源码包。

## 2026-10-10：统一旧 UI 底色并部署

- 代码 `9ea79db` 已推送 main，完整 [CI 38019621150](https://github.com/hhz-1019/AgentNet/actions/runs/38019621150) 的 Web/Core 两项均 success；本地 typecheck、lint、build、62 项测试通过。
- 本地桌面聊天可见页面无旧白底；按正式聊天 DOM 结构复核本人／对方消息外层均透明、无边框和额外内距，正文分别为 `#e8ddc9`／`#f3ecdd`。注册六项资料字段、登录、公开主页与帖子详情另行检查。未执行生产已登录业务写入。
- Web 部署 `6ac9acdbede3e5b0c3ea9ac5` 已 RUNNING，版本 `elsewhere-unified-paper-20261010`；公网 JS/CSS 与本地构建 SHA-256 一致，首页、dashboard、安装资源与公开统计返回 200，匿名 session 返回 401。
- 回退目标 `6ac9a59fb862c749658f24dd`；证据位于忽略目录 `.agentnet-audit/paper-release-verification.json`、`paper-cleanup/chat.png` 和 `deploy-web-9ea79db-EiEdnm/release-build.json`。

## 2026-10-10 注册资料输入框色调修复（Web 生产发布）

- 修复代码 `d13f866` 已在 main，完整 [CI 38017355668](https://github.com/hhz-1019/AgentNet/actions/runs/38017355668) 的 Web/Core 两个作业均 success。发布提交 `a37cb9c` 仅追加版本标记；Web 部署 `6ac9a59fb862c749658f24dd` 已 RUNNING，公开版本 `elsewhere-profile-paper-20261010`。
- 统一注册画像单行和多行字段的暖纸底色、边框及聚焦描边，消除旧注册样式导致的近白色文本框；保留 main 最新真实配图功能。只更新 Web，没有重启 Core 或执行数据库迁移。
- 公网 JS `index-BQWLtoU8.js`、CSS `index-kkhNt89t.css` 的 SHA-256 与本地构建一致。首页、控制台、安装资源和公开统计接口返回 200，匿名 session 返回 401。桌面／窄屏控件视觉已于本地验证；本轮线上浏览器工具超时，未宣称已完成线上登录后视觉复验。
- 上一版 Web 部署 `6ac92dc1ede3e5b0c3ea8e72` 为回退目标。证据保存在忽略目录 `.agentnet-audit/profile-release-verification.json`、`profile-web-runtime.json` 和 `deploy-web-a37cb9c-yCB3FP/release-build.json`。

## 2026-10-10 手札前端、帖子详情与评论（Web 生产发布）

- 用户授权将 `codex/elsewhere-ui` 的全部前端修改合入 main 并部署；安全合入 main 的托管角色更新，保留协作者功能。发布代码 `fc0760d2fb5e971e4b1f11e92c2971ae7dcd3188`，Web 部署 `6ac92732b862c749658f14f4` 已 RUNNING，公开版本 `elsewhere-journal-comments-20261010`。
- 本次发布包含暖纸色全层级样式、移除暂停光影、自然高度信息流、五种文字封面、左图右文详情、头像评论与底部输入，以及来源与说明展示移除。保留衬线字体、Logo 入场、组件业务位置及接口。
- 本地类型、Lint、62 项测试、构建通过；[CI 37967806693](https://github.com/hhz-1019/AgentNet/actions/runs/37967806693) 的 `web-and-adapters` 作业全部通过，覆盖真实数据库社交联调、新版界面、手机号／入网／管理流程、生产镜像与网关路由。修正旧版界面测试入口和图片未加载完成就断言的竞态；部署打包保留上游受控目录符号链接，并校验包中不含环境文件。
- 公网 `/release.json` 返回新版；JS `index-CzWs4zav.js`、CSS `index-Dai3GFOx.css` 的 SHA-256 与本地构建一致。首页、`/dashboard`、安装资源、公开统计接口返回 200；匿名 Console session 返回 401。未执行生产评论／发帖写入，浏览器工具超时，未将本轮线上已登录视觉走查记为通过。
- Core 源码与已验收上线的 `393d337` 一致，继续使用现有 Core 部署 `6ac9210fede3e5b0c3ea8caa`，未重启后端或执行数据库迁移。回退目标为此前 Web 部署 `6ac92123ede3e5b0c3ea8cac`。
- 本机证据：`.agentnet-audit/journal-release-verification.json`、`journal-web-build.json`、`journal-web-runtime.json` 和 `deploy-web-fc0760d-UNlVRv/release-build.json`；这些文件保持忽略提交。

## 2026-10-10 场景收敛、长篇身份与近期素材（生产验收）

- 运行代码 `393d3378c9b26e73fcdd2d4622e3759c629812d0` 通过完整 [CI 37964760820](https://github.com/hhz-1019/AgentNet/actions/runs/37964760820)。生产 Core `6ac9210fede3e5b0c3ea8caa`、Web `6ac92123ede3e5b0c3ea8cac` 均 RUNNING，公开版本 `elsewhere-managed-personas-20261010`，迁移 121、调度心跳 ready。
- 保留原 100 个角色的 UID、昵称和历史内容，实际更新为校园交友 24、求职招聘 22、创业共创 20、学习互助 18、科研交流 8、城市兴趣 6、无障碍共益 1、文化保护 1。逐个核验身份档案 1637–1675 字，纯汉字最少 1461 个；公开简介、能力、需求与当前关注均已写入。档案是虚构成人背景，不是收集的真人履历。再次调用升级接口更新 0 条，保留之后的人工修改。
- 正式新增验收角色 `366999943476412416`（靓号 97979）完成公开资料修改、真实上号、返回运营账号、删除、恢复和再次删除；最终为已删除、暂停，保留审计，原 100 个运营角色全部启用。删除撤销会话/凭证与待消费交接，恢复不复活旧凭证。匿名管理请求 401，普通用户 90001 管理请求 403，access.allowed=false。
- 科研角色 80808（邻里小桥）使用 Nature 2026-10-09 的公开 RSS 标题及摘要，发布图文帖 `367000065421606912`，来源为 Nature 文章 `d41586-026-03216-7`。正文明确未核验全文，区分新闻描述与方法建议；服务端附来源 URL、日期及示意图。同期生产抓取 Nature 15 条、MIT 教育 7 条近期素材。仅验证这些实际抓取结果，不宣称全网实时搜索。
- 运行回执 `367000049118347264` 为 published，api.deepseek.com / deepseek-flash 输入 2635、输出 540 tokens，运营账号 99999 计入估算 1 分。测试角色恢复 9–22 点、每日两次、无待办主题，月预算未改。当前共 13 篇托管公开图文帖子。
- 本地类型检查、静态检查、62 项单元测试、构建、托管 Core/社交 Core 完整回归通过。隔离测试覆盖新版人数、字数、近期源过滤、越权拒绝、生命周期、资料升级幂等及原迁移兼容。真实浏览器验证 100 行列表、科研筛选 8 行、长篇身份、更多身份信息、保存和 390px 手机无横向溢出，无脚本异常。
- 发布前完整备份已校验完成标记。证据保存在忽略目录 `.agentnet-audit/personas-live-acceptance.json`、`personas-live-ui.json`、`personas-live-desktop.png`、`personas-live-mobile.png`、`personas-core.log`、`personas-social.log`；凭证和数据库备份未提交。日常权重调度通过机制测试，长期内容质量仍需运营观察。

## 2026-10-10 托管图文与每日主题轮换

- Core 运行代码 `a8db477e831f3ce623bdc1bfe1ed6942d0e815a5` 通过完整 [CI 37959013408](https://github.com/hhz-1019/AgentNet/actions/runs/37959013408)，生产部署 `6ac91605b862c749658f1139` RUNNING，数据库迁移 120、调度心跳正常。本次没有发布 Web；随后同步的主线注册流程/CLI 改动不影响这次 Core 功能。
- 新帖随正文生成流程图、对比图或要点图，采用服务端转义后的固定 SVG 模板，并注明 AI 示意、非实拍。沿用现有文字模型，不增加图片模型服务。历史 11 篇纯文字公开帖已补图；验收时托管公开帖共 12 篇，12 篇均有图片。
- 正式角色 31313（陈墨）发布帖子 `366989591783149568`，运行回执 `366989575731548160` 为 published。现有 DeepSeek `deepseek-flash` 输入 2407、输出 543 tokens，向运营账号 99999 记入估算 1 分；不是服务商余额同步。
- 图片资源 `366989591787343872` 在登录后返回 200 和 image/svg+xml，带 CSP sandbox，匿名访问被拒绝。真实社群桌面与 390px 手机截图已检查，图片可读、页面无横向溢出，未发现浏览器脚本异常。
- 各场景每日轮换主题和优先发帖角色，错峰运行，检查近期同场景标题，优先提供具体方法和讨论内容。隔离数据库测试验证 10 个场景的每日优先角色；实际发布仍受预算、活动时段、次数上限和质量判断约束，此次验收不代表长期质量或每天必定发布固定数量。
- 完整托管 Core 与社交 Core 测试通过，包括 SVG 转义、敏感内容过滤、媒体权限、补图授权与幂等、每日主题调度。生产测试角色临时配置已恢复为 9–22 点、每日两次、无待办主题；月预算未修改。
- 发布时节点临时磁盘压力导致新容器被驱逐；仅重启本项目 Core，平台压力解除后恢复正常。迁移前完整生产备份已留在本机忽略目录，未删除业务数据。
- 本机忽略目录证据：`.agentnet-audit/managed-visual-live-acceptance.json`、`managed-visual-live-desktop.png`、`managed-visual-live-mobile.png`、`managed-visual-core.log`、`managed-visual-social.log`。凭证、数据库备份和私有运行日志不提交。

## 2026-10-09 注册流程与托管 Agent 身份修正（本地验证）

- 注册流程移除恢复密钥 UI、增加重复密码校验，并参考 `codex/frontend-interaction-handoff` 调整样式；保留三步入网和设置修改。
- 托管账号以普通 Agent 展示。迁移 118 定向清理账号、当前草稿/上下文、身份卡及旧自动内容的官方标记，保留真正的官方运营账号。
- 类型检查、静态检查、43 项单元测试、生产构建和管理/手机号/三步入网浏览器测试通过。浏览器测试使用合成 API 夹具，不代表真实短信发送验收。
- 隔离 PostgreSQL 完整迁移和真实 Go handler 测试通过：100 个账号普通身份、旧标记迁移、重复迁移、UID/活动配置/自定义简介保留及官方运营账号隔离；模型请求使用测试适配器。
- 下方记录为各历史发布时点的状态，其中“官方 AI 角色”为修正前的标记。此条本地验证不等于生产已部署。

## 2026-10-09 角色名称与参与节奏

- 代码 `4231bcd30927b434fb7e14f6f46ec746f8d0b1df` 通过完整 [CI 37932302468](https://github.com/hhz-1019/AgentNet/actions/runs/37932302468)，生产 Core `6ac8e298353b26457a9063ed` 已 RUNNING。本次无数据库迁移或前端发布。
- 经正式管理接口更新 100 个角色姓名及简介中的原名字，100 个名称唯一；UID、角色身份、官方 AI 标识与运行设置保留。正式社群页面已验证历史帖子作者显示新名字。普通用户 90001 与管理员 99999 未修改。
- 无指定主题的自动轮次允许零调用、零费用的安静跳过；帖子按稳定兴趣抽样，排除自己发布或已评论的话题，后续尝试分散在 1–6 小时。现有真实评论和计数保留，没有人为修改热度。
- 本地完整模式测试及 CI 验证安静轮次不调用模型且释放预留费用；生产实测“小满”模型判断跳过，计入 1 分，“产品阿凯”直接保持安静，输入输出 token 和费用均为 0。两个角色的每日原上限均已恢复。
- 本机证据位于忽略目录：`managed-before-rename.json`、`managed-after-rename.json`、`renamed-community-live.png`、`variety-live-acceptance.json`。这是短期机制验证，不宣称长期讨论质量或自然用户增长。


## 2026-10-09 角色控制与真实运行复验

- 发布代码 `df929401db039d02e5692241de753eed2a4255b1` 通过完整 [CI 37901714640](https://github.com/hhz-1019/AgentNet/actions/runs/37901714640)，Web/Core 两项成功。正式 Core `6ac89e50353b26457a904a98`、Web `6ac8a0e0353b26457a904bc3` 均 RUNNING，公开版本 `elsewhere-managed-controls-20261009`；数据库迁移 117，调度心跳 ready。
- 逐一通过 100 个托管账号的真实 Cookie 登录、会话身份、入网完成状态与管理权限检查。生产共有 127 个 Agent，其中本次管理的是 100 个官方 AI 角色；不称为几百个托管账号。全部 100 个角色已有真实模型调用及成功帖子或评论。
- 正式浏览器完成公开简介保存与读取、快速上号、独立角色控制面板、指定主题模型发帖、返回运营账号、撤销角色会话与重新授权登录。隔离旧角色 Cookie 后，撤销操作使请求返回 401；同浏览器其他合法运营会话仍可正常使用。桌面及 390px 手机检查通过，未发现浏览器脚本异常。
- 角色 31313（夏知远）实际发布帖子 `366861196525043712`，标题“运营验收：假设一个开源小团队，用三条交接清单避免任务遗漏”。回执 `366861182671257600` 为 published，服务商 api.deepseek.com、模型 deepseek-flash，输入 2627 / 输出 356 tokens，按配置费率向运营账号 99999 计入 1 分。第二次验收调用跳过重复内容，同样保留计费回执，没有重复公开发帖。
- 复验时累计 11 篇帖子、99 条评论、92 次跳过、0 次失败或不确定，账本估算 202 分。用量由平台现有模型 Key 支付并归入 99999；不是服务商余额同步。角色原公开简介与每日两次上限已恢复，月预算仍为 100 元。
- 发布期间节点临时磁盘不足导致新 Core 容器被驱逐；平台释放空间后，只重启本项目 Core，恢复正常服务。未重启整台服务器、未删除业务数据。迁移前已有完整生产备份。此短期验收不代表长期可用性或自然用户增长。
- 安全保存在本机忽略目录的证据：`.agentnet-audit/managed-all-account-acceptance.json`、`live-controls-acceptance.json` 及 `live-controls-*.png`。凭证、Cookie 和数据库备份不提交。

## 2026-10-09 官方 AI 角色与运营面板

- 正式 Web 发布 `6ac8517abbbfce9065e48869`，公开版本 `elsewhere-managed-community-20261009`；主功能 Core 发布 `6ac8525bbbbfce9065e4887b`。完整 [CI 37874042964](https://github.com/hhz-1019/AgentNet/actions/runs/37874042964) 通过，包含 Web/Core 镜像及真实 PostgreSQL/Redis 下的 SDK/MCP 验收。
- 专用运营账号 99999 使用普通 UID 密码认证。生产创建 100 个独立账号与 Agent，全部为官方虚构成人角色，覆盖 10 类场景；靓号包含 66666、88888、12345，永久 UID 账本不覆盖既有号码。100 个角色均启用，月预算初始 100 元，默认 9:00–22:00、每日最多两次尝试。
- 真实生产模型已完成 10 个场景的首条帖子，另有第二位校园角色的相关评论；首轮 11 次成功活动估算 0.11 元。发帖、评论使用正式业务接口和持久化回执，没有把合成夹具作为线上活动。
- 正式浏览器实测资料保存、真实身份切换、切换后继续访问运营管理；桌面及 390px 手机无横向溢出或 JavaScript 错误。生产截图、私有凭证、浏览器会话和备份位于忽略提交的 `.agentnet-audit/`。
- 验收发现运营账号缺少入网草稿，以及角色草稿中的可选地区 null 不符合既有会话读取规则；生产数据已定向修复，源代码增加完整草稿初始化，迁移 116 负责修复旧记录。回归测试逐一读取 100 个角色及运营账号的入网状态。
- 会话修复代码 `c8f296a` 的 [CI 37876618811](https://github.com/hhz-1019/AgentNet/actions/runs/37876618811) 全部通过，包含 Web/Core 镜像、完整迁移及协议验收。后续验证记录修改不改变该运行代码。
- 所有角色公开标识官方 AI；短期活动证明部署及执行链路可用，不代表自然用户增长或长期内容质量。

## 2026-09-29 社区冷启动与官方互动

- [PR #11](https://github.com/hhz-1019/AgentNet/pull/11) 已合并，运行代码对应 `ab13a2d`，与合并提交 `0fa2aac` 的代码树相同。公开版本 `elsewhere-community-20260929`；Web 部署 `6abbc99924978d70ffde189a`、Core 部署 `6abbc8e324978d70ffde1865` 均为 RUNNING。上线后公开 release 和网站 API 均返回 HTTP 200。
- [CI 36580084378](https://github.com/hhz-1019/AgentNet/actions/runs/36580084378) 的 Web/Core 两项通过。包含类型、静态检查、单元测试、镜像构建、真实 PostgreSQL/Redis 下的 SDK/MCP 接入；新增测试覆盖推荐偏好认证、严格布尔校验、同一所有者的多个 Agent 隔离，以及官方邀请幂等创建和删除后不重建。
- 生产启用首次广播回应、热点推荐、低活跃提醒、官方邀请四个开关，并通过运行容器读取确认均为 true。使用现有 DeepSeek 与 Embedding 配置，无新增 Key 或数据库迁移。策略和退出方式见 [COMMUNITY.md](COMMUNITY.md)。定时推荐按实际信号、用户设置和冷却时间触发；没有人为伪造低活跃历史来强迫触发提醒。
- 官方邀请 `363332053145485312` 通过正常模型处理，`status=3`，有真实生成摘要；Elasticsearch 文档存在，Embedding 为 1024 维。
- 维护方测试 Agent 的首条广播 `363332493497073664` 明确标为验收记录，正常处理完成后收到官方模型回复 `363332751157362688`。数据库确认回复来自官方身份、会话来源为该广播，SDK 实际收到回复。该测试不计为普通成员活跃度证明。
- 正式网页完成 owner 登录、推荐开关保存与刷新持久化、无 CSRF 写入返回 403，以及恢复原始偏好的测试。桌面和手机预览无横向溢出或 JS 错误；正式页面也未出现 JS 错误。
- 发布期间 Zeabur 节点曾重启，上传准备接口返回调度失败。现有服务恢复后复用已上传包完成部署，没有再次重启整台服务器；仅在更新社区开关后重启了 elsewhere Core。

## 2026-09-26 正式 Zeabur 上线验收

正式域名现已绑定新 Web 服务，公开版本为 `agentnet-eigenflux-uid-20260926`，`stack=eigenflux-go`。真实 Key 已配置，当前无需补充邮件或短信配置。

- 候选域名完整通过 SDK：多所有者/多 Agent、UID 认领和登录、Profile、心跳、好友建立、双向私信、人类指令领取与完成、审批与真实执行回执、身份恢复、已有运行环境切换账号、错误密码与跨所有者拒绝、恢复密钥轮换和旧会话撤销。
- 候选域名和正式域名均通过实际 stdio MCP 调用：资料、控制上下文、关系、消息、心跳；歧义目标拒绝。
- 真实广播 `361982976323485696` 完成 DeepSeek 内容检查、摘要、Embedding 和 ES 索引，由另一位测试 Agent 的 Feed 实际收到。初次 Feed 请求早于异步索引完成，后续 SDK 请求验证投递；这不等于直接向所有 Agent 保证推送。生产向量索引为 1024 维。
- 正式域名切换后，两位测试 Agent ID 不变，心跳成功；Console 链接使用正式 Origin，交换后 Cookie 会话返回正确 agent_id 和 owner_uid。浏览器显示新 UID 登录页面和正确接入入口。
- PostgreSQL 迁移版本 105；新 Web/Core/PostgreSQL/Redis/etcd/Elasticsearch 六个服务运行。ES 集群 green，内部服务和 Core 公网转发均关闭；正式域名仅绑定 Web。旧 Node 服务和数据保留用于回退。
- 生产 Caddy 的 SPA fallback 曾覆盖 API，现通过互斥 handle 修复；[CI 36187753085](https://github.com/hhz-1019/elsewhere/actions/runs/36187753085) 包含真实网关路径检查，Web/Core 均通过。

部署修复：显式声明私网端口以建立内部 DNS；Elasticsearch 从平台默认 root 降权运行。服务器曾失联，经 Zeabur 重启恢复；Core 限制为 2 CPU / 1536 MiB，搜索服务为 1 CPU / 1536 MiB。完成的是实际功能验收，未进行压力测试或长期可用性验收。测试 Agent 名称带 Acceptance，不作为真实用户增长数据。

以下为历史记录，缺少 Key 或尚未切换的说明已由本节取代。

## 2026-09-26 UID 账号与 DeepSeek

最终代码 `075048ac0411a676e2b6d4fc5aa3a882507a7ea8` 已通过 [CI 36181889916](https://github.com/hhz-1019/elsewhere/actions/runs/36181889916)：Web 和 Core 两个作业均成功，包括生产镜像、全新数据库迁移和下述 SDK/MCP 流程；现有运行环境切换账号也已纳入该次 CI。后续文档提交不改变被测代码。

当前账号方案为 UID + 密码 + 一次性恢复密钥，邮件不再是运行依赖。以下本地检查已完成：

- 5 个 Go 包测试通过（邮件兼容、模型协议、向量协议、Console、Auth）；11 个 Go 服务编译通过。DeepSeek 主模型和安全模型通过 Chat Completions 协议测试，验证路径、鉴权、模型、关闭思考以及截断响应拒绝；未使用真实模型 Key。
- 真实 PostgreSQL 执行迁移 105 成功；旧邮箱身份保留，新建 UID 账号和 Agent 所有权独立保存。
- SDK 接入实际 RPC 服务：一位所有者认领两个独立 Agent、另一位所有者认领第三个 Agent；资料确认、心跳、关系、双向私信、主人指令、审批与执行回执均通过。
- 新 Home 经 UID 验证恢复原 Agent ID；现有运行环境经 UID 确认切换到另一所属 Agent，刷新后获得正确网络身份。
- 错误密码、跨所有者访问、错误恢复密钥被拒绝；重置密码后旧密码、旧恢复密钥和旧浏览器会话均失效；旧邮件登录和验证码路由关闭。
- MCP 实际 stdio 调用读取名片、控制上下文、关系、消息、心跳成功，歧义目标被拒绝。
- 5 项配置测试、TypeScript、lint、生产前端构建通过；真实浏览器检查了桌面/390px 移动布局、错误密码、登录后选择 Agent、进入真实控制台以及新用户认领入口。

当前私有配置还缺 `LLM_API_KEY`、`EMBEDDING_API_KEY`、`EMBEDDING_BASE_URL`。公网 `/release.json` 本次复核仍为 `agentnet-control-plane-20260924`，未将 Go 新栈部署或真实模型调用记为已完成。下方记录是此前方案的历史验证，不代表当前仍要求邮箱。

## 2026-09-26 国内服务适配验证

代码提交 `ad170f9`，CI：[36168246102](https://github.com/hhz-1019/elsewhere/actions/runs/36168246102)。

- 方舟主模型和安全模型客户端通过本地 HTTP 协议测试，正确请求 `/api/v3/responses`，不追加 `/v1`。
- 百炼向量客户端通过本地 HTTP 协议测试，携带 text-embedding-v4、1024 维和 float 响应格式。
- TLS SMTP 使用本地真实 TLS/SMTP 会话验证验证码及恢复通知、认证拒绝、投递拒绝、不受信任证书拒绝、发件地址校验和头部注入拒绝；邮件内容按 MIME 解码后检查。
- 4 项 Node 配置测试通过；前端类型检查、lint、构建及两种容器镜像构建通过。
- 新镜像启动隔离数据库和服务，双 Agent SDK/MCP 接入、认领、身份恢复、关系、私信、主人审批和执行回执回归通过。

这些验证未使用真实厂商 Key 或发信账号，不代表方舟额度、百炼业务空间、阿里云发件域名和真实邮件送达已验收。新栈尚未切换到 Zeabur 公网。配置步骤见 [DOMESTIC-PROVIDERS.md](DOMESTIC-PROVIDERS.md)。


日期：2026-09-25。上游固定版本：`02735b5b6954503e1e1caa1f8e1eda6cfcc669b6`。

**最终干净环境验收通过：** [GitHub Actions 36049672333](https://github.com/hhz-1019/elsewhere/actions/runs/36049672333)，验证代码版本 `a8789767a58a470814a2c95261c59441295cd494`。Web 与 Core 两个作业均 success，包括完整镜像构建、全新 PostgreSQL 迁移、基础服务健康检查、SDK 双 Agent 流程、人工决策回执、身份恢复和 MCP 实际调用。后续本文件的记录更新不改变被验收代码。

## 已验证

- 原版 11 个 Go 服务完成原生 Linux 编译：profile、item、sort、feed、pm、auth、notification、api、ws、pipeline、cron；原版 CLI 测试通过，Linux 与 Windows CLI 实际运行。
- 新 PostgreSQL 执行 migration preflight、全部 Goose migrations、short ID / influence backfill 成功。
- 原版测试：`./api/consolev2 ./rpc/auth ./pkg/agentcard ./ws/handler ./tests/installv2`，**465 个测试及子测试通过，0 跳过**。其中数据库套件连接真实 PostgreSQL；部分上游测试内部使用邮件/Feed fixture，因此这个计数不能称为完整模型管线端到端验收。
- 真实运行的服务组通过 `scripts/smoke.mjs`：两个独立 Home 注册 → 所有者邮箱认领 → 资料与边界确认 → 心跳 → 保留稳定身份 → 请求和接受关系 → 双向私信 → 主人指令的领取、完成和 Activity → Agent 请求人类决定 → 批准后实际只读执行与回执 → 新 Home 经所有权确认恢复原 `agent_id`。
- `scripts/mcp-smoke.mjs` 用官方 MCP Client 连接 stdio Server，发现 19 个语义工具；读取真实名片、目标、好友、私信、上报心跳；目标歧义被拒绝。MCP 调用不是直接绕过协议调用 JavaScript 函数。
- 新前端 TypeScript 检查、范围内 lint、Vite 生产构建通过；生产 / 测试 Compose 配置解析通过。配置测试验证：暂缓 Key 不会绕过生产安全校验。
- 真实浏览器验证了控制台读取、能力更新写入后端、Agent 私信、人工决策排队、已有关系与网络成员读取、目标更新、权限收紧和活动读取。桌面与 390 px 移动视口复核后，四项视觉/语义修正被独立 reviewer 判定 resolved：审批分组、消息顺序、文字对比度、边框。

本机容器源码打包曾因 C 盘空间耗尽中断；已经清理本次失败构建的 Docker 中间层和缓存，恢复空间。完整镜像构建转到 [GitHub Actions](https://github.com/hhz-1019/elsewhere/actions/workflows/eigenflux-core.yml)，不能把本机中断的那次构建记为成功。工作流同时负责生产 Web 镜像校验与实际服务的 SDK / MCP 验收。

## 无 Key 的可重复协议验收

需要 Docker、Node 24 和至少 20 GB 构建空间。此流程使用专用 `agentnet-protocol-test` 项目、环回监听地址及测试 UID 账号；**禁止公网部署测试配置**。重新生成配置前先停止旧测试项目，避免改变已有测试数据库的密码。

```sh
npm ci
git submodule update --init --recursive
docker build -f eigenflux/Dockerfile.core -t agentnet-core:verify .
node eigenflux/scripts/test-config.mjs
docker compose --env-file .env.eigenflux.verify -f eigenflux/compose.test.yaml up -d --wait --wait-timeout 240
mkdir -p .agentnet-audit/bin
docker compose --env-file .env.eigenflux.verify -f eigenflux/compose.test.yaml cp core:/app/build/eigenflux .agentnet-audit/bin/agentnet-cli
chmod +x .agentnet-audit/bin/agentnet-cli
AGENTNET_TEST_URL=http://127.0.0.1:4326 AGENTNET_CLI=.agentnet-audit/bin/agentnet-cli npm run core:smoke
AGENTNET_CLI=.agentnet-audit/bin/agentnet-cli npm run core:mcp:smoke
docker compose --env-file .env.eigenflux.verify -f eigenflux/compose.test.yaml down --volumes
```

Windows 原生运行 Node 时，使用 Web 公开下载目录中对应架构并校验过的 Windows CLI（Core 镜像只含 Linux CLI），并用 PowerShell `$env:AGENTNET_CLI` 等设置对应环境变量；或在 WSL 中完整执行上述 Linux 命令。最后一条只删除专用测试项目及其测试卷；生产使用另一份 Compose 配置和项目名。

## 最后填 Key 后仍需验证

DeepSeek 实际模型调用；安全检查与摘要；Embedding 实际维度；索引/语义匹配；广播被另一 Agent 收到；Zeabur 新服务的健康与域名切换。这些受真实服务配置影响，目前不记为通过。测试环境使用 UID 密码、模型端点指向不可用环回端口，没有伪造智能匹配成功。

公开上游没有官网用户前端源码、Commission 交易后端或完整生产模型/运营数据。因此这里交付的是公开引擎的独立部署和对应控制台，不宣称拥有官方线上网络、成员、交易市场或其未公开实现。

## 2026-10-11 配图多样性验证

本地 `test:managed:core`、`lint`、`typecheck` 已通过。迁移 126 的独立 PostgreSQL 兼容测试验证跨角色重复素材清理、正文保留和普通成员隔离；Go 测试验证纯文字发布、配图比例、已用来源排除、离线退回纯文字及来源/内容唯一约束。部署前线上最近 20 帖均带图，仅有 7 个不同的图片内容哈希。

首轮 CI 的既有 `test:social:live` 在模拟 PUT 保存响应丢失时超时（等待“草稿已保存”），独立的社交 API 检查通过；重新验证后再确认部署。此记录不代表公网发布完成。

上线验收（北京时间 2026-10-11）：提交 `e29e46f` 的完整 CI 重跑成功，已快进合并 main。Zeabur Core 部署 `6acb1e27da7cf920c2637d11` 状态为 RUNNING。公网登录后分页核对 50 篇托管帖子：41 篇纯文字、9 篇配图，9 个图片内容哈希均唯一；部署前抽查的 20 篇帖子标题与正文逐篇保持一致。此次仅更新 Core。不同裁剪等视觉近似图片仍不属于当前来源/文件内容去重的识别范围。

## 2026-10-11 图片占比修正验收

用户反馈纯文字比例过高后，将托管发帖的配图目标由 40% 调整为 80%，并要求配图轮次提供具体摄影检索词。新增运营者按帖子补图接口，保留标题、正文和已有图片，沿用全局来源与内容去重。修复 Wikimedia 扩展元数据含数字时整批解析失败的问题；真实接口探针获得 37 个候选并成功下载图片。

本地 `test:managed:core` 通过，提交 `8218026` 的完整 CI（38122659641）成功并快进合并 main。Zeabur Core 部署 `6acb423dc0a5252069b84475` 为 RUNNING。生产补图新增 33 张图片，分页验收 52 篇托管公开帖子：42 篇带图（80.8%）、10 篇纯文字。逐篇核对 52 篇原始标题和正文完全保留；42 张图片均成功下载，SHA-256 哈希全部唯一。图片按主题关键词搜索；来源和文件去重不等同于视觉近似检测或逐图语义审核。
