# 文档以思维导图显示

- 要求：Joey 说「博客无法展现思维导图的形式，加上这个功能」。博客 `_posts/思维导图/` 里的 3 篇 .md（大模型技术栈、深度学习、整体思维导图）是 Obsidian 的 Enhancing Mindmap 插件格式（front matter `mindmap-plugin: basic`，标题 + 嵌套列表），在随记里只显示成普通列表。
- 已做：
  - 新增 `public/mindmap.js`：从渲染好的文档里读出标题和列表的层级，画成思维导图（标题在中间，一级分支分到左右两边，每个一级分支一种颜色）。节点里的链接、[[双链]]、加粗、公式照常可用。可以折叠/展开分支（折叠后显示下面有几项）、缩放（按钮或 ⌘/Ctrl + 滚轮）、拖动空白处平移、「适应」宽度。节点超过 120 个时默认只展开两层。
  - 带 `mindmap-plugin` 的文档默认以导图打开；其他文档标题下有「思维导图」按钮，可以切换（同一篇在本次打开期间记住选择）。
  - `public/app.js`：front matter 的键允许带连字符（以前 `mindmap-plugin` 读不到）；`/posts/<abbrlink>.html` 这种博客内部链接改为打开已发布的博客文章（以前显示为「没有找到这个文件」）；导图在文档显示后再挂上（缓存的文档是克隆出来的，事件会丢）。
  - `public/style.css` 加导图样式，eink / ink 两个风格用单色；`public/i18n.js` 加英文；`public/sw.js` 把 mindmap.js 加进离线缓存列表。
  - PR 见本次提交。
- 测试：新增 `scripts/checks/mindmap-view.mjs`（导图节点和连线、左右分布不重叠、双链点击打开笔记、/posts/ 链接指向博客、折叠和计数、切回文本、普通文档切换成导图）。redgreen：旧代码红，新代码绿。`npm run check`、`npm run smoke`（27 项）和 scripts/checks/ 全部 17 个检查都通过。用 Joey 博客里的 3 篇真实文件在默认、深色、paper 和手机宽度下截了图看过。
- 未完成：`思维导图/Canvas/*.canvas`（Obsidian 白板）没有做，因为随记只显示 .md 文件。触屏上没有双指缩放，只能用按钮缩放。导图模式下右侧「大纲」点击不会跳转。
- 备注：Joey 的博客仓库在 Mac 上是 `/Users/joey/blog`，文章在 `source/_posts/`。
