# 3D 浮雕工坊

Vite + React + Tailwind 项目，本地运行说明。

---

## 第一步：进入项目文件夹

在终端（PowerShell 或 CMD）里执行：

```bash
cd "c:\Users\king3\Desktop\拓竹"
```

如果你的「拓竹」文件夹不在桌面，请把上面的路径改成你自己的路径。

---

## 第二步：安装依赖

在项目文件夹下执行：

```bash
npm install
```

等待安装完成（会下载 React、Vite、Tailwind、lucide-react 等）。

---

## 第三步：代码放在哪里

- **主页面代码**（你从 v0 复制的那一整段）已经放在：**`src/App.jsx`**
- 用到的子组件在：
  - `src/components/ui/button.jsx` — 按钮
  - `src/components/phone-model-selector.jsx` — 手机型号选择
  - `src/components/image-input-area.jsx` — 图片上传 / AI 描述
  - `src/components/emboss-parameters.jsx` — 浮雕参数
  - `src/components/preview-panel.jsx` — 右侧预览

如果 v0 还生成了别的组件或样式，可以把对应文件复制到 `src/components/` 下相应位置，再在 `App.jsx` 里按需修改引用。

---

## 第四步：在浏览器里运行

安装好依赖后，在项目文件夹下执行：

```bash
npm run dev
```

终端里会提示本地地址，一般是：

**http://localhost:5173**

用浏览器打开这个地址即可看到「3D 浮雕工坊」界面。

- 关掉终端或按 `Ctrl + C` 会停止开发服务器，网页就打不开了。
- 下次想再看，再在项目文件夹里执行一次 `npm run dev` 即可。

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖（第一次或拉新代码后执行） |
| `npm run dev` | 启动开发服务器，在浏览器里看效果 |
| `npm run build` | 打包成可部署的静态文件（在 `dist` 文件夹） |
| `npm run preview` | 本地预览打包后的效果 |

---

## 项目结构（简要）

```
拓竹/
├── index.html          # 入口 HTML
├── package.json        # 依赖和脚本
├── vite.config.js      # Vite 配置（含 @ 路径别名）
├── tailwind.config.js  # Tailwind 配置
├── postcss.config.js   # PostCSS 配置
└── src/
    ├── main.jsx        # React 入口
    ├── App.jsx         # 主页面（你的 v0 代码在这里）
    ├── index.css       # 全局样式 + Tailwind
    └── components/     # 各个子组件
```

祝你玩得开心～
