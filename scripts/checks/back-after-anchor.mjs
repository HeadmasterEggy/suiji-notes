// A link to a heading in the same document (an [anchor](#表格) or [[#heading]]) is a step Back can undo, as in a
// browser. Before, the jump wasn't recorded: Back stayed greyed out, or went to the document before this one.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const { page } = app, bad = [];
const press = (sel) => page.click(sel, { timeout: 3000 }).catch(() => bad.push(`${sel} was not clickable`));
const top = () => page.locator(".p-preview").evaluate((el) => Math.round(el.scrollTop));
try {
  await app.openDoc("COMP5318/Week02.md");
  await page.click(".md-body a:has-text('Week01')");
  await page.waitForFunction(() => /Week01/.test(document.querySelector(".p-meta")?.textContent || ""));
  await page.waitForTimeout(400);
  await page.click(".md-body a:has-text('anchor')");
  await page.waitForTimeout(1200);
  const jumped = await top();
  if (jumped < 100) bad.push(`the anchor link did not scroll to its heading (scrollTop ${jumped})`);
  await press(".p-prev");
  await page.waitForTimeout(1200);
  const meta = await page.textContent(".p-meta");
  if (!/Week01/.test(meta)) bad.push(`Back after an in-document jump left the document: ${meta}`);
  else if ((await top()) > 20) bad.push(`Back did not return to where the link was clicked (scrollTop ${await top()})`);
  await press(".p-next");
  await page.waitForTimeout(1200);
  if (Math.abs((await top()) - jumped) > 20) bad.push(`Forward did not return to the heading (scrollTop ${await top()}, want ${jumped})`);
  await press(".p-prev"); await page.waitForTimeout(600);
  await press(".p-prev"); await page.waitForTimeout(1000);
  if (!/Week02/.test(await page.textContent(".p-meta"))) bad.push("a second Back did not reach the document before");
} finally {
  await app.close();
}
if (bad.length) { console.error("FAIL back-after-anchor\n  " + bad.join("\n  ")); process.exit(1); }
console.log("ok   back-after-anchor");
