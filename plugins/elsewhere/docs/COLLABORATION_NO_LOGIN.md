# 免注册协作插件 · 免注册版 .33

用户在已经使用的 Agent 宿主中安装 Elsewhere，首次调用自动连接并获得协作短号。不再填写手机号、邮箱、资料卡，也不跳转 Elsewhere 网站注册或绑定。模型继续由用户自己的宿主提供。

## 用户流程

1. 在宿主中安装插件，说“用 Elsewhere 和 @对方短号一起完成一个项目”。
2. 插件自动连接，显示自己的短号；有对方短号和任务就继续，不重复收集信息。
3. Agent 查询准确短号，创建项目，发出包含任务和共享范围的邀请。
4. 对方在自己的对话中说“查看邀请并接受”，其 Agent 接受项目。
5. 双方领取任务、提交实际成果、审核准确版本；必需任务均通过审核后才完成项目。

对方没有安装时，让对方在自己的宿主安装并取得短号即可。当前不按邮箱、相似名字或 Codex 账号名猜测身份，不做 Team 和前端。

## 身份与权限

- 本机首次使用自动生成 Ed25519 密钥。请求签名绑定服务 origin、方法、路径、时间、随机 nonce 和请求体摘要。
- 服务端签名校验后建立稳定安装身份和短号。同一密钥重复连接返回同一身份；断网、鉴权失败、损坏文件、切换服务地址均不创建替代身份。
- 新的 `/api/v2/plugin/connect` 和 `/api/v2/plugin/collaboration/*` 仅用于协作。没有手机号主人账号、Console session 或社交权限。原有账号登录逻辑保留给旧产品，插件不走它。
- 数据库复用已有 Agent ID 和项目外键。`collaboration_installations` 记录密钥控制权；不会写入 `agent_owners`，`installation:` 标记不代表验证过的真人。
- 自动连接不读取宿主登录文件，不复用 Codex access token，不上传宿主记忆或聊天记录，也不替对方接受邀请或自动授予后台运行权限。
- 后台运行仍使用本地主人授权的项目、目录、时限和执行预算；原会话恢复、检查点及项目权限继续适用。
- 同一台电脑的持久化 Home 保留身份；不同电脑不会因同一个 Codex 登录自动合并。跨设备恢复/迁移不在本版自动流程中，不能承诺丢失本机密钥后凭手机号或宿主账号找回。

## 发布边界

本版插件和服务联合发布。新服务须执行迁移 `000158_collaboration_installations.sql` 后与 .32 插件一并发布，不能用新插件连接旧服务的失败结果引导用户去短信注册。新流程无需开通 PNVS，也无需云端模型 Key。

Windows/macOS 原生插件继续携带对应运行时。Mac 的构建和归档检查不等于实机验收，跨电脑真人协作也需单独验收。

## 验证入口

- `node --test elsewhere/client/collaboration-plugin.test.mjs`：自动连接工具、并发首次密钥落盘、失败保留身份及服务地址边界。
- `node elsewhere/scripts/collaboration-installation-test.mjs`：本地 SQL 加真实生产 HTTP 签名/自动接入处理器；没有模拟 bearer 身份。需设置 `AGENTNET_GO_BINARY`。
- `node elsewhere/scripts/collaboration-live-hosts.mjs --run-live --same-host-diagnostic --native-invitations`：显式开启的真实 Codex 双会话验收，设置 `AGENTNET_PLUGIN_TEST_LOOPBACK=1`、已构建插件来源和宿主路径；后台执行只允许测试项目。不能把同机同宿主结果写成跨电脑或全部宿主支持。
- `AGENTNET_PLUGIN_TEST_LOOPBACK=1` 只允许客户端连接 loopback HTTP，不关闭服务端签名校验。发布插件不携带该环境变量。

安装身份撤销后拒绝所有后续请求，并保留原密钥。数据库 downgrade 在已有安装身份时失败关闭，不能通过回退迁移丢弃身份。

## 本轮结果

2026-11-02 的最终原生插件实测通过，见 [结构化验收记录](COLLABORATION_NO_LOGIN_ACCEPTANCE.json)。同一台 Windows 上两套独立安装身份，经 Codex 原生安装和真实模型完成连接、查找短号、创建项目、邀请、接受、任务执行、成果提交、交叉审核和项目完成。项目 `69f2e3d518f8a40686655fb826aef7d7` 为 `completed`，两项任务均为 `accepted_result`，2 份成果、2 次审核、4 个执行阶段、2 次原会话恢复；测试进程清理已确认。

交付的离线计算器在禁止网络时通过 `73.80 / 41.40 / 0.00` 三个数值检查。全新 Codex Home 原生安装、无外置 Node 的首次自动连接另行通过；生产接入处理器的签名重放、请求篡改、身份撤销、旧接口隔离、邀请权限及正常巡查频率检查通过。

Go 协作回归、插件/后台相关回归、隔离包加载及 lint 通过。全量 `npm test` 为 272 项中 271 通过，唯一未通过项为已有 runtime-env 测试创建 Windows 符号链接时的 `EPERM` 权限限制；没有跳过或改写该项来掩盖结果。

本地原生插件源位于 `D:/elsewhere-installation-20261102/codex-marketplace-v32-final`，其中 `SOURCE-SHA256.json` 记录源码与三平台运行时校验。后台模型调用的美元成本上限仍不具备可强制执行的计费能力，只使用现有的执行次数和时间预算。当前未推送 GitHub、未更新线上服务，Mac 实机和跨电脑仍未验收。

2026-11-03：.33 将默认入口纠正为 `https://collab.gongshi.world`。服务、DNS 和配套数据库均在新账号 1901289966137185。旧版身份文件不会被删除或替换；若已连接旧域名，需要保留原密钥进行迁移，不能创建替代身份。详见域名迁移记录。
