# 助手回答仍被截断（第二轮）

- Asked: Joey 说「现在 agent 的输出还是会被截断」（#32 之后）。
- Done: 在 PR #44 里补上 #32 没覆盖到的三处：
  1. 服务端从不设 max_tokens，回答长度取决于服务的默认值（常见 4K，思考模型大半花在思考上）。现在 `api/agent.js` 请求 32000；服务拒绝时（如 "valid range of max_tokens is [1, 8192]"）按它说的上限重试，读不出上限就不带 max_tokens 再试一次。
  2. 服务用别的理由停下时（DeepSeek 忙时的 `insufficient_system_resource`，AI SDK 归为 "other"），页面当成正常结束。现在服务端把原始理由作为 `raw` 传给页面，页面只把 stop / end_turn / tool_calls / content_filter 等当作写完，其它都自动接着写。
  3. 续写时模型只返回思考、或续写请求失败，以前会弹错误框并把整轮从对话里删掉。现在保留已写的部分，下面注明「回答没有写完就停了，可以说『继续』」。
  - 改动：`api/agent.js`、`public/agent.js`、`public/i18n.js`、`scripts/checks/assistant-cut-off-answer.mjs`（加两种情况）、新检查 `scripts/checks/assistant-server-output-room.mjs`（在 Node 里用假的 OpenAI 兼容服务跑 `api/agent.js`，不开浏览器、不连 Supabase）。
- Checked: `npm run check`、`npm run smoke`（27 个全过）、`scripts/checks/` 全部通过；两个检查都用 `redgreen.mjs` 证明旧代码红、修复后绿。也排除了显示问题：长回答在桌面、手机和几个主题下最后一行都完整可见。
- Open: 还是没能在线上用真实模型复现：这个线程的容器连不上 vercel.app（新环境只对新线程生效），也没有 Joey 的登录。如果还截断，需要知道用的是哪个服务和模型，以及是停在半句还是显示被遮住。
- Learned: AI SDK（openai-compatible 3.x）把不认识的 finish_reason 都映射成 "other"，原始值在 finish 部分的 `rawFinishReason`；流没有 finish_reason 就结束时会发 error 和 finish "error"。`streamText` 默认的 onError 会把 400 打到 console，所以新检查输出里那段报错是正常的。分支 `claude/project-thread-wvw69s` 上 #32 已合并的旧提交是用 `merge -s ours` 接上的（auto mode 不允许 force push）。
