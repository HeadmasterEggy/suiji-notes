# 合并剩下的旧 PR，图谱再去掉「自我修复」

- 要求：Joey 说「按顺序合并 pr」，要把仓库里所有还开着的 PR 按编号合并；接着又说「自我修复不要」，图谱里也不要这个文件夹。
- 已做：
  - #4（助手空回复时说明原因）：把 main 合进去。main 的助手已经会流式显示思考过程（#13），所以冲突里保留 main 的 `api/agent.js` 和 `step()`，只把「没有收到内容时说明原因」这一段移植过去。新增检查 `scripts/checks/assistant-empty-reply.mjs`。
  - #8（终端风格和笔记本风格的显示问题）：把 main 合进去。任务列表、引用、行内代码 main 已经在 #14 里改过，冲突保留 main 的写法；这个 PR 剩下的是终端风格的代码块背景、`####` 前缀、编号列表留宽，以及笔记本风格标题换行后每行都有荧光笔。新增检查 `scripts/checks/terminal-markdown.mjs`。
  - 图谱：`GRAPH_SKIP` 加上「自我修复」，检查改名为 `graph-skip-folders.mjs`，同时覆盖两个文件夹。
  - 合并顺序：#4、#8，然后是本 PR。
- 测试：三项新检查都用 redgreen 验证过（旧代码失败、修复后通过）。每个分支上 `npm run check`、`npm run smoke`（27 项）和 `scripts/checks/` 里的检查都通过了。
- 未完成：无。
- 备注：「自我修复」和「思维导图」在代码里都没有对应功能，只是 Joey 笔记库里的文件夹名。旧分支上的 `sw.js` 冲突一律保留 `"suiji-dev"`。
