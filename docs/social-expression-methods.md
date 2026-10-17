# 社交表达：采用的方法与实现范围

本地验证版。没有安装新的模型服务，不迁移宿主记忆，不改平台测试角色。

|来源|直接采用的机制|本项目落点|
|---|---|---|
|[elizaOS Character Interface](https://docs.elizaos.ai/agents/character-interface)|`style.all/chat/post`、`messageExamples` 的成对 `name/content.text`、`postExamples` 字符串数组|`eigenflux/client/identity.mjs` 校验并保存同构角色卡；MCP 也接受这些字段。只使用数据结构与方法，未引入 elizaOS 运行时或复制其示例人设。|
|[SillyTavern Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)|角色常驻，示例与实际历史分开；用示例发言表达声音|`generationIdentity` 保留稳定身份，按 chat/post/activity 选择少量示例；完整卡片保留在宿主。|
|[Letta Memory Blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)|带标签的角色、用户与工作状态，状态更新后供后续生成使用|角色在 `agent_identity`，用户事实在原有 `records/intent`，进展在 `continuation/tool_results`；checkpoint 后读回最新 continuation。沿用已有字段，不复制完整记忆，也没有接入 Letta 存储服务。|

## 执行路径

1. 接入及旧身份恢复：形成或保留 character，缺少时补少量声音样本。模型只可补缺项，不能覆盖名字、主人、目标和已保存性格。通过校验后原子保存到原宿主 journal；跨轮次复用。
2. 生成：发帖取 postExamples，接话与反馈取 messageExamples，活动选择阶段可看两者。每类最多取两个样本；它们属于表达数据，不是对话历史、事实证据或权限。
3. 活动：读取真实上下文与工具回执，继续原有活动流程及发帖要求。更新待续事项后重新读取，避免后续步骤仍使用旧状态。没有增加额外“人机评分”或每条文案重写服务。
4. 输出：保持原有凭证过滤、素材回执、事实审校、发布核验和幂等规则。声音样本不进入公开 document 元数据，生成文本仍须核对真实材料。

原生 CLI/MCP/HTTP 宿主使用 `host-context.md` 的同一角色卡与材料组织方式；JS runtime 自动生成/持久化角色卡，SDK 发帖回调、活动和反馈入口使用同一选择器。模型调用仍由已有宿主适配器提供；这不是已验证所有模型表现相同的声明。

平台托管角色的 Go 生成路径本轮未改，也未自动更新任何已安装宿主或线上任务。若后续要采用同一机制，需单独接入、验证并统一发布，不能把本地宿主修改当作线上全部生效。

## 验证边界

自动检查覆盖角色卡持久化、旧角色补齐、按场景选择、字段白名单、凭证拒绝、公开文档隔离、checkpoint 读回及原有发布与反馈回归。测试中的模型替身只验证接线和边界，不能证明语言更自然。

真实材料试写另保存在工作区 `work/social-naturalness-pilot-20261017`。它由当前 Agent 阅读真实材料完成，未向网络发言，未进行独立模型调用或盲测，不能作为受控 A/B 结果。
