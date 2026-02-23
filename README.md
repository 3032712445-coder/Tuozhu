# 3D 浮雕定制（本地预览版）

一个基于 Vite + React + Three.js（@react-three/fiber）的实验项目，用于在本地预览 3D 浮雕手机壳的交互效果。

## 本地运行

- 进入项目目录
  - Windows PowerShell：
    ```bash
    cd "c:\Users\king3\Desktop\拓竹"
    ```
  - 如果你的项目路径不同，请改为你的实际路径。
- 安装依赖
  ```bash
  npm install
  ```
- 启动开发服务器
  ```bash
  npm run dev
  ```
  - 默认本地地址通常为：http://localhost:5173
  - 终端关闭或按 Ctrl + C 将停止服务。

## 网站使用说明

1. 手机型号选择、图片上传、AI 图片生成、模型导出等功能暂未实现。
2. 点击“生成浮雕”后，会从 public 文件夹中读取 test-depth.jpg 作为深度图，生成浮雕并显示在右侧预览区；手机壳目前用黑色长方体代替。
3. 左侧面板可调整浮雕的高度、大小、旋转角度。右侧视图用鼠标拖动可改变观察角度；点击右上角“调整位置”会强制进入俯视状态，此时拖动鼠标可以移动浮雕。浮雕可移动到手机壳外，外部部分在调整状态下显示为红色；在非调整状态下越界部分不可见。点击“完成调整”返回。

## 项目文件说明

- 根目录
  - index.html：Vite 入口 HTML。
  - package.json：依赖与脚本（dev/build/preview）。
  - vite.config.js：Vite 配置。
  - tailwind.config.js：Tailwind CSS 配置。
  - postcss.config.js：PostCSS 配置。
  - README.md：项目说明（当前文件）。
  - 新建 XLSX 工作表.xlsx：临时文件，与项目无关。
- public
  - test-depth.jpg：用于生成浮雕的深度贴图（灰度图）。
  - .gitkeep：保持目录存在的占位文件。
- src
  - main.jsx：React 应用入口。
  - App.jsx：页面主框架与状态管理，组合左侧参数区与右侧 3D 预览。
  - index.css：全局样式与 Tailwind 引入。
  - components/
    - Scene3D.jsx：3D 场景核心，包含手机壳占位体、浮雕网格、相机与光照、交互逻辑（拖拽、越界提示）。
    - preview-panel.jsx：右侧预览区容器，承载 Scene3D 并接收上层状态。
    - emboss-parameters.jsx：左侧浮雕参数面板（高度、大小、旋转、生成按钮等）。
    - image-input-area.jsx：图片上传与 AI 相关入口（当前未实现逻辑，占位）。
    - phone-model-selector.jsx：手机型号选择入口（当前未实现逻辑，占位）。
    - ErrorBoundary.jsx：运行期错误边界，保护 3D 视图不崩溃。
    - ui/button.jsx：通用按钮组件。

## 常用脚本

- `npm install`：安装依赖。
- `npm run dev`：启动开发服务器进行本地预览。
- `npm run build`：打包生成静态文件（dist）。
- `npm run preview`：本地预览打包产物。
