// An open document holds still while pictures sync in (Joey, 2026-11-16: 「加载图片的时候一直在刷新，很烦人」).
// Every file row the folder sync added used to redraw every open document from scratch (its drawing was keyed
// on the paths of the whole account), so a folder of pictures uploading one by one reloaded the page over and
// over. Now a document redraws only when what its own links and pictures point at changes, and a burst of
// changes is taken in one go.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
const now = "2026-11-16T00:00:00Z";
const body = "# 带图\n\n![](a.png)\n\n后面还有一张 ![[later.png]]\n";
const row = (id, name, mime, size) => ({ id, name, folder: "Notes", path: `u1/${id}`, size, mime, created_at: now, updated_at: now, links: [], tags: [], local_key: null });
vault.tables.files.push(row("d1", "带图.md", "text/markdown", new TextEncoder().encode(body).length), row("a.png", "a.png", "image/png", 3));
vault.blobs["u1/d1"] = body;

const app = await openApp({ vault, storage: { "suiji:open": JSON.stringify(["Notes"]) } });
const { page } = app, bad = [];
try {
  await page.locator('.tree-file[data-id="d1"]').click();
  await page.waitForSelector(".p-preview .md-body img", { state: "attached", timeout: 10000 });
  await page.evaluate(() => { document.querySelector(".p-preview .md-body").__mark = 1; });
  const same = () => page.evaluate(() => document.querySelector(".p-preview .md-body")?.__mark === 1);
  const arrive = (rows) => page.evaluate((rows) => { window.__suiji.tables.files.push(...rows); for (const fn of window.__suiji.realtime || []) fn({}); }, rows);

  // Pictures this document does not show arrive one by one, as the folder sync uploads them.
  for (let i = 0; i < 6; i++) { await arrive([row(`x${i}.png`, `pics/x${i}.png`, "image/png", 3)]); await page.waitForTimeout(250); }
  await page.waitForTimeout(2500);
  if (!(await same())) bad.push("pictures the document does not use redrew it (the page reloads while a folder syncs)");

  // The picture it was waiting for arrives: then it is drawn, once.
  await arrive([row("later.png", "later.png", "image/png", 3)]);
  await page.waitForFunction(() => document.querySelectorAll(".p-preview .md-body img").length === 2, null, { timeout: 8000 })
    .catch(() => bad.push("the picture the document was waiting for did not show up"));
} finally { await app.close({ allow: ["status of 404"] }); }   // the stub pictures have no bytes to serve
if (bad.length) { console.log("documents redraw while pictures sync:\n  " + bad.join("\n  ")); process.exit(1); }
