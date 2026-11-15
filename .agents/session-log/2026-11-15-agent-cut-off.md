# 助手回答被截断

- Asked: Joey 说「agent 输出经常被截断，修复」。
- Done: 找到三处会让回答停在半句的地方，并在 PR（见下）里修好：
  1. 模型到了单次输出上限（finish reason `length`）。我们没有设 max_tokens，很多 OpenAI 兼容服务默认只有 4K 甚至 1K token；页面收到 `length` 后什么也不说，回答就停在半句。现在会自动让模型「从断开处接着写」，最多 3 次，续写接在同一段文字里；仍没写完就在下面说明，可以说「继续」。
  2. 服务端的流没有 `done` 就结束了（连接断开或函数超时），或者流中途报错；以前只要已经有文字就当成正常结束、错误被吞掉。现在同样自动接着写。
  3. 工具调用连续用满 10 步时，回合直接结束，没有回答。现在最后一步带 `final`，服务端传 `toolChoice: "none"`（本机模型传 `tool_choice: "none"`），模型必须用已有结果作答。
  - 本机模型（Magpie / Ollama 等）的流现在也会读 `finish_reason` 并发出 `done`，所以同样能续写。
  - 改动文件：`public/agent.js`、`api/agent.js`、`public/i18n.js`、`public/style.css`、新检查 `scripts/checks/assistant-cut-off-answer.mjs`。
  - 排除了的原因：#25–#30 的 CSS（代码块 `max-height: 26em` 可以滚动，五行折叠只用于用户引用）不会裁掉回答文字。
- Checked: `npm run check`、`npm run smoke`（27 个全过）、`scripts/checks/` 全部通过；新检查用 `redgreen.mjs` 证明在旧代码上红、修复后绿。没有在线上复现（容器连不上 vercel.app，Vercel 日志只留约 30 分钟）。
- Open: 如果 Joey 还看到截断，最好记下当时用的模型和大概长度，以便确认是不是别的原因（例如 Vercel 函数时长，项目没有设置 maxDuration，用的是默认值）。
- Learned: `step()` 现在返回 `{ calls, cut, out, textEl }`；续写时把 `carry` 传回 `step()`，在同一个 `.ag-text` 里接着打字（typer 有 `resume()`）。
