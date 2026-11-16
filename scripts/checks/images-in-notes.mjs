// Images in documents (Joey, 2026-11-16: 「现在图片不支持，修复一下」).
// 1. A document shows its pictures: ![](relative/path with space.png) beside it and ![[name.png|200]] found by
//    name, while the image files themselves stay out of the sidebar list.
// 2. Pasting a picture while editing a document saves it beside the document and writes ![](…) at the cursor,
//    and the preview then shows it.
import { openApp } from "../harness.mjs";
import { fixture } from "../fixtures/vault.mjs";

const vault = fixture();
vault.keepInserts = true;
const now = "2026-11-13T00:00:00Z";
const body = "# 带图\n\n第一张：\n\n![第一张](pics/a%20b.png)\n\n第二张 ![[b.png|200]]\n";
const row = (id, name, mime, size) => ({ id, name, folder: "Notes", path: `u1/${id}`, size, mime, created_at: now, updated_at: now, links: [], tags: [], local_key: null });
vault.tables.files.push(row("d1", "sub/带图.md", "text/markdown", new TextEncoder().encode(body).length),
  row("i1.png", "sub/pics/a b.png", "image/png", 3), row("i2.png", "b.png", "image/png", 3));
vault.blobs["u1/d1"] = body;

const app = await openApp({ vault, storage: { "suiji:open": JSON.stringify(["Notes", "Notes/sub"]) } });
const { page } = app, bad = [];
const srcs = () => page.$$eval(".p-preview .md-body img", (xs) => xs.map((x) => [x.getAttribute("src"), x.getAttribute("width")]));
try {
  if (await page.locator('.tree-file[data-id="i1.png"], .tree-file[data-id="i2.png"]').count()) bad.push("image files show in the sidebar list");
  await page.locator('.tree-file[data-id="d1"]').click();
  await page.waitForSelector(".p-preview .md-body p", { timeout: 10000 });
  let got = await srcs();
  if (!/__blob\/u1\/i1\.png/.test(got[0]?.[0] || "")) bad.push("![](pics/a%20b.png) does not show the picture: " + JSON.stringify(got));
  if (!/__blob\/u1\/i2\.png/.test(got[1]?.[0] || "") || got[1]?.[1] !== "200") bad.push("![[b.png|200]] does not show the picture 200 wide: " + JSON.stringify(got));
  if (await page.locator(".p-preview .md-missing").count()) bad.push("a picture shows as missing: " + await page.textContent(".p-preview .md-missing"));

  await page.click(".p-edit");
  await page.waitForSelector(".p-ta:not([hidden])");
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll(".p-ta")].find((x) => !x.hidden);
    ta.focus(); ta.setSelectionRange(ta.value.indexOf("第二张"), ta.value.indexOf("第二张"));
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" }));
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => /!\[\]\(Pasted%20image%20\d{14}\.png\)/.test([...document.querySelectorAll(".p-ta")].find((x) => !x.hidden)?.value || ""), null, { timeout: 5000 })
    .catch(() => bad.push("pasting a picture did not write ![](Pasted%20image ….png) into the document"));
  const text = await page.evaluate(() => [...document.querySelectorAll(".p-ta")].find((x) => !x.hidden).value);
  if (!/\n\n!\[\]\(Pasted%20image%20\d+\.png\)\n第二张/.test(text)) bad.push("the link was not put on its own line at the cursor: " + JSON.stringify(text));
  const ins = await page.evaluate(() => (window.__suiji.written || []).filter((w) => w.table === "files").map((w) => w.row));
  if (ins.length !== 1 || !/^sub\/Pasted image \d{14}\.png$/.test(ins[0].name) || ins[0].folder !== "Notes" || ins[0].mime !== "image/png")
    bad.push("the pasted picture was not saved beside the document: " + JSON.stringify(ins));
  if (!(await page.evaluate(() => (window.__suiji.uploaded || []).some((p) => /\.png$/.test(p))))) bad.push("the pasted picture's bytes were not uploaded");

  await page.waitForTimeout(1500);   // the edit saves itself
  await page.click(".p-edit");       // 完成
  await page.waitForFunction(() => document.querySelectorAll(".p-preview .md-body img").length === 3, null, { timeout: 8000 })
    .catch(async () => bad.push("the preview does not show the pasted picture: " + JSON.stringify(await srcs())));
} finally { await app.close({ allow: ["status of 404"] }); }   // the stub pictures have no bytes to serve
if (bad.length) { console.log("images in documents are broken:\n  " + bad.join("\n  ")); process.exit(1); }
