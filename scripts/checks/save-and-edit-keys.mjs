// ⌘S / Ctrl+S saves the document being edited at once and never reaches the browser (whose "Save Page As"
// downloaded the app's HTML); ⌘E switches the focused document between reading and editing, as in Obsidian.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const { page } = app, bad = [];
const editing = () => page.locator(".p-ta").first().isVisible();
try {
  await app.openDoc("COMP5318/Week01.md");
  await page.click(".p-preview");
  await page.keyboard.press("ControlOrMeta+e");
  await page.waitForTimeout(300);
  if (!(await editing())) bad.push("⌘E in the reading view did not start editing");

  await page.evaluate(() => addEventListener("keydown", (e) => { window.__savePrevented = e.defaultPrevented; }));
  await page.locator(".p-ta").first().press("End");
  await page.keyboard.type(" more");
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(300);   // well before the 1.2 s autosave
  if (!(await page.evaluate(() => window.__savePrevented))) bad.push("⌘S was left to the browser (Save Page As)");
  const up = await page.evaluate(() => (window.__suiji.uploaded || []).filter((p) => p.endsWith("Week01.md")).length);
  if (!up) bad.push("⌘S did not save the document straight away");

  await page.keyboard.press("ControlOrMeta+e");
  await page.waitForTimeout(500);
  if (await editing()) bad.push("⌘E while editing did not go back to reading");
} finally {
  await app.close();
}
if (bad.length) { console.error("FAIL save-and-edit-keys\n  " + bad.join("\n  ")); process.exit(1); }
console.log("ok   save-and-edit-keys");
