// Search inside documents (Joey, 2026-11-14: 「加上搜索功能，在笔记中也可以搜索」).
// 1. The sidebar search finds a word inside a document this device has never opened, and its row shows the line.
// 2. Opening that result opens the find bar on the word, marked in the text.
// 3. ⌘F / Ctrl+F in an open document finds, counts and steps through matches, in the reading view and while
//    editing (where the marks are painted by a mirror over the textarea), and Esc leaves the match selected.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const body = "# 读书笔记\n\n第一段提到 Lighthouse。\n\n## 第二节\n\n这里又有 lighthouse 和 **Light**house。\n";
vault.tables.files.push({ id: "s1", name: "读书.md", folder: "Notes", path: "u1/Notes/读书.md", size: new TextEncoder().encode(body).length,
  mime: "text/markdown", created_at: "2026-11-13T00:00:00Z", updated_at: "2026-11-13T00:00:00Z", links: [], tags: [], local_key: null });
vault.blobs["u1/Notes/读书.md"] = body;

const app = await openApp({ vault, storage: { "suiji:open": JSON.stringify(["Notes"]) } });
const { page } = app, bad = [];
const count = () => page.textContent(".p-find-n").catch(() => null);
try {
  await page.fill("#search", "lighthouse");
  const row = page.locator('.tree-file[data-id="s1"]');
  await row.waitFor({ timeout: 8000 }).catch(() => bad.push("the sidebar search did not find a word inside a document"));
  const snip = await row.locator(".tree-snip").textContent().catch(() => "");
  if (!/提到 Lighthouse/.test(snip)) bad.push(`the result does not show the line with the word: "${snip}"`);

  await row.click().catch(() => {});
  await page.waitForFunction(() => /^1\/3$/.test(document.querySelector(".p-find-n")?.textContent || ""), null, { timeout: 8000 })
    .catch(async () => bad.push(`opening the result did not open find on the word (3 matches, one split by bold): ${await count()}`));
  const marked = await page.evaluate(() => [CSS.highlights.get("suiji-find")?.size, CSS.highlights.get("suiji-find-cur")?.size]);
  if (marked[0] !== 2 || marked[1] !== 1) bad.push(`want 2 marks and 1 current mark in the text, got ${marked}`);

  await page.keyboard.press("Escape");   // focus is in the document, so Esc stays with the outline etc.
  await page.click(".p-find-x");
  if (await page.isVisible(".p-find")) bad.push("the close button left the find bar open");
  await page.click(".p-preview");
  await page.keyboard.press("ControlOrMeta+f");
  if (!(await page.isVisible(".p-find"))) bad.push("⌘F did not open the find bar");
  await page.keyboard.type("第");
  await page.waitForTimeout(300);
  if ((await count()) !== "1/2") bad.push(`find "第" in the reading view: want 1/2, got ${await count()}`);
  await page.keyboard.press("Enter");
  if ((await count()) !== "2/2") bad.push(`Enter did not step to the next match: ${await count()}`);
  await page.keyboard.press("Shift+Enter"); await page.keyboard.press("Shift+Enter");
  if ((await count()) !== "2/2") bad.push(`⇧Enter did not step back round to the last match: ${await count()}`);
  await page.keyboard.press("Escape");
  if (await page.isVisible(".p-find")) bad.push("Esc did not close the find bar");

  await page.click(".p-edit");
  await page.waitForSelector(".p-ta:not([hidden])");
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("lighthouse");   // the find bar remembers "第"; typing over the selection replaces it
  await page.waitForTimeout(300);
  if ((await count()) !== "1/2") bad.push(`find while editing (raw text, the bold one no longer matches): want 1/2, got ${await count()}`);
  const marks = await page.$$eval(".find-mirror mark", (m) => m.map((x) => x.textContent));
  if (marks.join() !== "Lighthouse,lighthouse") bad.push("the editor's mirror does not mark the matches: " + marks.join());
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const sel = await page.evaluate(() => { const t = document.querySelector(".p-ta"); return [document.activeElement === t, t.value.slice(t.selectionStart, t.selectionEnd), t.selectionStart]; });
  if (!sel[0] || sel[1] !== "lighthouse" || sel[2] !== body.indexOf("lighthouse")) bad.push("Esc did not leave the second match selected in the editor: " + JSON.stringify(sel));
} finally { await app.close(); }
if (bad.length) { console.log("search inside documents is broken:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("the sidebar finds words inside documents, and ⌘F finds and steps through them in the open one");
