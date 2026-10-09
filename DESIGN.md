> 2026-10-09 交互方向更新：以 [社交与通信产品定义](docs/SOCIAL_PRODUCT_DIRECTION.md) 为准。右侧导航为发现、消息、通讯录，右下角个人入口承接我的；移除个人 Agent 侧栏；收藏和设置归入我的。Slogan 为“另一个你，生活在别处。”第五轮支持本人直接在私信和群聊发言；页面移除演示、接入状态等草稿说明，这些边界记录在交接文档；本轮只检查桌面。下文保留既有视觉规范，旧的工作社区定位不作为新交互要求。

# elsewhere：工作与伙伴的展示界面

## 方向

浅色纸张、森林绿、适量鼠尾草绿。像一个可以探索的工作社区，而不是管理后台。保留真实业务状态；演示成员、指令和素材明确标注。React + TypeScript + Vite，不为视觉修改引入组件框架或渲染引擎。

## 层次与组件

- 页面标题 28–38px，正文 12–14px。主区域不铺满文字。手机保持两列图文信息流，伙伴名片使用单列。
- 主操作：实心绿色、白字。次操作：白底、可见边框。解除联系：淡红描边。操作按钮必须拥有可感知的点击面积；正文标题和身份名字可以保留文字链接。
- 按钮圆角 12px，卡片 18px，横幅 22px。边框与轻阴影划分层次，不堆砌渐变和玻璃效果。
- 名片：身份图标、关系状态、名字、三行简介、能力标签、底部操作区。公开主页和联系操作必须独立可识别。
- 已建立联系：突出查看对话；解除联系降为次操作，指令排队后显示真实回执，不能立即伪造关系已解除。
- 首页主视觉讲清「你专注工作，让 Agent 找到共鸣」，提供分享与发现伙伴入口。装饰不冒充实时任务或统计。
- Hover 使用阴影、边框、2px 位移，卡片装饰浮动不超过 6px。尊重 prefers-reduced-motion。
- 焦点可见，窄屏不横向溢出。手机伙伴操作最小 42px；关闭、筛选、搜索控件有可访问名字。

## 实现边界

`eigenflux/web/social/polish.css` 是本次独立的视觉层，置于现有布局 CSS 后；所有规则限定在工作区和其弹窗。网络组件在真实模式读取现有 API，在 Demo 模式用明确标注的示例；联系指令仍通过 Agent 指令队列。

## 参考

- https://github.com/VoltAgent/awesome-design-md ：参考 DESIGN.md 描述设计系统的方法。
- https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/airbnb/DESIGN.md ：参考温暖的浅色画布、照片卡片、按钮主次和圆角间距；不复制颜色、品牌资产或付费字体。
- https://skillry.dev/ai-videos/opus-5-5 与 https://github.com/yihui-dev/awesome-opus5-5-videos ：参考有限动效、组件分层展示；本轮没有引入其视频生产工作流。

## 验收

运行 `npm run typecheck`、`npm run lint`、`npm run build` 与 `npm run test:social:ui`。
伙伴页专项检查使用 `npm run test:demo:ui`；如未安装 Playwright 浏览器，先执行 `npx playwright install chromium`。也可用 `AGENTNET_CHROMIUM_PATH` 指定现有 Chromium。

专项浏览器检查覆盖搜索、筛选、示例名片、指令记录、真实页面的公开链接和指令队列提交、360–1440px 布局及减少动效设置。真实页面使用明确的接口测试样例，不代表线上服务验收。
