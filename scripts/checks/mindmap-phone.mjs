// The mind map on a phone (Joey, 2026-11-23: 「手机的也做」).
// 1. On a narrow screen every branch sits right of the title (tall and narrow, not wide).
// 2. Two fingers pinch to zoom.
// 3. Full screen covers the whole screen and scrolls both ways; a [[link]] in it still opens the note.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const map = "---\nmindmap-plugin: basic\n---\n# 主题\n\n" + ["一", "二", "三", "四", "五"].map((x, i) =>
  `## 分支${x}\n` + [1, 2, 3].map((j) => `- ${i === 0 && j === 1 ? "[[Week02|第二周]]" : `要点 ${x}${j}`}`).join("\n")).join("\n") + "\n";
vault.tables.files.push({ id: "p1", name: "导图.md", folder: "Notes", path: "u1/Notes/导图.md", size: new TextEncoder().encode(map).length,
  mime: "text/markdown", created_at: "2026-11-23T00:00:00Z", updated_at: "2026-11-23T00:00:00Z", links: [], tags: [], local_key: null });
vault.blobs["u1/Notes/导图.md"] = map;

const app = await openApp({ vault, width: 390, height: 844 });
const { page } = app, bad = [];
const settled = () => page.waitForSelector(".mm:not([data-moving]) .mm-node", { timeout: 5000 });
try {
  await page.click("#listToggle, .list-toggle, [data-act=list]").catch(() => {});
  await app.openDoc("Notes/导图.md");
  await settled();
  const sides = await page.$$eval(".mm-node:not([hidden])", (e) => {
    const r = e.map((x) => x.getBoundingClientRect()), root = r[0];
    return { left: r.filter((b) => b.right <= root.left).length, right: r.filter((b) => b.left >= root.right).length };
  });
  if (sides.left || !sides.right) bad.push(`on a phone the branches should all be right of the title: ${JSON.stringify(sides)}`);

  const pct = () => page.textContent(".mm-pct");
  const before = await pct();
  await page.evaluate(() => {
    const v = document.querySelector(".mm-view"), r = v.getBoundingClientRect(), cy = r.top + 120;
    const touch = (id, x) => new Touch({ identifier: id, target: v, clientX: x, clientY: cy });
    const fire = (type, ts) => v.dispatchEvent(new TouchEvent(type, { touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true }));
    fire("touchstart", [touch(1, 150), touch(2, 210)]);
    fire("touchmove", [touch(1, 110), touch(2, 250)]);
    fire("touchend", []);
  });
  const after = await pct();
  if (parseInt(after) <= parseInt(before)) bad.push(`pinching out did not zoom in: ${before} → ${after}`);

  await page.click(".mm-full");
  await page.waitForTimeout(400);   // it opens with a short zoom-in
  const box = await page.$eval(".mm.full", (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, e.parentElement === document.body]; }).catch(() => null);
  if (!box || box[2] < 389 || box[3] < 843 || !box[4]) bad.push("full screen does not cover the screen: " + JSON.stringify(box));
  await page.click('.mm.full .mm-node a:text("第二周")');
  await page.waitForFunction(() => /Week02/.test(document.querySelector(".p-meta")?.textContent || ""), null, { timeout: 5000 })
    .catch(() => bad.push("a [[link]] clicked in full screen did not open the note"));
  if (await page.$(".mm.full")) bad.push("full screen stayed open after following a link");
  if (await page.evaluate(() => document.documentElement.classList.contains("mm-locked"))) bad.push("the page stayed locked after leaving full screen");
  if (app.errors.length) bad.push("errors: " + app.errors.join("; "));
} finally { await app.close(); }
if (bad.length) { console.log("the mind map on a phone is broken:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("the mind map works on a phone");
