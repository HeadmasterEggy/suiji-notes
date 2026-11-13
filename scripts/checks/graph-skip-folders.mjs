// The graph leaves out the mind map and self-repair folders (Joey, 2026-11-13: 「思维导图那个文件夹也不要加」,
// 「自我修复不要」), at any depth, along with the links into them. Their files still show in the sidebar.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const now = "2026-11-13T00:00:00Z";
const extra = [
  ["m1", "思维导图", "COMP5318 总览.md", "# 总览\n\n[[Week01]] [[Week02]]\n"],
  ["m2", "Notes", "思维导图/读书.md", "# 读书\n\n[[README]]\n"],
  ["s1", "自我修复", "日记.md", "# 日记\n\n[[Week01]]\n"],
  ["s2", "Notes", "自我修复/练习.md", "# 练习\n\n[[README]]\n"],
];
for (const [id, folder, name, body] of extra) {
  vault.tables.files.push({ id, name, folder, path: `u1/${folder}/${name}`, size: body.length, mime: "text/markdown",
    created_at: now, updated_at: now, links: [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1] + ".md"), tags: [], local_key: null });
  vault.blobs[`u1/${folder}/${name}`] = body;
}

const app = await openApp({ vault });
const bad = [];
try {
  await app.page.click("#graphBtn");
  await app.page.waitForSelector(".graph-canvas");
  const meta = await app.page.$eval(".p-meta", (e) => e.textContent);
  const nodes = +(/(\d+)\s*(?:个节点|nodes?)/.exec(meta) || [])[1];
  const edges = +(/(\d+)\s*(?:条链接|links?)/.exec(meta) || [])[1];
  if (nodes !== 3) bad.push(`the graph has ${nodes} nodes, want 3 (the left-out folders dropped): ${meta}`);
  if (edges !== 1) bad.push(`the graph has ${edges} links, want 1 (Week01 ↔ Week02): ${meta}`);
  const legend = await app.page.$$eval(".graph-legend .name", (e) => e.map((x) => x.textContent));
  if (legend.some((s) => /思维导图|自我修复/.test(s))) bad.push("the legend lists a left-out folder: " + legend.join(", "));
} finally { await app.close(); }
if (bad.length) { console.log("left-out folders show up in the graph:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("the graph leaves out the mind map and self-repair folders");
