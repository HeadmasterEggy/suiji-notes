# 加载图片时文档反复刷新

- Asked: PR #33 合并后 Joey 说「加载图片的时候一直在刷新，很烦人」。
- Done（PR 见下）:
  - 原因：文档画好后的「是否需要重画」用的是整个账号所有文件路径的签名（`pathsSig`）。PR #33 之后 Mac 同步会把文件夹里的图片一张张传上去，每传一张就来一个 Realtime 事件 → `loadFiles` → 路径签名变了 → 所有打开的文档整篇重画、图片重新加载，于是一直在闪。
  - 修复：`renderMarkdown` 记下这篇文档的图片和链接实际找到了哪些文件（`dataset.refs`），`drawKey` 只看这个，不再看全账号路径。别的文件进来时重画结果一样，页面不动；只有这篇等的图片到了才换一次。
  - Realtime 和本地同步触发的 `loadFiles` 合并成 0.8 秒一次（`loadFilesSoon`）。
  - 文件：`public/app.js`、`scripts/harness.mjs`（假 channel 记下 Realtime 回调，检查可以模拟别处的改动）、新检查 `scripts/checks/images-no-redraw-flicker.mjs`。
- Checked: 新检查 redgreen 旧红新绿；`npm run check`、`npm run smoke`（27 个）、`scripts/checks/` 全部通过。没在 Joey 的 Mac 上实测。
- Open: 图片同步完成之前，文档里还没传上的图片仍显示「[图片：xxx]」，到了会自动换上（每张最多重画一次）。
- Learned: 打开的文档是否重画由 `drawKey` + `sameDrawing` 决定；任何会频繁变化的全局量放进 `drawKey` 都会让页面一直重画。
