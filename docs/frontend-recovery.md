# 前端状态与恢复

## 约定

- 后台读取临时失败：保留同一个页面、上次内容、输入和滚动位置；自动重试（5 秒起，最多 30 秒间隔），恢复联网时立即尝试。不把失败伪装成空列表，不在已有内容上堆报错。
- 首次读取失败：保留导航，在对应区域显示简短状态及重试入口。首次整站连接使用品牌等待页，等待较久后提供重新连接和发现入口。
- 发送、发布、保存：保留输入，明确未完成或结果尚未确认。绝不自动重放写请求，既有幂等键仍负责显式重试。
- 认证、权限、冲突、表单校验：不能当断网吞掉。提供登录、修改或核对动作；401/403 不继续使用失去访问权限的读取结果。
- 真正为空：成功读取后才显示空态；不与读取失败同时出现。
- 局部渲染异常：ContentBoundary 保留周围导航。只有顶层无法渲染时才使用 RecoveryPage。
- ErrorBox / feedbackMessage 统一处理可见错误：保留简短的可操作说明，过滤堆栈、SQL、内部地址、错误码与服务响应正文。诊断留在开发者日志，不向用户展示。
- 不增加解释实现原理的副标题、重复说明、诊断面板。加载、空态、失败具有不同状态表达；键盘可访问，尊重减少动态效果设置。

## 组件与验证

- `recovery.tsx` / `recovery.css`：ContentState、ContentBoundary、RecoveryPage。
- `api.ts`：只读重试、同路径内容保留、恢复后内容无变化时保持对象引用，避免表单被无意义更新。
- `/preview/recovery`：开发环境状态预览。模拟断连使用实际 useData 逻辑和只读 fixture；不访问生产数据、不发送消息。
- 覆盖：断连/恢复时消息与输入保留，首次失败，局部异常隔离与恢复，错误文案清理，权限与输入错误不过滤，移动端与减少动态效果。
- 网络完全断开后首次打开网页、浏览器自带错误页、云平台返回且应用尚未启动的错误页不受 React 控制；本实现不声称离线缓存整个网站。

## 参考

- Atlassian 消息设计：https://atlassian.design/foundations/content/designing-messages
- Atlassian 空态文案：https://atlassian.design/content/designing-messages/empty-state/
- Carbon 空态：https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states
- Carbon 通知：https://www.carbondesignsystem.com/building-blocks/core/components/notification/guidelines
- GOV.UK 服务异常：https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/

采用局部反馈、保留上下文、简短可执行说明的原则；视觉继续使用 elsewhere 自己的字体、留白和材质。
