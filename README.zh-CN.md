# 随记

[English](README.md) · **简体中文**

在 iPhone 和 Mac 之间同步的笔记 App。它可以作为网页 App 添加到手机主屏幕（PWA），也有原生 Mac App。Mac 上的同步程序会把一个本地文件夹（比如 Hexo 博客的 `source/_posts`）和 App 保持同步，所以在手机上也能看、能改你的 Markdown 文件。

地址：<https://suiji-notes.vercel.app>

## 功能

- **一棵目录树：**在 App 里写的随手记放在最上面的「随手记」文件夹，同步过来的文件夹排在下面。
- **哪里都能改：**在手机上改文件，几秒后 Mac 上的同步程序就会写回本地。
- **大纲：**每个 Markdown 文件旁边有一个大纲面板，列出所有标题。点击就能跳过去，滚动时会标出当前所在的小节。
- **分屏：**可以上下左右分屏。把文件拖到窗格边缘，或者按住 ⌘ 点击文件即可。布局会被记住。
- **关系图谱：**类似 Obsidian 的图谱，根据 `[[双链]]`、相对 `.md` 链接和 front matter 里的标签生成。
- **Markdown：**支持数学公式（KaTeX）和 Mermaid 图。
- **博客链接：**每篇已发布的文章都链接到它在博客上的页面（`https://qiao1.top/posts/<abbrlink>.html`）。
- **打开快：**文档缓存在本机，还会提前下载，所以打开几乎是瞬间的。
- **离线优先：**笔记先存在本机，联网后再上传。

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
- **读到旧内容：**上传后，用之前签发的链接去读，存储可能还会返回旧内容一段时间。所以读取时用新签发的链接，并核对文件大小是否和记录一致。

## Mac App

```bash
./mac/build.sh             # 生成 mac/build/随记.app（通用二进制，本地签名）
./mac/build.sh --install   # 同时复制到「应用程序」文件夹
```

需要 Xcode 命令行工具。App 会记住登录状态。指向其他网站的链接会用默认浏览器打开，下载的文件存到「下载」文件夹。菜单栏图标显示同步程序是否在运行，还有「立即同步」、「打开同步的文件夹」和「查看同步日志」。

## 文件夹同步程序

```bash
npm run sync login       # 登录随记账号
npm run sync add         # 选择文件夹，立即上传
npm run sync install     # 设为登录 Mac 后自动在后台运行
npm run sync status      # 查看账号、文件夹和文件数
npm run sync remove ~/某个文件夹   # 停止同步这个文件夹（云端文件保留）
npm run sync uninstall   # 取消后台运行
```

隐藏文件、`node_modules` 和 `.git` 会跳过，超过 50 MB 的文件不上传。配置、状态和日志都在 `~/.suiji/`，日志是 `~/.suiji/sync.log`。

## 部署

```bash
npx vercel link --yes --project suiji-notes
npx vercel integration add supabase --yes --no-claim
npx vercel env pull .env.local --yes
npm install
npm run db:setup        # 根据 schema.sql 建表、设置权限和存储桶
npx vercel deploy --prod
```

`npm run dev` 会在本地 5173 端口运行 App。

## 不装 App 也能用

- **iPhone：**用 Safari 打开网址，点分享按钮，再点「添加到主屏幕」。
- **Mac：**在 Safari 里选「文件 → 添加到程序坞」；用 Chrome 的话点地址栏里的安装图标。
