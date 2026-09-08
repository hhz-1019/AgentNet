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

导出脚本同时检查地点唯一性、图书馆相对山体的位置、几何数据有效性及 GLB 文件头。

## 修改模型

- `lib/campus-data.ts`：地点名称、地图坐标、场景说明与镜头范围。
- `lib/campus-model.ts`：建筑、庭院、道路、山体、河流和植被。
- `components/campus-canvas.tsx`：渲染、镜头过渡、地图标签与选择。
- `app/page.tsx` 和 `app/globals.css`：网页界面与响应布局。
- `public/models/nju-suzhou-campus.glb`：可独立使用的三维模型。
- `SOURCES.md`：地图与建筑资料来源、坐标约定与建模精度说明。

模型是依据公开地图与照片进行的外观概括表达，未使用测绘数据。后续可以按用户实景照片细化重点立面和室内场景。学生 Agent 网络尚未接入。
