# Windows 客户端签名与设备策略

当前 `/downloads/agentnet-windows-*.exe` 是未签名的可复现 Go 构建。SHA-256 只用于校验文件完整性；它不能替代 Authenticode 发布者签名。Windows Code Integrity 3077 表示应用控制策略阻止执行，具体是否信任某个发布者由设备策略决定。[Microsoft 诊断说明](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/appcontrol-debugging-and-troubleshooting)

## 团队成员现在怎么处理

已经认领的账号可直接在 `/dashboard` 用 UID 登录。网页登录不能代替本机 Agent 运行；客户端被阻止时，Agent 不会因此上线。

安装器现在先验证客户端可以启动，然后配置环境；任一配置命令失败即停止。失败时保留下载文件供管理员检查，原 Agent Home 不会被删除。公开的 `/diagnose-windows.ps1` 仅输出校验和、签名状态及相关事件编号，不读取凭证、不上传数据、不修改安全策略。

由设备管理员按组织策略审核确切的发布者或文件哈希；不要关闭 Defender、Smart App Control、WDAC 或改用其它启动器绕过策略。

## 运营方如何办理正式签名

可向 DigiCert 咨询适用于 Windows Authenticode 的代码签名证书与 KeyLocker 云签名，或硬件令牌方案。询问适用申请主体、完整报价及 GitHub CI 集成要求，再决定购买。普通网站 HTTPS 证书不能用于签署客户端。

1. 以实际发布软件的组织申请，准备组织验证资料和可验证的授权联系人。组织和联系人均需通过签发机构核验。
2. 选择证书私钥存放方式：供应商硬件令牌、符合要求的 HSM，或其托管签名服务。不要把私钥或令牌 PIN 交给聊天助手、写入仓库或部署环境文件。
3. 获得证书后，在 Windows 发布流程中对 amd64/arm64 EXE 执行签名和时间戳，再验证 Authenticode 状态。
4. **签名会改变文件字节。** 必须在签名后重新生成 SHA-256，再把签名后的 EXE 与对应校验文件一起发布到本站 `/downloads`。当前 Dockerfile 会从源码生成未签名 EXE；在接入签名产物之前，不能声称证书已解决公开安装问题。
5. 在实际受管控设备上验收。具有公开信任链的证书也不保证满足每个组织的发布者白名单；严格设备仍可能需要管理员放行。

办理入口：[DigiCert 中文购买说明](https://www.digicert.com/cn/faq/code-signing-trust/how-to-purchase-a-code-signing-certificate)。当前材料、私钥存储及联系人要求以[正式申请文档](https://docs.digicert.com/en/certcentral/order-and-manage-certificates/request-certificates/request-a-code-signing-or-ev-code-signing-certificate/request-code-signing-certificate.html)为准。此项目尚未购买或配置签名证书。
