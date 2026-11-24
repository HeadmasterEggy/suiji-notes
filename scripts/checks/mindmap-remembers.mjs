// A mind map opens the way it was left (Joey, 2026-11-24: 「我想让思维导图打开的时候也是上次的状态」).
// 1. Folded and unfolded branches, the zoom and where the map was scrolled to come back when the document is
//    opened again, after another document and after the app is reloaded.
// 2. A document switched to a map (or back to text) opens that way next time.
// Both on a desktop window and on a phone.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const map = "---\nmindmap-plugin: basic\n---\n# 主题\n\n" + ["一", "二", "三", "四", "五", "六"].map((x) =>
  `## 分支${x}\n` + [1, 2, 3].map((j) => `- 一个比较长的要点 ${x}${j}\n\t- 细节 ${x}${j}`).join("\n")).join("\n") + "\n";
const plain = "# 普通笔记\n\n## 一\n\n- a\n- b\n\n## 二\n\n正文。\n";
const vault = () => {
  const v = fixture(), now = "2026-11-24T00:00:00Z";
  for (const [id, name, body] of [["r1", "导图.md", map], ["r2", "普通.md", plain]]) {
    v.tables.files.push({ id, name, folder: "Notes", path: `u1/Notes/${name}`, size: new TextEncoder().encode(body).length,
      mime: "text/markdown", created_at: now, updated_at: now, links: [], tags: [], local_key: null });
    v.blobs[`u1/Notes/${name}`] = body;
  }
  return v;
};

const bad = [];
const SIZES = [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]];
for (const [label, size] of SIZES.filter(([l]) => !process.env.ONLY || l === process.env.ONLY)) {
  const app = await openApp({ vault: vault(), ...size });
  const { page } = app;
  const settled = () => page.waitForSelector(".md-body.mm-on .mm:not([data-moving]) .mm-node", { timeout: 8000 });
  const state = () => page.evaluate(() => {
    const v = document.querySelector(".md-body .mm-view"), pv = v.closest(".preview") || document.scrollingElement;
    const shown = [...document.querySelectorAll(".md-body .mm-node:not([hidden]) > .mm-text")].map((x) => x.textContent.trim());
    return { pct: document.querySelector(".md-body .mm-pct").textContent, x: v.scrollLeft, y: pv.scrollTop, shown: shown.join("|"),
      on: document.querySelector(".md-body").classList.contains("mm-on") };
  });
  const near = (a, b) => Math.abs(a - b) <= 3;
  // On a phone the list and the document take turns: back to the list before opening the next one.
  const open = async (path) => {
    // the list slides in, as the sidebar button does
    if (size.width < 700) { await page.evaluate(() => { document.querySelector(".app").dataset.view = "list"; }); await page.waitForTimeout(400); }
    await app.openDoc(path);
  };
  try {
    await page.click("#listToggle, .list-toggle, [data-act=list]").catch(() => {});
    await open("Notes/导图.md");
    await settled();
    await page.locator(".md-body .mm-node", { hasText: "分支二" }).first().locator(".mm-text").click();   // fold
    await page.locator(".md-body .mm-node", { hasText: "一个比较长的要点 一1" }).first().locator(".mm-text").click();   // fold
    await settled();
    await page.click(".md-body .mm-in"); await page.click(".md-body .mm-in");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const v = document.querySelector(".md-body .mm-view"), pv = v.closest(".preview") || document.scrollingElement;
      v.scrollLeft = 140; pv.scrollTop = 120;
    });
    await page.waitForTimeout(500);
    const want = await state();
    if (want.shown.includes("一个比较长的要点 二1") || want.shown.includes("细节 一1")) bad.push(`${label}: the folds did not take: ${want.shown}`);

    // The plain document switched to a map.
    await open("Notes/普通.md");
    await page.click(".md-body .md-mm-toggle");
    await settled();
    await page.waitForTimeout(400);

    const check = async (when) => {
      await open("Notes/导图.md");
      await settled();
      await page.waitForTimeout(300);
      const got = await state();
      if (got.shown !== want.shown) bad.push(`${label}, ${when}: other branches folded:\n    want ${want.shown}\n    got  ${got.shown}`);
      if (got.pct !== want.pct) bad.push(`${label}, ${when}: zoom ${got.pct}, want ${want.pct}`);
      if (!near(got.x, want.x) || !near(got.y, want.y)) bad.push(`${label}, ${when}: scrolled to ${got.x},${got.y}, want ${want.x},${want.y}`);
      await open("Notes/普通.md");
      await page.waitForTimeout(300);
      if (!(await page.evaluate(() => document.querySelector(".md-body").classList.contains("mm-on")))) bad.push(`${label}, ${when}: the document switched to a map opened as text`);
    };
    await check("opened again");
    if (app.errors.length) bad.push(`${label}: errors: ` + app.errors.join("; "));
    await page.reload();
    await page.waitForSelector(".tree-row", { timeout: 10000 });
    await page.click("#listToggle, .list-toggle, [data-act=list]").catch(() => {});
    await check("after a reload");
  } finally { await app.close({ allow: [/./] }); }   // a reload cuts off requests in flight; errors before it are checked above
}
if (bad.length) { console.log("the mind map does not open the way it was left:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("the mind map opens the way it was left");
