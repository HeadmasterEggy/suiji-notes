// Documents show as a mind map (Joey, 2026-11-23: 「博客无法展现思维导图的形式，加上这个功能」).
// 1. A document from the 思维导图 folder (front matter "mindmap-plugin: basic", Obsidian's Enhancing Mindmap
//    plugin) opens as a map: the title in the middle, headings and list items as branches, one line per link.
// 2. A [[wiki link]] in a node opens that note; a /posts/<abbrlink>.html link opens the published post.
// 3. Folding a branch hides what is under it and shows how many; the switch turns the map back into text.
// 4. An ordinary document opens as text, and its switch turns it into a map.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const map = `---
title: 深度学习思维导图
tags:
  - 思维导图
mindmap-plugin: basic
---
# 深度学习

## 基础
- [AI](/posts/fd0f6586.html)
- [[Week02|第二周]]
	- 子项一
	- 子项二
		- 孙项
- **加粗**

## 模型
- Transformer
- RNN
## 训练
- 优化器
## 评估
- 指标
`;
const plain = "# 普通笔记\n\n## 一\n\n- a\n- b\n\n## 二\n\n正文。\n";
const now = "2026-11-23T00:00:00Z";
for (const [id, name, body] of [["mm1", "思维导图/深度学习.md", map], ["mm2", "普通.md", plain]]) {
  vault.tables.files.push({ id, name, folder: "Notes", path: `u1/Notes/${name}`, size: new TextEncoder().encode(body).length,
    mime: "text/markdown", created_at: now, updated_at: now, links: [], tags: [], local_key: null });
  vault.blobs[`u1/Notes/${name}`] = body;
}

const app = await openApp({ vault });
const { page } = app, bad = [];
// Nodes glide into place; read the map once it has settled.
const settled = () => page.waitForSelector(".md-body.mm-on .mm:not([data-moving])", { timeout: 5000 });
const nodes = () => page.$$eval(".md-body .mm-node:not([hidden]) > .mm-text", (e) => e.map((x) => x.textContent.trim()));
try {
  await app.openDoc("Notes/思维导图/深度学习.md");
  await page.waitForSelector(".md-body.mm-on .mm-node", { timeout: 8000 }).catch(() => bad.push("the 思维导图 document did not open as a mind map"));
  await settled();
  if (await page.isVisible(".md-body .md-text")) bad.push("the text shows under the map");
  const want = ["深度学习", "基础", "AI", "第二周", "子项一", "子项二", "孙项", "加粗", "模型", "Transformer", "RNN", "训练", "优化器", "评估", "指标"];
  const got = await nodes();
  if (want.join("|") !== got.join("|")) bad.push(`nodes: want ${want.join(", ")}\n    got  ${got.join(", ")}`);
  const lines = await page.$$eval(".md-body .mm-links path", (e) => e.length);
  if (lines !== want.length - 1) bad.push(`want ${want.length - 1} lines joining the nodes, got ${lines}`);
  // Laid out: no two nodes on top of each other, and branches on both sides of the title.
  const boxes = await page.$$eval(".md-body .mm-node:not([hidden])", (e) => e.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1));
  if (overlap) bad.push("two nodes overlap");
  const [root] = boxes;
  if (!boxes.some((b) => b[2] <= root[0]) || !boxes.some((b) => b[0] >= root[2])) bad.push("the branches are not split left and right of the title");

  const post = await page.getAttribute('.mm-node a:text("AI")', "href");
  if (post !== "https://qiao1.top/posts/fd0f6586.html") bad.push("a /posts/ link in a node does not point at the blog: " + post);
  await page.click('.mm-node a:text("第二周")');
  await page.waitForFunction(() => /Week02/.test(document.querySelector(".p-meta")?.textContent || ""), null, { timeout: 5000 })
    .catch(() => bad.push("a [[wiki link]] in a node did not open the note"));
  await app.openDoc("Notes/思维导图/深度学习.md");
  await page.waitForSelector(".md-body.mm-on .mm-node");
  await settled();

  const branch = page.locator(".mm-node", { hasText: "子项二" }).first();   // no link in it: a click on the text folds
  await branch.hover();
  await branch.locator(".mm-text").click();
  await settled();
  const folded = await nodes();
  if (folded.includes("孙项") || !folded.includes("子项一")) bad.push("folding a branch should hide just what is under it: " + folded.join(", "));
  const n = (await branch.locator(".mm-fold").textContent()).trim();
  if (n !== "1") bad.push(`a folded branch should say 1 item is under it, says "${n}"`);
  // The click also lit the branch: its way back to the title stays bright, other branches dim.
  const lit = await page.$$eval(".mm.focus .mm-node.lit:not([hidden]) > .mm-text", (e) => e.map((x) => x.textContent.trim()));
  if (lit.join("|") !== "深度学习|基础|第二周|子项二") bad.push("clicking a node should light its branch, lit: " + lit.join(", "));
  await branch.locator(".mm-text").click();
  await settled();
  if (!(await nodes()).includes("孙项")) bad.push("clicking the folded node again did not unfold it");

  await page.click(".md-mm-toggle");
  if (!(await page.isVisible(".md-body .md-text")) || await page.isVisible(".md-body .mm")) bad.push("the switch did not turn the map back into text");

  await app.openDoc("Notes/普通.md");
  await page.waitForSelector(".md-body .md-mm-toggle", { timeout: 5000 }).catch(() => bad.push("an ordinary document has no mind map switch"));
  if (await page.isVisible(".md-body .mm")) bad.push("an ordinary document opened as a map");
  await page.click(".md-mm-toggle");
  await settled();
  const plainNodes = await nodes();
  if (plainNodes.join("|") !== "普通笔记|一|a|b|二") bad.push("an ordinary document's map: " + plainNodes.join(", "));
  if (app.errors.length) bad.push("errors: " + app.errors.join("; "));
} finally { await app.close(); }
if (bad.length) { console.log("the mind map view is broken:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("documents show as mind maps");
