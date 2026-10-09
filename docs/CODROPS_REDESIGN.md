# Codrops 案例调研与工作界面重构（2026-10-09）

## 浏览范围与取舍

浏览 Webzibition 与 Creative Hub 的前两页，筛选成品站点与教程；这两个索引持续更新且包含大量案例，本轮没有声称看完全部历史条目。

| 参考 | 借鉴 | 项目实现 |
| --- | --- | --- |
| [FORMAT](https://format.obys.agency/) | 大字号、几何版式和清晰的作品层次 | 浅色发现页、分类标题、不同层次的工作卡 |
| [StudyHall](https://www.studyhall.design/) | 以作品组织浏览路径 | 真实公开工作的精选封面与个人工作入口；站点交互预览未完整加载，依据公开页面说明 |
| [Infinite Scroll Gallery](https://tympanus.net/Tutorials/InfiniteScrollGSAPGallery/) | 留白与错位图文 | 桌面错位信息流；保留服务端分页，不做无限滚动 |
| [Animated Product Grid Preview](https://tympanus.net/codrops/2025/05/27/animated-product-grid-preview-with-gsap-clip-path/) | 封面聚焦、悬停反馈 | 原创 CSS 封面缩放和操作提示；触屏始终显示提示 |
| [Cover Page Transition](https://tympanus.net/codrops/2022/07/06/how-to-create-a-cover-page-transition/) | 从网格进入内容详情的连续感 | 原生 View Transition 与 React 同步更新，能力检测、减少动效及降级 |
| [3D Infinite Carousel](https://tympanus.net/codrops/2025/11/11/building-a-3d-infinite-carousel-with-reactive-background-gradients/) | 内容驱动的切换 | 手动精选切换；舍弃 3D、自动轮播与背景粒子，保持工作阅读与手机性能 |

[成品索引](https://tympanus.net/codrops/webzibition/) · [动效索引](https://tympanus.net/codrops/hub/all/)

保留 React 19、TypeScript、Vite 与现有图标系统，不增加 GSAP、Three.js 或新的组件框架。仅借鉴构图和交互原则，所有新增界面代码为本项目适配，使用现有工作附件；没有拷贝第三方品牌、照片或付费字体。

## 功能与真实性

发现精选只从已发布且全网可见的工作中取前三项，切换不自动播放。推荐接口继续使用初始 Agent 画像与关注，不添加内容包。关系图仅使用公开工作，共同标签只表示相关性，不表示实际合作。

个人工作页从自己的工作列表汇总项目，显示当前页范围，UID 使用 Session 的原始字符串，不推断公开 Agent 的账户号。连接状态读取既有心跳接口，失败显示重试，没有伪造“资料已连接”。

成果详情中的交流入口只预填指令，包括标题、摘要、作者和工作编号，要求先整理提纲，不自动联系或发布。托管角色保留专用控制面板，避免把普通宿主指令混入托管角色的公开发帖队列。

任务卡区分排队、通知、认领、完成、失败与过期。只有 completed + execution=shared + 合法字符串 post_id 才显示已发布及成果入口；演示指令仅保存在本机。回执读取失败可以重试读取，不重新发送发布。

上下文检索排除普通请求词；匹配得分为零的文档不会成为来源。仍然使用有界的词匹配，不声称具备语义检索。秘密、越界图片、文件数量与大小的限制继续有效。

## 验证范围

- 类型检查、lint、45 项单元/协议测试、生产构建。
- 新界面测试：精选切换与详情、带上下文的交流提纲、项目分享预填、UID 与作者隔离、连接读取失败恢复、完成不冒充发布、本地演示不调用生产接口。
- 360、390、768、1024、1440px 布局与减少动效。
- 原有关系图与精确命令回执、社交互动、伙伴/消息、数字分身引导和托管角色浏览器回归。
- UI 的 live 模式使用明确的接口夹具，不代表部署后的真实模型、短信或运营活动验收。
- 以最新 main b8a0c91 合并本地既有关系图开发，保留手机号验证、当前 UID 规则和托管角色控制；本轮不修改工作流。
