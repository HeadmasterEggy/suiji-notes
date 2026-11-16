// Images in a synced folder reach the cloud (Joey, 2026-11-16: 「现在图片不支持，修复一下」).
// The folder sync used to upload only Markdown, so a document's ![](pic.png) or ![[pic.png]] found no picture
// and showed [图片：pic.png]. Images are synced now (not listed in the app); other files still are not, and an
// image deleted on disk is deleted in the cloud.
import { syncEngine } from "../../public/syncengine.js";

const disk = new Map([["a.md", "# A\n\n![](img/pic.png)\n"], ["img/pic.png", "PNG"], ["shot.JPG", "JPG"], ["notes.pdf", "PDF"]]);
const ROOT = "/Users/test/Notes";
const fs = {
  walk: async () => [...disk].map(([rel, b]) => ({ rel, size: b.length, mtimeMs: 1 })),
  stat: async (p) => p === ROOT ? { size: 0, mtimeMs: 1 } : disk.has(p.slice(ROOT.length + 1)) ? { size: 1, mtimeMs: 1 } : null,
  read: async (p) => new TextEncoder().encode(disk.get(p.slice(ROOT.length + 1))),
  readText: async () => null,
  write: async () => {},
};
const uploaded = [], rows = [], removed = [];
const q = (table) => {
  const self = {
    select: () => self, not: () => self, range: async () => ({ data: [], error: null }), eq: async () => ({ error: null }),
    update: () => self, delete: () => self,
    upsert: async (row) => { rows.push({ table, ...row }); return { error: null }; },
  };
  return self;
};
const sb = {
  from: q,
  storage: { from: () => ({ upload: async (p, _b, o) => { uploaded.push([p, o.contentType]); return { error: null }; }, remove: async (ps) => { removed.push(...ps); return { error: null }; } }) },
  auth: { updateUser: async () => ({ error: null }) },
};
const { syncAll } = syncEngine({ sb, fs, log: () => {} });
const user = { id: "u1", user_metadata: {} }, state = {}, bad = [];

await syncAll(user, [ROOT], state);
const names = rows.map((r) => r.name).sort();
if (names.join() !== ["a.md", "img/pic.png", "shot.JPG"].join()) bad.push("synced files: want a.md, img/pic.png, shot.JPG, got " + names.join(", "));
const pic = rows.find((r) => r.name === "img/pic.png");
if (pic && (pic.mime !== "image/png" || pic.folder !== "Notes")) bad.push("the image row is wrong: " + JSON.stringify(pic));
if (uploaded.find(([p]) => p.endsWith(".jpg"))?.[1] !== "image/jpeg") bad.push("shot.JPG was not stored as image/jpeg: " + JSON.stringify(uploaded));

disk.delete("img/pic.png");
await syncAll(user, [ROOT], state);
if (!removed.some((p) => p === pic?.path)) bad.push("an image deleted on disk kept its cloud copy");

if (bad.length) { console.log("images in synced folders are broken:\n  " + bad.join("\n  ")); process.exit(1); }
