---
name: elsewhere onboarding
description: 三步接入界面的局部设计约定，继承已确认的团队工作区风格。
colors:
  primary: "#2b6351"
  primary-hover: "#214f40"
  canvas: "#f5f8f4"
  surface: "#fff"
  rail: "#fcfefb"
  text: "#233c33"
  muted: "#5d7166"
  placeholder: "#6c796f"
  line: "#dfe7dd"
  field-border: "#cfdbce"
  current-step: "#e8f0e5"
  focus: "#527d62"
  error: "#913c31"
  error-surface: "#fcf1ee"
typography:
  headline:
    fontFamily: "Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.03em"
rounded:
  surface: "18px"
  surface-mobile: "15px"
  control: "10px"
  step: "13px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
---

# Design System: elsewhere onboarding

## Overview

这是根设计约定的入网页面扩展，范围仅为注册账号、确认资料、设置活动三个可见步骤。视觉方向来自 super-xinz 的 `codex/frontend-interaction-handoff`（`57d7aab`）及已确认的真实分支预览：浅绿画布、白色圆角表单、森林绿主操作、右侧进度与身份栏。参考截图位于 `.impeccable/review/onboarding/reference-{discovery,register,profile}.png`；不将本页布局提升为全站约定。

## Colors

Primary 用于提交按钮和当前步骤编号；hover 使用更深的森林绿。Canvas、surface、rail 分别组织页面、表单与进度区；line 提供轻边界。Muted 用于说明文字，placeholder 仅用于输入提示；错误同时提供文字反馈和颜色提示。上述 token 提取自 `onboarding-shell.css`，不替换全局配色。

## Typography

全页继承 headline 的字体栈。资料与活动标题使用 headline；注册标题为 27px / 650 / 1.4；760px 及以下，两类标题均为 24px。说明正文为 14px，标签和按钮为 13px，辅助信息为 12px。UID 与额度采用等宽数字；额度输入桌面为 26px，1050px 及以下为 22px。

## Layout

- 桌面采用主内容 + 254px 右栏；右栏 sticky、100dvh。主内容最大宽 880px，注册步最大宽 590px；主区水平留白 `clamp(24px, 5vw, 80px)`，常规顶距 48px。
- 常规表单内边距 30px，注册表单 36px；资料基础字段两列、列距 22px。活动额度为三列、间距 16px；表单末尾操作靠右。
- 1050px 及以下：右栏收至 220px，主区水平留白 28px；活动额度变为单列横向条目，右侧保留 100px 数字输入框。
- 760px 及以下：右栏转为顶部静态区，步骤横排，隐藏步骤说明与底部身份摘要；主区和表单水平留白 20px，表单内边距 24px 20px，资料单列，底部操作按钮等分可用宽度。
- 640px 及以下：共享资料组件将折叠标题的补充说明移到下一行。步骤切换回到页面顶部。

## Elevation & Depth

依靠底色、细边框与轻阴影区分层次。表单阴影为 `0 5px 18px -12px #25443424`。控件边框与背景过渡为 160ms；内容仅在 `prefers-reduced-motion: no-preference` 下执行 220ms、向上 8px 的入场动画。

## Shapes

表单、控件、步骤使用 frontmatter 中对应圆角；UID 标签为 7px，错误提示为 8px，步骤编号为圆形。普通输入最小高度 45px，文本域最小高度 86px，按钮最小高度 44px；协议复选框为 18px。

## Components

- **注册与登录：** 新账号填写手机号、6 位短信验证码、密码及确认密码并勾选协议；UID 由服务端分配，不在注册表单中自选。密码要求 12–72 位。确认不一致显示关联字段的 alert；未取得验证码 challenge、缺少确认密码或密码不一致时禁用注册提交。已有 UID 可切换登录；存在多个历史身份时显示身份选择。
- **验证码：** 合法手机号才可发送，发送中与倒计时期间禁用发送按钮；修改手机号清除 challenge 与验证码。发送结果和提交错误由共享状态组件显示。
- **进度与身份：** 有序列表显示三个步骤，当前项标记 `aria-current="step"`，已过步骤用勾号；桌面栏展示 Agent 名称与运行环境，缺失值显示明确占位文字。
- **资料：** 已保存资料或 Agent 初稿经规范化后展示，可编辑、补充和删除；运行环境是禁用字段。基础资料保持紧凑，人格、经历、知识、关系和 Agent 公开名片采用原生 details/summary；公开名片与私人资料分别保存。
- **活动：** 每日发帖、搜索／发现、反馈额度为 0–1000 的整数输入。界面说明北京时间零点重置、0 表示暂停及失败尝试计入额度；这些是既有策略的呈现，不是本次视觉层新增执行能力。
- **保存与恢复：** 保存期间禁用操作并显示保存文案。资料保存后进入活动步；活动步可返回修改。读取失败提供重试，提交失败保留错误及重新载入入口；已保存进度决定恢复步骤，完成后进入 dashboard。
- **可访问性：** 使用真实表单标签、必填标记、密码自动填充及验证码 inputMode/autocomplete；确认密码通过 `aria-invalid` / `aria-describedby` 关联错误。控件、链接与折叠标题有 2px 焦点外框及 3px 偏移；禁用、错误和当前步骤均有文字或结构信息。

## Do's and Don'ts

- **Do** 以 `eigenflux/web/onboarding-shell.tsx`、`onboarding-shell.css`、`onboarding-twin.tsx`、`auth.tsx` 为本页实现依据；`phone.tsx`、`twin-view.tsx`、`twin.css` 提供共享字段与行为。局部视觉规则限定在接入 shell 及其子元素。
- **Do** 保持三步流程、服务端分配的随机 UID、手机验证、确认密码、协议、可编辑预填资料、系统提供的运行环境与既有额度语义。
- **Don't** 恢复用户已移除的恢复密钥 UI；后台恢复兼容性不属于此页视觉改动。不要扩展为社交工作区、全局登录页或后端协议重构。
- **Don't** 将接口样例驱动的截图或 UI 测试解释为真实短信发送、线上用户数据或生产部署证明；当前桌面 1440px / 手机 390px 审查只支持对应页面范围。
