# 笔记内搜索

- Asked: Joey 说「加上搜索功能，在笔记中也可以搜索」。理解为两件事：侧边栏搜索要能搜到正文里的字；打开的笔记里能像浏览器一样 ⌘F 查找。
- Done:
  - 侧边栏搜索原本已经会搜正文，但只搜这台设备缓存过的文件，后台预取到的新内容也不会刷新结果。现在一开始搜索就把还没下载的文档读进来，读到一篇结果就更新一次，列表底部显示「还在读取 N 篇文档的内容…」。
  - 靠正文命中的结果在名字下面显示命中的那一行，关键词高亮（`find.js` 的 `snippet()`）。
  - 从搜索结果打开文档时，自动打开查找栏并跳到第一个匹配。
  - 新的文中查找（`public/find.js`）：⌘F / Ctrl+F 或工具栏放大镜打开；Enter / ⇧Enter、⌘G / ⇧⌘G 上下跳，显示「2/5」，Esc 关闭。阅读视图用 CSS Custom Highlight API 标记，不改文档 DOM，能跨粗体等行内元素匹配；编辑状态（随手记、编辑中的文件）用一层和 textarea 同字体同内边距的透明镜像画标记，Esc 后回到编辑器并选中当前匹配。⇧⌘F 去侧边栏搜索。手机上查找栏浮在按钮下面。
  - 改动文件：`public/find.js`（新）、`public/app.js`、`public/index.html`、`public/style.css`、`public/i18n.js`、`public/sw.js`（SHELL 加 find.js，CACHE 没动）、`scripts/checks/search-in-notes.mjs`（新）。
  - PR：见本 PR。
- Checked: `npm run check`、`npm run smoke`、新检查 `scripts/checks/search-in-notes.mjs`（redgreen：旧代码红，新代码绿），以及其它 `scripts/checks/*`。截图看过玻璃、终端、纸张三种风格和手机布局。
- Open: 没在真机 Safari / Mac app 上试过。Custom Highlight API 需要 Safari 17.2+；更旧的浏览器能计数和跳转，但阅读视图里没有黄色标记。省流量模式下不会为搜索下载文档（沿用原来预取的规则）。
- Learned: 侧边栏的正文索引是 `bodies`（小写）和新加的 `texts`（原文，给摘要用），都由 `fileText()` 填。查找栏每个窗格一个（`p.find`），文档切换或切换阅读/编辑时由 `renderPane` 调 `retarget()`；文件内容异步渲染，`ready()` 等 `p.shownId === p.itemId` 后才跳到第一个匹配。
