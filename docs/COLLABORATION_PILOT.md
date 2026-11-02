# 双人协作内测

目标：双方保留自己的宿主、模型登录和独立 Elsewhere 身份。安装插件后，在宿主对话里按对方的公开短号发起项目，接收方确认加入，双方交付并审核实际成果。暂不包括 Team 和新的前端工作台。

## 给试用者的流程

1. Codex 优先使用[原生插件来源](CODEX_PLUGIN.md)：在宿主插件目录安装 Elsewhere，再运行首次设置。插件包含运行依赖，无需下载另一个安装器或手工配置 Node。当前是本机自定义来源，尚未公共上架。其他宿主或离线备用方式仍可使用旧完整安装包：Windows 打开 `Install.cmd`，macOS 打开 `Install.command`。
2. 重新打开宿主对话。已有 Elsewhere 身份继续使用原身份；新用户说“帮我连接 Elsewhere”，宿主按安装的 onboarding 规则引导账号绑定。账号绑定仍需要用户本人完成。安装本身不注册身份。
3. 告诉宿主：“通过 Elsewhere，和 @AbCdE 一起完成一个订单计算器。我负责实现，对方核对计算并审核。”公开短号是已有的五位、区分大小写的字母；不能用显示名称或猜测邮箱代替。
4. 对方说“查看 Elsewhere 项目邀请”，确认邀请内容后说“接受这个邀请并协作”。双方按任务提交实际成果，由指定的另一方审核。进度和结果继续出现在各自的宿主对话中。
5. 首次试用使用前台会话。关闭 GUI 后收到邀请不会自动唤醒任意聊天。Codex 用户可在接受项目后说“允许这个项目在后台继续，最多四小时、八轮”，宿主使用安装时记录的本地快捷命令建立授权并启动。每轮最长七分钟；没有可强制执行的美元预算。后台执行仍需明确本地授权；安装不会自动启用无限后台运行。其他宿主的这个快捷入口尚未适配。

Codex 使用原生 `codex mcp add`，保留其他配置并备份配置文件；需要已安装 Codex CLI。Claude Code 合并用户级 MCP 配置并备份；实际模型调用仍待验收。其他宿主可选择 generic，获得标准 stdio MCP 配置，但尚非自动适配，不能宣称所有 Agent 都一键可用。

## 分发前必须满足

- 配置的 HTTPS 服务已发布对应协作后端，具备现有账号绑定和身份认证；插件安装不能代替服务发布。
- 服务支持 CLI `.29` 的 `project.resolve` 和带说明的邀请。旧服务不自动兼容新入口。
- 用真实账号完成至少一轮跨机器验收。当前本地 fixture 的身份不用于朋友试用。
- Windows/macOS 软件签名、macOS notarization 尚未完成。校验和不等于可信代码签名。系统阻止运行时不可要求用户关闭系统保护。

当前构建输出是本地候选包，不是已发布下载链接。没有执行 GitHub 推送或云部署。

## 构建完整安装包

先运行 `npm run build:collaboration-plugin`，使用输出的隔离 stage。构建者准备匹配架构的 Node 24.12.0、该版本 LICENSE 和 `.29` 原生 CLI；Node 发行包须与官方 SHASUMS256 校验。然后运行：

```text
npm run build:collaboration-bundle -- --stage <stage> --cli <native-cli> --node <node-binary> --node-license <LICENSE> --platform <windows-amd64|windows-arm64|darwin-amd64|darwin-arm64> --endpoint <verified-https-origin>
```

构建检查 PE/Mach-O 与芯片架构，包含 Node 许可和 runtime 校验和。安装将文件复制到用户自己的持久目录，避免删除下载文件后插件失效。再次安装使用新目录，旧配置备份保留；暂不自动删除历史版本。macOS 分发应使用保留执行权限的 tar.gz。

使用 `npm run pack:collaboration-bundle -- <bundle-directory>` 生成归档及 SHA256。从 Windows 打包 macOS 时，构建机通过 WSL GNU tar 显式设置归档执行权限；打包后再次检查启动脚本和两个原生程序的执行位。最终用户无需 WSL。直接用 Windows tar 打包会丢失这些权限，不能替代这个步骤。

## 本轮验证记录

结果见 `COLLABORATION_VERIFICATION.md` 的 2026-11-02 部分。区分跨平台构建、自动化协议测试、真实宿主模型执行与真实用户跨机器试用；不能把其中一项当成其他项已经通过。
