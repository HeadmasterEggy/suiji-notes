# 助手输出打磨（循环）

- Asked: Joey 要开一个循环，持续改进助手（agent）输出的格式和界面，每轮一个 PR，可以直接合并。
- Done:
  - 第 1 轮：表格里 `:---:` / `---:` 列的对齐不再被样式盖成左对齐，表头不折行；写完的代码块上方加一条栏，显示语言和「复制」按钮；整条回答下方加「复制」，复制的是模型写的 Markdown 原文；终端等方角风格里代码块也是方角。（PR #25）
  - 第 2 轮：连续的工具调用排在同一行；每个工具标签运行时转圈，完成后显示 ✓，失败显示 ✕，悬停能看到失败原因；去掉了一条从来没生效的「…」样式。
- Checked: 用 `scripts/harness.mjs` 打开应用、拦截 `/api/agent` 返回两步工具调用加一段完整 Markdown，在默认、终端、纸张、笔记本、霓虹等风格（亮/暗、桌面和 390px 手机宽度）截图检查；新增 `scripts/checks/assistant-answer-tools.mjs`（第 1 轮）和 `assistant-tool-chips.mjs`（第 2 轮），redgreen 在旧代码上红、修复后绿；`npm run check`、`npm run smoke` 和所有 checks 通过。没有在真实模型上试。
- Open: 后续轮次继续找问题（工具调用显示、间距、长对话等）。
- Learned: 探查脚本思路：`openApp()` 后 `page.route("**/api/agent")` 按请求次数返回不同的 NDJSON，就能模拟多步工具调用；`propose_edit` 等工具会在页面里真的执行。
