// Tasks can be ticked in the reading view, as in Obsidian: the box writes [x] / [ ] into that line of the file.
// Before, the boxes were disabled and a click did nothing. A "- [ ]" inside a code block is not a task and
// must not shift which line a box writes to.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const body = "# 待办\n\n```md\n- [ ] not a task, just code\n```\n\n- [ ] first\n- [x] second\n  - [ ] nested\n\n> - [ ] quoted\n";
vault.tables.files.push({ id: "t1", name: "待办.md", folder: "Notes", path: "u1/Notes/待办.md", size: new TextEncoder().encode(body).length,
  mime: "text/markdown", created_at: "2026-11-13T00:00:00Z", updated_at: "2026-11-13T00:00:00Z", links: [], tags: [], local_key: null });
vault.blobs["u1/Notes/待办.md"] = body;

const app = await openApp({ vault });
const { page } = app, bad = [];
const saved = () => page.evaluate(async () => { const b = window.__suiji.bodies?.["u1/Notes/待办.md"]; return b ? await b.text() : null; });
const box = (i) => page.locator(".md-text li > input[type=checkbox]").nth(i);
try {
  await app.openDoc("Notes/待办.md");
  const n = await page.locator(".md-text li > input[type=checkbox]").count();
  if (n !== 4) bad.push(`want 4 task boxes, got ${n}`);
  await box(0).click({ timeout: 3000 }).catch(() => bad.push("the first task box can't be clicked"));
  await page.waitForTimeout(600);
  let text = await saved();
  if (!text?.includes("- [x] first")) bad.push(`ticking "first" did not save it ticked: ${JSON.stringify(text)}`);
  if (!text?.includes("- [ ] not a task, just code")) bad.push("the code block's line was changed");
  await box(2).click({ timeout: 3000 }).catch(() => bad.push("the nested task box can't be clicked"));
  await page.waitForTimeout(600);
  text = await saved();
  if (!text?.includes("  - [x] nested") || !text?.includes("- [x] first")) bad.push(`ticking "nested" after "first": ${JSON.stringify(text)}`);
  await box(1).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  text = await saved();
  if (!text?.includes("- [ ] second")) bad.push(`unticking "second": ${JSON.stringify(text)}`);
  if (!(await box(0).isChecked()) || (await box(1).isChecked())) bad.push("the boxes on screen don't show what was saved");
} finally {
  await app.close();
}
if (bad.length) { console.error("FAIL tick-tasks-reading\n  " + bad.join("\n  ")); process.exit(1); }
console.log("ok   tick-tasks-reading");
