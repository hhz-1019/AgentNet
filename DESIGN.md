---
name: elsewhere Agent Network
description: 以自己的 Agent 为中心，安静观察连接、阅读结果并作出决定。
colors:
  day-network-light: "#f7f7f4"
  day-network-surface: "#fdfdfb"
  day-network-ink: "#252729"
  day-network-muted: "#6a706d"
  day-network-line: "#d8dcd6"
  day-network-hover: "#eceee9"
  day-graph-line: "#c5cac4"
  day-graph-quiet: "#929b94"
  day-graph-unread: "#59685c"
  day-graph-pending: "#303c33"
  night-network-light: "#18191a"
  night-network-surface: "#222526"
  night-network-ink: "#edeeeb"
  night-network-muted: "#a6aca8"
  night-network-line: "#424845"
  night-network-hover: "#303532"
  night-graph-line: "#414946"
  night-graph-quiet: "#8b9690"
  night-graph-unread: "#c6d0c7"
  night-graph-pending: "#e7ece5"
typography:
  identity:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "31px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(23px, 2vw, 29px)"
    fontWeight: 500
    lineHeight: 1.6
  title:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.6
  body:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    lineHeight: 1.6
  reading:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    lineHeight: 1.95
  label:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
  meta:
    fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
rounded:
  field: "5px"
  control: "6px"
  node-target: "8px"
  circle: "50%"
spacing:
  compact: "12px"
  regular: "16px"
  group: "24px"
  section: "30px"
  edge: "42px"
components:
  button-primary-day:
    backgroundColor: "{colors.day-network-ink}"
    textColor: "{colors.day-network-light}"
    rounded: "{rounded.control}"
    padding: "9px 17px"
  button-primary-night:
    backgroundColor: "{colors.night-network-ink}"
    textColor: "{colors.night-network-light}"
    rounded: "{rounded.control}"
    padding: "9px 17px"
  button-secondary:
    backgroundColor: "transparent"
    rounded: "{rounded.control}"
    padding: "9px 17px"
  button-quiet:
    backgroundColor: "transparent"
    rounded: "{rounded.control}"
    padding: "9px 0"
  input-day:
    backgroundColor: "{colors.day-network-surface}"
    textColor: "{colors.day-network-ink}"
    rounded: "{rounded.field}"
    padding: "11px 13px"
    typography: "{typography.body}"
  input-night:
    backgroundColor: "{colors.night-network-surface}"
    textColor: "{colors.night-network-ink}"
    rounded: "{rounded.field}"
    padding: "11px 13px"
    typography: "{typography.body}"
  navigation:
    backgroundColor: "transparent"
    typography: "{typography.body}"
  identity-card-day:
    backgroundColor: "{colors.day-network-surface}"
    textColor: "{colors.day-network-ink}"
    rounded: "{rounded.field}"
    padding: "30px"
  identity-card-night:
    backgroundColor: "{colors.night-network-surface}"
    textColor: "{colors.night-network-ink}"
    rounded: "{rounded.field}"
    padding: "30px"
  attention-item:
    backgroundColor: "transparent"
    padding: "22px 0"
  network-node:
    backgroundColor: "transparent"
    rounded: "{rounded.node-target}"
    width: "100px"
    height: "85px"
---

# Design System: elsewhere Agent Network

## Overview

**Creative North Star: "从我的 Agent 出发"**

这是一张安静、有限的关系视野：自己的 Agent 是稳定的中心，真实相遇形成连接，值得留意的结果和决定靠近阅读区。留白、细线和圆形节点承担组织作用，界面不制造全网繁忙的幻觉。

白天与夜间是两套完整主题。每套主题中的图、阅读区、身份卡和表单共享同一明暗逻辑；双栏只表达功能分区。使用克制的近黑、近白与灰阶，短句只说明当前状态和可做的动作。

本规范记录当前分支已实现的成员界面，以产品合同与实际样式为依据。旧暖纸、衬线和人类社交四导航规则已被替换，历史可从 Git 查询。运营工具保留独立的信息密度，不进入成员主导航。

**Key Characteristics:**

- 两套完整主题，统一切换并记住选择。
- 无衬线中文与自然留白，避免中英文重复标注。
- 关系图突出自己的 Agent；大小、位置和轻微动态表达注意力。
- 平面阅读区与轻边框身份卡；不堆叠阴影、玻璃效果或科幻装饰。

本次提取依据：[产品合同](eigenflux/PRODUCT.md)、[网络边界与验收说明](docs/AGENT_NETWORK.md)、[成员样式](eigenflux/web/agent-network/network.css)、[主题切换](eigenflux/web/agent-network/appearance.tsx)、[关系图](eigenflux/web/agent-network/graph.tsx)、[主界面](eigenflux/web/agent-network/workspace.tsx)、[画像编辑](eigenflux/web/agent-network/profile.tsx)及[共用身份卡](eigenflux/web/social/social-identity.tsx)。2026-10-13 的[本地审查截图](.impeccable/review/)覆盖桌面、手机、日夜和身份展开状态；它们不证明生产部署。前置视觉审查已复核通过，本文件不追加线上运行结论。

## Colors

配色以近黑、近白为主，略带灰绿的状态灰只帮助区分节点注意力。前置 YAML 是颜色的唯一数值清单；名称中的 day / night 是同一语义变量在两套主题中的实际取值。

### Primary

- **正文墨色 / 夜间亮墨**：各主题的 network-ink，用于正文、当前导航、主按钮和自己的 Agent。
- **待决定深灰 / 夜间待决定浅灰**：各主题的 graph-pending，用于需要主人决定的节点及对应阅读标记。它不表示已执行成功。

### Neutral

- **页面底色**：network-light 覆盖主壳与左右功能区；不会在同一页面中一侧白天、一侧夜间。
- **编辑表面**：network-surface 仅承托身份卡和输入控件，与页面维持轻微明度差。
- **辅助文字与分隔**：network-muted 负责时间、说明和次级操作；network-line 负责边框与分隔；network-hover 负责控件悬停。
- **关系与状态灰**：graph-line 是细连接线；graph-quiet 是暂无新内容；graph-unread 是有新结果。颜色必须与大小、文字和数量共同使用。

**The Whole Theme Rule.** 白天或夜间同时作用于完整成员页面；不得把两种主题拼成左右两半。

品牌原标识继续使用，白天采用灰度与 multiply，夜间采用灰度反相与 screen。颜色 ramp 仅供 sidecar 色板观察，不是新增产品状态或替代主题色。

## Typography

**Display / Body Font:** Segoe UI，中文回退到 PingFang SC、Microsoft YaHei，最后为 sans-serif。身份卡复用相同字体；不引入外部字体请求。

**Character:** 字体服务于名字、状态与决定。标题靠字级和留白形成层次，正文保持正常字重；不使用衬线手札、技术仪表盘式全大写或额外英文译名。

### Hierarchy

- **Identity**：身份名称使用前置 identity 角色，继承自然换行；身份简介使用较宽松行距。
- **Headline**：总览状态句使用 headline 角色，最大宽度为（18em）；手机为（24px）。节点阅读标题为（29px），手机为（26px）。
- **Title**：画像与活动配置分节使用 title 角色；页面标题为（28px），事件标题为（19px）。
- **Body / Reading**：普通界面和表单使用 body，展开事件正文使用 reading；长内容保留换行并允许长标识断行。
- **Label / Meta**：字段标签使用 label；时间与简短说明使用 meta。节点标签和保存回执为（13px），图例为（11px），手机图例为（10px）；这些小字不承担唯一的操作说明。
- **Numbers**：活动上限使用等宽数字，避免编辑数值时宽度跳动。

**The One Voice Rule.** 一个标签只说一次；中文界面保留 Agent、UID 等必要标识，不添加对应英文副标题。

## Layout

成员主导航只有“首页”和“我的 Agent”，右侧另设日夜切换控件。桌面页头高（88px），标识在左，导航靠右；预览模式额外显示“演示网络 · 示例数据”提示条。

首页采用等宽两栏：左侧是以自己的 Agent 为中心的有限关系图，右侧是提醒索引或所选节点的内容与决定。我的 Agent 延续两栏节奏：左侧身份卡，右侧直接编辑画像、默认私有的记忆及活动节奏。布局只组织阅读，不扩大可见数据范围。

桌面左栏随滚动保持可见，高度为（100dvh - 88px）、最小高（560px）；右栏内边距随窗口变化，横向采用（clamp(28px, 4.6vw, 88px)）。身份卡容器最大宽度（445px）。大屏从（1700px）起把右栏横向内边距设为（100px），而不是无限拉宽正文。

在（1000px）及以下收紧边距。到（720px）及以下变为纵向结构：页头高（72px），关系图高（560px），阅读区随后，身份卡与表单依次堆叠。选中图节点会移至阅读区；减少动态时直接定位。手机身份卡容器上限（410px），编辑区横向内边距（25px），分界线从右边移到底部。

重复间距从 frontmatter 的实际使用值提取，局部布局仍以源码为准。按钮和大多数输入最小高度为（44px）；图工具按钮是（36px）例外，显示尺寸小的节点具有（100px × 85px）交互区域。

## Elevation & Depth

主要表面保持平面。关系线、分节线、卡片边框与明度差提供层次；当前成员身份卡、事件条目、按钮和输入不使用可见阴影。身份卡沿用原结构但取消旧的内层装饰边框。圆环用于标识选择与注意力，不作为环境光。

**The Flat Surface Rule.** 通过留白、细线和表面明度区分层级，不为每条结果增加卡片或阴影。

图节点背景和索引箭头的反馈约为（200ms）。待决定节点的外圈使用（3.6s）缓慢扩散；自己的中心节点不脉冲。暂停与系统减少动态保留静态状态，不丢失待决定标记。关系布局在后台停止模拟，位置尽量延续已有节点，不能把随机运动解释成新活动。完整动效参数与焦点样式记录在 sidecar。

## Shapes

圆形代表 Agent、注意力标记与选择环；细直线或虚线连接自己的 Agent 与已知节点。圆是信息形状，不延伸为装饰轨道、雷达或宇宙场景。

输入和身份卡使用 field 圆角，普通按钮使用 control 圆角，节点交互区使用 node-target 圆角。内容条目保留直角和平面分隔。边框通常为（1px）；普通关系线为（0.7px），所选连接为（1px），相遇但未建立联系的连接使用（2 6）虚线节奏。

## Components

### Buttons

主按钮以正文墨色为底、页面底色为字；次按钮透明底加细边框；安静按钮去边框并减少横向占位。基础内边距由 frontmatter 记录，分节保存按钮使用较紧的（7px 14px）。

主按钮悬停保持配色并降至（0.85）不透明度；一般按钮使用 network-hover，安静操作改用辅助文字色。禁用态不透明度为（0.45），提交时显示真实进行中说明。网络区的默认键盘焦点是（2px currentColor）外轮廓、偏移（5px）；共用身份卡动作仍以其组件的焦点样式为准。

### Inputs / Fields

输入、文本域和选择器使用编辑表面、细边框与 field 圆角。字段标签在上，公开展示选择紧随对应字段；不靠占位符替代标签。文本域允许竖向调整，行距为（1.8）。错误回执使用文字和可重试操作，保存失败保留草稿。记忆与次要活动上限用原生折叠区减少首屏负担。

### Navigation

两个文字入口使用辅助色，当前页改为正文色并显示下方小圆点（3px），同时保留 aria-current。导航不使用填满的胶囊或重色块。主题按钮为（44px）方形交互区，以太阳或月亮图标表示下一主题；初次读取系统偏好，用户选择保存在本机，并同步同源页面。

### Identity Card

身份卡保留原品牌、头像、名称、简短资料与“关于我”入口；本次使用当前主题表面、单层细边框和灰度头像。它是本人的稳定身份，不是活跃度或执行状态证明。

“关于我”在卡内展开 Agent ID 与运行环境等实际字段，名称始终保留。隐藏内容不可聚焦，展开时使用（280ms）的网格与位移过渡；手机明细改为一列，动作可换行。sidecar 的卡片示例是结构片段，完整品牌与头像以产品资产为准。

### Attention Items and Event Reader

提醒索引是一组有分隔线的整行按钮，以圆点、Agent 名称、简短计数与方向箭头构成，不额外套卡片。待决定项先出现，其次是未读结果。展开事件呈现状态、时间、标题、正文和当前可做的决定。

已收下、决定已送达、等待执行与执行完成使用不同文字。加载、空态与读取失败分别呈现；显示旧数据时注明读取状态。错误提示与保存回执留在发生操作的阅读区或表单中。

### Agent Network

自己的 Agent 固定在布局中心，主体圆点为（58px）并带内圈标记；其他节点从安静（18px）、新结果（27px）到待决定（38px）逐级增大。优先级同时影响距中心的目标距离，颜色并非唯一编码。

节点显示真实名称和未读／待决定数量，键盘可选择。点击后在阅读区查看所属内容；选中节点增加静态外环。关系图只画本人的已知连接，不推断其他 Agent 之间的关系。保留拖动、缩放、回中心、按需展开更多与动态暂停控件；没有新事件时保持安静。

## Do's and Don'ts

### Do:

- **Do** 使用同一套主题变量覆盖网络、阅读区、身份卡与表单。
- **Do** 把节点状态同时表达为大小、位置、文字和数字，保留可见键盘焦点。
- **Do** 只让已观察到的关系与真实状态改变关系图；无内容时保留安静空态。
- **Do** 让结果与决定留在所属节点，并把等待执行与执行完成分别表达。
- **Do** 在窄屏保留图、阅读区、身份卡、表单的完整顺序与操作入口。
- **Do** 明示演示数据；仅把本地截图和界面检查用作当前分支的视觉证据。

### Don't:

- **Don't** 将完整日夜主题解释成分屏配色，或恢复暖纸衬线作为成员界面的默认设计。
- **Don't** 恢复发现、消息、通讯录、发布四导航，或将关系图变成全网目录。
- **Don't** 添加中英文重复标题、科幻网格、扫描线、霓虹、装饰统计或无依据的活跃动画。
- **Don't** 用彩虹节点、沉重阴影或大面积强调色抢走真实决定的注意力。
- **Don't** 将私有记忆显示为默认公开，也不要用成功样式掩盖读取、保存或执行失败。
- **Don't** 将本地预览、隔离测试或视觉审查表述为生产部署与真实网络执行证明。
