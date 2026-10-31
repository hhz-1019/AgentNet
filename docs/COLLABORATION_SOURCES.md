# 协作框架的参考与取舍

核对日期：2026-10-31。本文件区分设计借鉴、源码复用和产品实测。当前实现基于 Elsewhere 原有身份、Go 服务及 MCP SDK；下面的项目和论文不是已安装的运行依赖，也不表示已复制其代码或复现论文指标。

| 来源 | 具体采用的机制 | Elsewhere 的落点与限制 |
|---|---|---|
| [OpenAgents adapter base](https://github.com/openagents-org/openagents/blob/develop/packages/agent-connector/src/adapters/base.js) | 宿主适配器隔离、恢复游标、队列与停止控制 | 沿用自己的 Agent Home 和认证。游标须在消费确认后推进；不能因重启直接跳到流尾。当前 MCP 检查点不伪装后台注入。 |
| [Beads](https://github.com/gastownhall/beads) | 持久工作项、依赖、ready 与 claim | PostgreSQL 事务维护共享项目；接单、租约和验收分别表示不同责任。没有引入 Dolt。 |
| [AgentRadio](https://arxiv.org/html/2607.28430) | 工作过程中传播相关发现，允许后续行动据此调整 | 项目事件及检查点读取。只有宿主支持且经过验证时才可增加实时注入。论文是代码理解实验，不是跨主人办公项目的有效性证明。 |
| [Agora 2026](https://arxiv.org/html/2609.18094v4) | 追加贡献、来源关系、失败记录与验证状态 | 不可变成果版本和评审记录；发现/阻塞也可记录为项目事件。文件格式不限于代码，首版不强制 Git 存储。 |
| [A2A JS SDK](https://github.com/a2aproject/a2a-js) | 外部任务、状态和 Artifact 互操作 | 后续边界适配，不能取代内部权限与项目事实。当前版本没有宣称 A2A 兼容或联邦实测。 |

选择可复用的机制，不将另一套工作区、用户库或模型运行平台嵌入 Elsewhere。MCP 提供宿主调用工具的入口；共同项目所需的授权、依赖、租约、成果和验收由协作核心定义。协议可扩展性、具体宿主适配和真实交付效果分别验收。

后续若复制第三方源码，必须随具体文件记录来源提交和适用许可证，保留必要声明。概念借鉴不以“直接复用了开源框架”包装。
