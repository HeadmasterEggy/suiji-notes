// The sidebar from the keyboard, as in Finder's list: → opens a folder and then steps into it, ← closes it or
// goes up from a row to its folder, Home / End jump to the ends. Before, only ↑ / ↓ did anything.
import { openApp } from "../harness.mjs";

const app = await openApp({ storage: { "suiji:open": "[]" } });
const { page } = app, bad = [];
const at = () => page.evaluate(() => document.activeElement.querySelector?.(".tree-name")?.textContent || document.activeElement.id);
const open = (name) => page.locator(".tree-folder", { hasText: name }).getAttribute("aria-expanded");
try {
  await page.focus("#search");
  await page.keyboard.press("ArrowDown");
  if ((await at()) !== "COMP5318") bad.push(`↓ from search should reach the first folder, at ${await at()}`);
  await page.keyboard.press("ArrowRight");
  if ((await open("COMP5318")) !== "true") bad.push("→ on a closed folder did not open it");
  if ((await at()) !== "COMP5318") bad.push(`→ opening a folder should stay on it, at ${await at()}`);
  await page.keyboard.press("ArrowRight");
  if ((await at()) !== "Week01.md") bad.push(`→ on an open folder should go to its first row, at ${await at()}`);
  await page.keyboard.press("ArrowLeft");
  if ((await at()) !== "COMP5318") bad.push(`← on a file should go up to its folder, at ${await at()}`);
  await page.keyboard.press("ArrowLeft");
  if ((await open("COMP5318")) !== "false") bad.push("← on an open folder did not close it");
  await page.keyboard.press("End");
  if ((await at()) !== "Notes") bad.push(`End should go to the last row, at ${await at()}`);
  await page.keyboard.press("Home");
  if ((await at()) !== "COMP5318") bad.push(`Home should go to the first row, at ${await at()}`);
} finally {
  await app.close();
}
if (bad.length) { console.error("FAIL tree-arrow-keys\n  " + bad.join("\n  ")); process.exit(1); }
console.log("ok   tree-arrow-keys");
