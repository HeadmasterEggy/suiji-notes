// Tags never become nodes in the graph (Joey, 2026-11-13: no tag collections in the graph). There used to be a
// "Tag nodes (#tags)" switch in the graph settings, and the assistant's show_graph with a tag turned it on.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const bad = [];
try {
  await app.page.click("#graphBtn");
  await app.page.waitForSelector(".graph-canvas");
  await app.page.click(".graph-tools button:nth-child(2)");   // Settings
  const switches = await app.page.$$eval(".graph-switch span", (e) => e.map((x) => x.textContent));
  if (switches.some((s) => s.includes("#"))) bad.push("the settings still offer tag nodes: " + switches.join(", "));
  const meta = await app.page.$eval(".p-meta", (e) => e.textContent);
  const nodes = +(/(\d+)\s*(?:个节点|nodes?)/.exec(meta) || [])[1];
  const docs = await app.page.evaluate(() => window.__suiji.tables.files.filter((f) => /\.md$/i.test(f.name)).length + (window.__suiji.tables.notes || []).length);
  if (nodes !== docs) bad.push(`the graph has ${nodes} nodes for ${docs} documents`);
} finally { await app.close(); }
if (bad.length) { console.log("tags show up in the graph:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("the graph has no tag nodes");
