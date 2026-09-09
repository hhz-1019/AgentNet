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

导出脚本同时检查地点唯一性、图书馆相对山体的位置、顶点及实例变换的有效性、东区跑道配色、主要屋面朝向及 GLB 文件头。

## 修改模型

- `lib/campus-data.ts`：地点名称、地图坐标、场景说明与镜头范围。
- `lib/campus-model.ts`：建筑、庭院、道路、山体、河流和植被。
- `lib/campus-materials.ts`：浏览器中的砖缝、铺装、屋面及地表材质细节。
- `components/campus-canvas.tsx`：渲染、镜头过渡、地图标签与选择。
- `app/page.tsx` 和 `app/globals.css`：网页界面与响应布局。
- `public/models/nju-suzhou-campus.glb`：可独立使用的三维模型。
- `SOURCES.md`：地图与建筑资料来源、坐标约定与建模精度说明。

模型按公开地图、建筑设计图与建成实景细化，未使用测绘数据。已校正东区蓝色跑道，并细化北大楼、图书馆、南雍楼、文体中心及宿舍的可辨识外观。西区跑道配色、未见立面和精确尺寸仍需实拍或竣工图确认。GLB 保留几何与标准 PBR 基础材质，浏览器的程序材质与后期效果不包含在 GLB 内。学生 Agent 网络尚未接入。
