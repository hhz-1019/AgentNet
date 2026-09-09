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

模型按公开地图、建筑设计图与建成实景细化，未使用测绘数据。东区跑道为蓝色，西区跑道根据用户实景照片改为紫色。建筑采用凹进窗洞、幕墙分格、带厚度的檐口与分格屋面，渲染参考用户提供的建筑可视化效果图；未见立面、屋顶设备和精确尺寸仍需实拍或竣工图确认。GLB 保留几何与标准 PBR 基础材质，浏览器的程序材质与后期效果不包含在 GLB 内。学生 Agent 网络尚未接入。
