<div align="center">

<img src="public/icon-512.png" width="128" alt="随记图标">

# 随记

**在 iPhone 和 Mac 之间同步的笔记，你的 Markdown 文件夹两边都能看、能改**

[![English](https://img.shields.io/badge/Language-English-0A84FF?style=for-the-badge)](README.md)
[![简体中文](https://img.shields.io/badge/语言-简体中文-E5484D?style=for-the-badge)](README.zh-CN.md)

[![网址](https://img.shields.io/badge/网址-suiji--notes.vercel.app-000?style=flat-square&logo=vercel)](https://suiji-notes.vercel.app)
![iPhone](https://img.shields.io/badge/iPhone-PWA-555?style=flat-square&logo=apple)
![macOS](https://img.shields.io/badge/macOS-原生%20App-black?style=flat-square&logo=apple)
![Supabase](https://img.shields.io/badge/数据-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)

<img src="docs/style-glass-light.jpg" width="820" alt="文档和它的大纲">

<img src="docs/style-glass-light.jpg" width="200" alt="玻璃 · 浅色">&nbsp;<img src="docs/style-paper-light.jpg" width="200" alt="纸张 · 浅色">&nbsp;<img src="docs/style-terminal-light.jpg" width="200" alt="终端 · 浅色">&nbsp;<img src="docs/style-blocks-light.jpg" width="200" alt="方块 · 浅色">

<img src="docs/style-glass-dark.jpg" width="200" alt="玻璃 · 深色">&nbsp;<img src="docs/style-paper-dark.jpg" width="200" alt="纸张 · 深色">&nbsp;<img src="docs/style-terminal-dark.jpg" width="200" alt="终端 · 深色">&nbsp;<img src="docs/style-blocks-dark.jpg" width="200" alt="方块 · 深色">

<sub>玻璃、纸张、终端、方块，上排浅色，下排深色</sub>

<img src="docs/graph-glass.jpg" width="200" alt="图谱 · 玻璃">&nbsp;<img src="docs/graph-paper.jpg" width="200" alt="图谱 · 纸张">&nbsp;<img src="docs/graph-terminal.jpg" width="200" alt="图谱 · 终端">&nbsp;<img src="docs/graph-blocks.jpg" width="200" alt="图谱 · 方块">

<sub>各风格下的关系图谱</sub>

<img src="docs/phone-list.jpg" width="200" alt="手机上的目录树">&nbsp;&nbsp;<img src="docs/phone-doc.jpg" width="200" alt="手机上的文档">&nbsp;&nbsp;<img src="docs/phone-terminal.jpg" width="200" alt="手机上的终端风格">

</div>

## 功能

- **一棵目录树：**在 App 里写的随手记放在最上面的「随手记」文件夹，同步过来的文件夹排在下面。点 ⇅ 可以按名称或按修改时间排列。
- **哪里都能改：**在手机上改文件，几秒后 Mac 上的同步程序就会写回本地。
- **大纲：**每个文档旁边都有自己的大纲。点击标题就能跳过去，滚动时会标出当前所在的小节。拖动边缘可以调宽度。
- **分屏：**可以上下左右分屏。把文件拖到窗格边缘，或者按住 ⌘ 点击文件即可。布局会被记住。
- **风格：**在「设置」里选，一共四种，每种都有浅色和深色（跟随系统，也可以手动选）：
  - 玻璃：通透的毛玻璃
  - 纸张：暖色纸面，衬线字；深色是灯下的旧纸
  - 终端：黑底绿字，等宽；浅色是浅底深绿字
  - 方块：像素方块世界，有天空、草地和石头面板；深色是夜晚，有月亮

  浏览器标签页的图标、Mac App 的 Dock 图标和关系图谱都会跟着风格变。
- **设置：**侧边栏底部的「设置」里有风格、明暗、正文字号、界面语言（中文 / English）、新文档是否显示大纲、宽度、同步、本机缓存、账号和检查更新。
- **关系图谱：**类似 Obsidian 的图谱，根据 `[[双链]]`、相对 `.md` 链接和 front matter 里的标签生成。
- **Markdown：**支持数学公式（KaTeX）、Mermaid 图，以及 Obsidian 的 `[[双链]]`（显示别名，点击打开对应笔记）和 `==高亮==`。
- **博客链接：**每篇已发布的文章都链接到它在博客上的页面（`https://qiao1.top/posts/<abbrlink>.html`）。
- **快，离线优先：**文档缓存在本机，还会提前下载。笔记先存在本机，联网后再上传。
- **总是最新：**打开着的窗口会自己用上新部署的版本，Mac App 也会自动更新。

## 安装

- **iPhone：**用 Safari 打开 <https://suiji-notes.vercel.app>，点分享按钮，再点「添加到主屏幕」。
- **Mac App：**运行 `./mac/build.sh --install` 生成（见[从源码构建](#从源码构建)）。不装 App 的话，在 Safari 里选「文件 → 添加到程序坞」也可以。
- **在 Mac 上同步一个文件夹：**

  ```sh
  npm run sync login       # 登录随记账号
  npm run sync add         # 选择文件夹，立即上传
  npm run sync install     # 设为登录 Mac 后自动在后台运行
  ```

  `npm run sync status` 查看账号、文件夹和文件数。`npm run sync remove ~/某个文件夹` 停止同步这个文件夹，云端文件保留。`npm run sync uninstall` 取消后台运行。

## 从源码构建

### 网页 App

```sh
npx vercel link --yes --project suiji-notes
npx vercel integration add supabase --yes --no-claim
npx vercel env pull .env.local --yes
npm install
npm run db:setup        # 根据 schema.sql 建表、设置权限和存储桶
npm run dev             # 在本地 5173 端口运行
npx vercel deploy --prod
```

### Mac App

需要 Xcode 命令行工具。

```sh
./mac/build.sh             # 生成 mac/build/随记.app（通用二进制，本地签名）
./mac/build.sh --install   # 同时复制到「应用程序」文件夹
./mac/build.sh --publish   # 生成 public/mac/Suiji.zip 和 version.json，随下次部署发布
```

发布新版本：把 `mac/build.sh` 里的 `BUILD` 加一，带 `--publish` 运行，再部署。

## 工作原理

| 部分 | 位置 | 作用 |
|---|---|---|
| 网页 App | `public/` | 纯 HTML/JS，不用框架，部署在 Vercel |
| 数据 | Supabase | Postgres 表 `notes` 和 `files`、私有存储桶和 Realtime。行级安全保证每个人只能看到自己的数据。 |
| 文件夹同步程序 | `agent/suiji-sync.mjs` | 由 launchd 在 Mac 上运行的 Node 脚本，监听要同步的文件夹 |
| Mac App | `mac/` | 用原生 AppKit 窗口装着网页 App，外加一个管理同步程序的菜单栏图标 |

**随手记**先存在本机，再写入 `notes` 表，其他设备通过 Realtime 实时收到改动。两台设备改同一条笔记时，以最后保存的为准。

**文件夹里的文件**双向同步：

- **Mac → 云端：**同步程序监听文件夹，新增和修改的文件会上传，本地删除的文件云端也会删除。另外每 5 分钟完整检查一遍，补上漏掉的改动。
- **手机 → Mac：**在 App 里保存的修改会更新这个文件的记录，同步程序通过 Realtime 收到通知后，把新版本写回本地。
- **冲突：**如果上次同步后两边都改了同一个文件，保留并上传本地版本，云端版本另存为「（随记副本）」。

## 说明

- Mac 窗口里加载的是线上网站，所以网页的改动每次部署后就会生效。打开着的窗口每 10 分钟、以及切回前台时检查一次有没有新部署：没有在编辑就自动刷新，否则显示「有新版本」按钮。
- Mac App 会在启动时和每 6 小时检查网站上的 `mac/version.json`，有更新的版本就在后台下载并校验，重启或退出时安装。
- 菜单栏图标显示同步程序是否在运行，还有「立即同步」、「打开同步的文件夹」和「查看同步日志」。指向其他网站的链接会用默认浏览器打开，下载的文件存到「下载」文件夹。
- 同步程序会跳过隐藏文件、`node_modules` 和 `.git`，超过 50 MB 的文件不上传。配置、状态和日志都在 `~/.suiji/`，日志是 `~/.suiji/sync.log`。
- 上传后，用之前签发的链接去读，存储可能还会返回旧内容一段时间。所以读取时用新签发的链接，并核对文件大小是否和记录一致。
- 界面有中文和英文（设置 → 语言，默认跟随系统），Mac App 的菜单也会跟着变。
- 风格、明暗和排序方式按设备分别保存。选「方块」时才会从 Google Fonts 加载两款像素字体。
