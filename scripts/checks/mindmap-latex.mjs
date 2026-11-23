// Formulas in mind maps (Joey, 2026-11-23: 「思维导图也要支持 latex」).
// Inline $…$ and \(…\) render in nodes, and so does a $$…$$ written on a list item's line, which used to break
// out of the list: the item lost its place in the tree (and its children) in the map and in the text.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const map = String.raw`---
mindmap-plugin: basic
---
# 公式 $\mathcal{L}$

## 注意力 $\frac{QK^T}{\sqrt{d_k}}$
- 独立公式
	- $$\sum_{i=1}^{n} x_i^2$$
	- \(e^{i\pi}+1=0\)
- 交叉熵 $-\sum_i y_i \log \hat y_i$
## 期望
- $$\mathbb{E}_{x\sim p}[f(x)] = \int f(x)p(x)\,dx$$
- 普通文字
`;
vault.tables.files.push({ id: "t", name: "公式.md", folder: "Notes", path: "u1/Notes/公式.md", size: new TextEncoder().encode(map).length,
  mime: "text/markdown", created_at: "2026-11-23T00:00:00Z", updated_at: "2026-11-23T00:00:00Z", links: [], tags: [], local_key: null });
vault.blobs["u1/Notes/公式.md"] = map;

const app = await openApp({ vault });
const { page } = app, bad = [];
try {
  await app.openDoc("Notes/公式.md");
  await page.waitForSelector(".mm:not([data-moving]) .mm-node", { timeout: 8000 });
  await page.waitForTimeout(300);
  const nodes = await page.$$eval(".mm-node:not([hidden])", (e) => e.map((x) => ({
    depth: +x.dataset.depth, tex: x.querySelectorAll(".katex").length, text: x.querySelector(".mm-text").textContent.trim(),
    box: (({ left, top, right, bottom }) => [left, top, right, bottom])(x.getBoundingClientRect()) })));
  if (nodes.length !== 9) bad.push(`want 9 nodes, got ${nodes.length}: ${nodes.map((n) => n.text).join(" | ")}`);
  const withTex = nodes.filter((n) => n.tex).length;
  if (withTex !== 6) bad.push(`want a formula in 6 nodes, got ${withTex}`);
  if (nodes.some((n) => /\$|\\\(|KATEX/.test(n.text))) bad.push("a node shows raw formula source: " + nodes.filter((n) => /\$|\\\(|KATEX/.test(n.text)).map((n) => n.text).join(" | "));
  const parent = nodes.findIndex((n) => n.text === "独立公式");
  if (parent < 0 || nodes[parent + 1]?.depth !== 3 || nodes[parent + 2]?.depth !== 3) bad.push("the $$ formulas are not children of 独立公式");
  const boxes = nodes.map((n) => n.box);
  if (boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1))) bad.push("two nodes overlap");

  await page.click(".md-mm-toggle");   // the text: the list keeps its items, formulas included
  const items = await page.$$eval(".md-text li", (e) => e.length);
  if (items !== 6) bad.push(`the text should keep a list of 6 items, has ${items}`);
  if (app.errors.length) bad.push("errors: " + app.errors.join("; "));
} finally { await app.close(); }
if (bad.length) { console.log("formulas in mind maps are broken:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("formulas show in mind maps");
