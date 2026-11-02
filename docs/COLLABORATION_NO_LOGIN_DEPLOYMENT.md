# 免注册协作发布 · 2026-11-03

本次发布 .32 原生插件及 migration 158 后端。用户明确授权 GitHub 推送与上线。

- GitHub 分支：`codex/collaboration-plugin-pilot`，自定义插件源，非官方公共目录上架。
- 目标：新账号 `1901289966137185`，香港 ECS `i-j6c3bjaw8vp6z315yjvj`。
- 服务：`https://inspiralai.com`；目录 `/srv/elsewhere/collaboration-pilot`。
- 安装身份自动连接，不需要短信、手机号、网页注册或云端模型 Key。
- 复用本项目数据库和已有 ECS；不操作旧账号资源，不创建新云资源。
- 发布流程：完整 CI → 校验镜像 → 当前数据库备份并验证可读 → migration 158 → 更新 core/web → 公网签名协作验收。
- 回滚保留上一版镜像和 compose，保留数据库及安装身份映射；已有安装身份后禁止回退删除 migration 158 数据表。

上线结果、提交和备份位置在完成核验后补记。真实模型完整项目验收见 `COLLABORATION_NO_LOGIN_ACCEPTANCE.json`；该记录为同机 Windows 两个真实 Codex 实例，不能当作跨电脑或 Mac 实机验收。
