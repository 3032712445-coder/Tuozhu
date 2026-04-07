# 3D 浮雕定制（本地预览版）

一个基于 Vite + React + Three.js（@react-three/fiber）的实验项目，用于在本地预览 3D 浮雕手机壳的交互效果。

## 本地运行
- 请保证设备下载了[Node.js](https://nodejs.org/zh-tw/download/current)与[git](https://git-scm.com/install/)
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

1. 操作流程：选择手机型号-》上传图片或AI生成或选择历史记录-》生成浮雕-》调整参数，位置，或者擦除-》导出stl文件
2. 注意事项
   - 手机型号选择目前仅支持 iPhone 16，iPhone16pro，iPhone16promax后续会添加其他型号。
3. 在生成左侧面板可调整浮雕的高度、大小、旋转角度。右侧视图用鼠标拖动可改变观察角度，可以滑动鼠标缩放；点击右上角“调整位置”会强制进入俯视状态，此时拖动鼠标可以移动浮雕。浮雕可移动到手机壳外，外部部分在调整状态下显示为红色；在非调整状态下越界部分不可见。在调整状态下可以选择擦除进入擦除模式，擦除大小可在右上角通过滑条调整，上方有向左，向右的箭头，分别是撤销，恢复擦除。点击“完成调整”返回。
4. 本地在生成深度图时会把图片先放入backend/depth_service/uploads文件夹，然后再生成深度图，生成的深度图可以在backend/depth_service/outputs文件夹中找到。历史记录功能会读取uploads最新的五张图片，并在选择后调用outputs里对应的深度图生成浮雕。

## 项目文件说明

- 根目录
  - index.html：Vite 入口 HTML。
  - package.json：依赖与脚本（dev/build/preview）。
  - vite.config.js：Vite 配置。
  - tailwind.config.js：Tailwind CSS 配置。
  - postcss.config.js：PostCSS 配置。
  - README.md：项目说明（当前文件）。
  - Project_Description.md：项目描述文档。
  - main.py：后端服务主入口文件。
  - install_gpu_deps.py：自动安装GPU依赖的脚本。
  - test_gpu.py：GPU测试脚本。
  - requirements.txt：后端服务依赖文件。
  - .gitignore：Git忽略文件配置。
  - .gitmodules：Git子模块配置。
- public
  - test-depth.jpg：用于生成浮雕的深度贴图（灰度图）。
  - test-depth9.jpg：测试用深度贴图。
  - .gitkeep：保持目录存在的占位文件。
  - phonecase/：手机壳模型和掩码图目录
    - iphone16.stl：iPhone 16手机壳3D模型
    - iphone16.png：iPhone 16手机壳掩码图（用于确定浮雕区域）
    - iphone16pro.stl：iPhone 16 Pro手机壳3D模型
    - iphone16pro.png：iPhone 16 Pro手机壳掩码图
    - iphone16promax.stl：iPhone 16 Pro Max手机壳3D模型
    - iphone16promax.png：iPhone 16 Pro Max手机壳掩码图
- src
  - main.jsx：React 应用入口。
  - App.jsx：页面主框架与状态管理，组合左侧参数区与右侧 3D 预览，处理深度图生成和STL导出逻辑。
  - index.css：全局样式与 Tailwind 引入。
  - components/
    - Scene3D.jsx：3D 场景核心，包含手机壳模型加载、浮雕网格生成、相机与光照设置、交互逻辑（拖拽、越界提示、擦除模式）。
    - preview-panel.jsx：右侧预览区容器，承载 Scene3D 并接收上层状态。
    - emboss-parameters.jsx：左侧浮雕参数面板（高度、大小、旋转、生成按钮等）。
    - image-input-area.jsx：图片上传与 AI 生成功能入口，包含历史记录选择。
    - phone-model-selector.jsx：手机型号选择组件，支持iPhone 16系列型号。
    - ErrorBoundary.jsx：运行期错误边界，保护 3D 视图不崩溃。
    - ui/button.jsx：通用按钮组件。
- backend
  - depth_service/：FastAPI 后端服务
    - api.py：API接口定义，处理深度图生成请求。
    - __init__.py：Python包初始化文件。
    - uploads/：临时上传图片缓存目录。
    - outputs/：生成的深度图保存目录。
    - pixel-perfect-depth/：Pixel-Perfect-Depth 模型源码（需自行下载）
      - checkpoints/：模型权重文件目录（需自行创建并下载权重文件）

## 后端服务说明

 一、后端 FastAPI 服务（Depth 生成）

 1.配置API文件
   新建.env文件，文件内容为ZHIPU_API_KEY="你的智谱API密钥"

 2.安装依赖

  ### 自动安装（推荐）
  运行自动安装脚本，会检测GPU并安装对应的依赖：
  ```bash
  python install_gpu_deps.py
  ```

  ### 手动安装
  ```bash
  cd backend/depth_service
  pip install -r requirements.txt
  如果没有requirements.txt，可以手动安装：
  pip install fastapi uvicorn pillow numpy opencv-python torch torchvision
  ```

 3.下载仓库为https://github.com/gangweix/pixel-perfect-depth ，
  在他们的Readme里找到：![alt text](image.png)
  按Usage-Preparation里的步骤下载好 ppd.pth和depth_anything_v2_vitl.pth模型权重并放到checkpoints文件夹
  形成目录backend/depth_service/pixel-perfect-depth/checkpoints/
 ```bash
  pip install sniffio omegaconf timm python-multipart

     
 3.启动后端服务（同时启动两个服务）
uvicorn main:app --reload
- `npm install`：安装依赖。
- `npm run dev`：启动开发服务器进行本地预览。
- `npm run build`：打包生成静态文件（dist）。
- `npm run preview`：本地预览打包产物。
