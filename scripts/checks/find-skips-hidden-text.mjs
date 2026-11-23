// Find in a document counts only text the reader can see. A Markdown document also carries its mind map
// (hidden until switched on), and ⌘F used to count the map's copy of every list item too: "o" in Week01 said
// 7/21 with the first visible match, and Enter stepped through six matches that showed nothing.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const { page } = app, bad = [];
try {
  await app.openDoc("COMP5318/Week01.md");
  await page.click(".p-preview");
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("o");
  await page.waitForTimeout(400);
  const n = await page.textContent(".p-find-n");
  if (!/^1\//.test(n)) bad.push(`the first visible match should be 1/…, got ${n}`);
  // Every marked match is on screen somewhere (has a box), none is in hidden text.
  const hidden = await page.evaluate(() => [...(CSS.highlights.get("suiji-find") || []), ...(CSS.highlights.get("suiji-find-cur") || [])]
    .filter((r) => !r.getClientRects().length).map((r) => r.startContainer.parentElement.className));
  if (hidden.length) bad.push(`${hidden.length} matches are in hidden text: ${[...new Set(hidden)].join(", ")}`);
} finally {
  await app.close();
}
if (bad.length) { console.error("FAIL find-skips-hidden-text\n  " + bad.join("\n  ")); process.exit(1); }
console.log("ok   find-skips-hidden-text");
