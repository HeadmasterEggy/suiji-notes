# 2026-11-23 · 找 bug 和交互可以优化的地方（循环）

- 请求：「开 loop 找 bug 和 ui，交互可以优化的地方」（Joey）。每轮一个小 PR，测试通过后自己合并。
- 避开思维导图文件（`public/mindmap.js` 及相关样式），PR #36 还在等 Joey 测试。

## 第 1 轮

- Bug：文档里按 ⌘F 搜索，会把隐藏的思维导图里的文字也算进去。Week01 搜 “o” 显示 7/21，第一个看得见的结果是第 7 个；按回车会先在 6 个看不见的结果上空转。现在 `find.js` 跳过隐藏的元素（`hidden` 或 `display: none`），折叠的 `<details>` 里的文字仍然算。
- 交互：侧边栏原来只有 ↑ / ↓ 能用。现在像 Finder 一样：→ 展开文件夹，再按一次进入；← 收起文件夹，或从文件回到它所在的文件夹；Home / End 跳到第一行和最后一行。
- 手机 ⋯ 菜单顶部的文件信息，时间会被挤到第二行。现在文件名单独一行，大小和时间在第二行。
- 改动文件：`public/find.js`、`public/app.js`、`public/style.css`；新增检查 `scripts/checks/find-skips-hidden-text.mjs`、`scripts/checks/tree-arrow-keys.mjs`。
- 测试：两个新检查用 `redgreen.mjs` 验证过（旧代码红、修复后绿）；`npm run check`、`npm run smoke`（27 项）和 `scripts/checks/` 全部通过。手机菜单是截图确认的，没有写检查（只是排版）。
