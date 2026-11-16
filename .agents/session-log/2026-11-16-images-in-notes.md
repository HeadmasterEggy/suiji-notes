# 笔记里的图片

- Asked: Joey 说「现在图片不支持，修复一下」：文档里的图片显示不出来。
- Done（PR 见下）:
  - 原因：PR #1「只显示 Markdown」之后，Mac 文件夹同步（`public/syncengine.js`）和网页上传（`uploadFiles`）都只收 .md，图片从此进不了云端；渲染端其实会按 `allFiles` 找图片，找不到就显示「[图片：xxx]」。
  - 同步：.md 之外也同步图片（png/jpg/jpeg/gif/webp/svg/bmp/avif/heic），本地删掉的图片云端也删；仍不往回拉图片。侧栏列表照旧只显示 .md。
  - 上传：选文件夹/拖入时图片一起上传；只传图片时提示用 `![[名字]]` 引用。
  - 编辑文档时粘贴或拖入图片：存到文档旁边（Mac 本地文件夹里写到磁盘，交给同步上传；否则直接上传云端），在光标处写 `![](Pasted%20image 时间戳.png)`。
  - 文件：`public/syncengine.js`、`public/app.js`、`public/localsync.js`、`public/i18n.js`、`scripts/harness.mjs`（假 Supabase 记录 insert/upload）、新检查 `scripts/checks/image-sync.mjs`、`scripts/checks/images-in-notes.mjs`。
- Checked: 两个新检查用 redgreen 证明旧代码红、新代码绿；`npm run check`、`npm run smoke`（27 个全过）、`scripts/checks/` 全部通过。没在真机 Mac app 和线上数据里试。
- Open: 已有的图片要等 Mac app 下次同步（打开即同步，或 5 分钟内）才会上传；只在网页上传过文档、没用文件夹同步的，需要把图片再拖进来一次。手机上粘贴到同步文件夹里文档的图片只在云端，不会写回 Mac 磁盘。
- Learned: 渲染找图片用的是 `allFiles`（含隐藏的非 .md 文件），所以「只显示 .md」不影响渲染，只要图片在云端就行。
