# Elsewhere 命名清理

本文件记录源码清理范围和本地验收；实际发布状态以 CI、发布回执与线上提交为准。用户取消了人物 Agent 改名；人物目录和线上昵称均未修改。

## 已替换

- 项目主目录改为 `elsewhere`，上游引用目录改为 `upstream/elsewhere`。
- CI 工作流改为 `elsewhere-core.yml`，同步更新 npm 命令、Docker、Compose、发布脚本、测试与文档引用。
- 容器内部 CLI 产物改为 `build/elsewhere`；公开安装命令仍使用现有的 `agentnet`。
- 私有配置主文件改为 `.env.elsewhere`。配置读取兼容旧 `.env.eigenflux`；执行 `npm run core:configure` 或 `npm start` 会沿用旧配置生成新文件，保留旧文件。已有值不会重新生成或打印，两个文件同时存在时优先使用新文件。
- 自有提示词的产品名称改为 Elsewhere；发行包中的上游许可证文件名改为 `LICENSE-upstream`。

## 有意保留

全量扫描包含 Git 管理文件、新增文件及固定版本的上游子模块。二进制仅检查文件路径；文本检查名称与内容。忽略的私有配置、Agent Home、依赖安装目录、构建产物及历史审计快照不进行批量覆盖。

以下名称代表来源或兼容约定，不当作产品品牌直接替换：

|范围|保留原因|
|---|---|
|上游仓库 URL、许可证和来源说明|真实来源与法律归属不能伪造；固定源码版本未改变。|
|上游源码及补丁上下文|补丁必须能应用到固定依赖；不直接修改子模块。|
|Go 模块和导入名|`eigenflux_server`、`cli.eigenflux.ai` 属于固定依赖的编译命名空间。|
|`.eigenflux` 身份目录、旧环境变量、协议 schema 和旧任务归属标记|保护已有身份、签名凭据、其他网络连接和现存定时任务。|
|官方 EigenFlux 网络的独立操作分支和说明|CLI 同时支持不同网络，不能把官方网络的身份与 Elsewhere 混同。|
|审计规则中的旧名称|用于检测以后是否重新引入旧项目路径。|

逐文件位置、行号、出现次数及分类见 [brand-rename-audit.json](brand-rename-audit.json)。在仓库根目录执行 `node elsewhere/scripts/brand-audit.mjs --write` 可重新生成。审计清单会明确保留项，不宣称仓库内已没有任何旧单词。

## 本地验证

- npm 单元测试 207 项通过；TypeScript、lint、前端及事项面板构建通过。
- 真实补丁应用、CLI 编译、CLI 测试、安装和升级协议、SDK/宿主活动协议、注销同步协议通过；使用本地隔离测试身份。
- 托管 Agent 后端回归与迁移回滚验证通过；没有修改线上数据。
- 部署脚本测试在 WSL/Linux 环境 19 项全部通过；首次 Windows 运行不兼容 POSIX 测试夹具，转到 Linux 并安装其缺少的 jq 后通过。
- 本地预览：<http://127.0.0.1:4322/preview#crossing>。该预览使用样例数据，不代表生产部署验证。
