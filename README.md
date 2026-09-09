# 南京大学苏州校区 · 三维校园

基于 React、Three.js 与 Sites/Vinext 的交互式校园沙盘。首页为三维校园总览，支持九个地点的场景切换、鼠标/触屏旋转缩放、俯视与返回，桌面目录和手机折叠目录均可操作。

## 本地运行

```sh
npm install
npm run dev
```

默认地址以终端输出为准。当前为 `http://localhost:3000/`。

## 验证与构建

```sh
npx tsc --noEmit
node scripts/export-model.mjs
npm run build
```

导出脚本同时检查地点唯一性、图书馆相对山体的位置、顶点及实例变换的有效性、东西区跑道配色、窗洞的实际凹进深度、主要屋面朝向与厚边及 GLB 文件头。

## 修改模型

- `lib/campus-data.ts`：地点名称、地图坐标、场景说明与镜头范围。
- `lib/campus-model.ts`：建筑、庭院、道路、山体、河流和植被。
- `lib/campus-materials.ts`：浏览器中的砖缝、铺装、屋面及地表材质细节。
- `components/campus-canvas.tsx`：渲染、镜头过渡、地图标签与选择。
- `app/page.tsx` 和 `app/globals.css`：网页界面与响应布局。
- `public/models/nju-suzhou-campus.glb`：可独立使用的三维模型。
- `SOURCES.md`：地图与建筑资料来源、坐标约定与建模精度说明。

模型按公开地图、建筑设计图与建成实景细化，未使用测绘数据。东区跑道为蓝色，西区跑道根据用户实景照片改为紫色。建筑采用凹进窗洞、幕墙分格、带厚度的檐口与分格屋面，渲染参考用户提供的建筑可视化效果图；未见立面、屋顶设备和精确尺寸仍需实拍或竣工图确认。GLB 保留几何与标准 PBR 基础材质，浏览器的程序材质与后期效果不包含在 GLB 内。

## 自己的校园伙伴

网页「我的伙伴」将当前 Sites 登录账号与一个持续存在的角色绑定。私聊、实际行动、带来源的主观记忆保存在 Sites D1。当前原型开放北大楼前、图书馆前和九曲河畔三个室外活动点；其余校园场景仍可浏览。角色自行决定停留或移动，人只能交流和管理连接。地图目前只显示自己的角色，多人相遇、公共交谈、关系和约定尚未实现。

本机运行器通过已登录 ChatGPT 的 Codex CLI 调用结构化角色决策。专用会话没有终端、文件、插件和网络工具；不导入其他 Codex 对话。世界服务验证行动与租约后才写入实际事件。每小时最多思考 12 次，每次启动最多运行 4 小时或调用 48 次。运行器在线时关闭网页仍可继续；电脑离线后完成既有行程，新的判断等待恢复。

本机配置放在 Git 忽略的 `.campus-local/connection.json`，包含 `site`、`codexPath`、`nodePath`、`model` 和本地连接凭据。首次配对运行 `node scripts/campus-driver.mjs --pair`，通过本人已登录的网页兑换临时连接码。ChatGPT 登录凭据仍由 Codex 自己管理，不放入配置或上传到校园。已完成配对后，在 PowerShell 运行：

```powershell
./scripts/start-campus.ps1
```

网页可暂停自主思考或撤销连接。撤销后重新接入需要重新配对。启动脚本不会设置开机自启或无限常驻任务。

持久化结构见 `db/schema.ts` 和 `drizzle/`。本地数据库需要按 Sites 工作流应用迁移。验证使用 Node 24：`node scripts/check-world.mjs` 检查实际 SQL 的账户隔离、并发、行程、私聊重试、记忆来源、撤销和预算；启动本地开发服务并迁移后，`node scripts/check-world-http.mjs` 检查本地 Worker/D1 接口。HTTP 验证脚本只访问 localhost，不向线上写入测试角色。
