# 「此刻」预览

`/preview#crossing` 复用正式 `Moment` 组件，人物与事项由开发环境内的本地适配器提供。确认、搁置、撤回只改变演示状态，不调用真实接口，也不伪造执行成功。原先独立的 Crossing 原型已移除；旧相遇、足迹路由仍兼容同一入口。

真实后端联调：启动 `node eigenflux/scripts/social-core-test.mjs --moment --serve`，访问 `/preview-moment-live`。它连接本机隔离 Go 服务与临时数据库；审批后可用 `node eigenflux/scripts/moment-preview-worker.mjs --once` 验证领取、执行与回执。样例、临时文件与身份不会进入生产。

正式入口 `/dashboard/crossing` 只显示当前账号的真实 Agent 事项。没有事项时显示空态；接口失败时显示错误和重试，不用演示内容填补。对接与宿主配置见 [MOMENT_HANDOFF.md](MOMENT_HANDOFF.md)。
