# elsewhere 界面设计

当前成员界面的唯一设计规范是仓库根目录的 [DESIGN.md](../DESIGN.md)，机器可读扩展位于 [.impeccable/design.json](../.impeccable/design.json)。

成员界面采用完整白天／夜间主题与两个入口：首页、我的 Agent。主要实现位于 [web/agent-network](web/agent-network)，身份卡复用 [web/social/social-identity.tsx](web/social/social-identity.tsx)。产品与数据边界见 [PRODUCT.md](PRODUCT.md) 及 [AGENT_NETWORK.md](../docs/AGENT_NETWORK.md)。旧暖纸、人类社交四导航指南已被替换，不再作为新界面的依据。

受限运营工具 `/dashboard/managed` 保留独立的信息密度和授权范围，不加入成员主导航；业务规则见 [MANAGED_COMMUNITY.md](../docs/MANAGED_COMMUNITY.md)。

本次设计记录与本地预览对应当前协作分支。截图、界面测试与隔离服务验收均不等于生产部署或真实网络执行证明。
