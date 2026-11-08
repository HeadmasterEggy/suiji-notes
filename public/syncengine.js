// Folder sync, shared by the Mac app (public/localsync.js) and the Node agent (agent/suiji-sync.mjs).
// New and changed files are uploaded; files deleted locally are deleted in the cloud. Files edited elsewhere
// (e.g. on the phone) are written back to disk; if both sides changed, the cloud version is saved beside the
// local file as 「名字（随记副本）」.
//
// `fs` is the caller's file access, all async, paths absolute with "/":
//   walk(root) -> [{ rel, size, mtimeMs }]   regular files only; skips hidden names, node_modules, .git, *~
//                                            a folder it could not read is listed as { rel, unreadable: true }
//                                            (rel "" for the root), so its files are not taken as deleted
//   stat(path) -> { size, mtimeMs } | null    mtimeMs rounded to whole milliseconds
//   read(path) -> Uint8Array
//   readText(path) -> string | null
//   write(path, bytes)                        replaces the file atomically, creating folders as needed
// State maps "<root>::<rel>" to what was last synced; it is the same file (~/.suiji/state.json) for both callers.
import { mdMeta } from "./mdmeta.js";

export const MAX_FILE = 50 * 1024 * 1024;
const MIME = { txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", html: "text/html", py: "text/plain", js: "text/plain", ts: "text/plain" };
const extOf = (n) => (/\.([a-z0-9]{1,6})$/i.exec(n)?.[1] || "").toLowerCase();
const isMd = (n) => ["md", "markdown"].includes(extOf(n));
const metaOf = (rel, bytes) => isMd(rel) ? mdMeta(new TextDecoder().decode(bytes)) : { links: [], tags: [] };
const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
export const keyOf = (root, rel) => root + "::" + rel;

// Stable ids so a re-upload replaces the same cloud file instead of adding a copy.
async function idFor(uid, key) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid + "\0" + key));
  const h = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function syncEngine({ sb, fs, log }) {
  // changed: keys whose local file or cloud copy this pass wrote, so an open window can redraw them.
  async function syncFolder(uid, root, state, changed) {
    const folder = baseName(root);
    if (!await fs.stat(root)) { log("文件夹不存在，跳过：", root); return; }
    const seen = new Set(), listing = await fs.walk(root);
    let up = 0, del = 0;
    // A folder macOS would not let us read lists nothing, which looks the same as every file in it being
    // deleted. Its cloud copies stay until it can be read again. A whole synced folder that lists no file at
    // all is taken the same way: emptying it on purpose is rare, and 设置 → 本地文件夹 can remove it instead.
    const unreadable = listing.filter((f) => f.unreadable).map((f) => f.rel);
    for (const rel of unreadable) log("读不了这个文件夹，先不动它的云端文件：", rel ? folder + "/" + rel : root);
    const synced = Object.keys(state).filter((k) => k.startsWith(root + "::") && state[k].path).length;
    if (!listing.length && synced) { log(`「${folder}」里一个文件都没读到，为了安全没有删除云端的 ${synced} 个文件`); unreadable.push(""); }
    const keep = (rel) => unreadable.some((u) => u === "" || rel.startsWith(u + "/"));
    // Only Markdown documents are synced. Other files are not read; ones synced earlier keep their cloud
    // copy (hidden by the app) rather than being deleted as if they were gone from disk.
    for (const f of listing.filter((f) => !f.unreadable && isMd(f.rel))) {
      const key = keyOf(root, f.rel), abs = root + "/" + f.rel;
      seen.add(key);
      const prev = state[key];
      if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) {
        // Files synced before the graph existed: fill in their links and tags once, without re-uploading.
        if (!prev.meta && prev.id && isMd(f.rel)) {
          const r = await sb.from("files").update(metaOf(f.rel, await fs.read(abs))).eq("id", prev.id);
          if (r.error) log("更新链接失败", f.rel, r.error.message); else prev.meta = 1;
        }
        continue;
      }
      if (f.size > MAX_FILE) { if (!prev?.tooBig) log("超过 50 MB，没有上传：", f.rel); state[key] = { ...f, tooBig: true }; continue; }
      const id = await idFor(uid, key), ext = extOf(f.rel);
      const objPath = `${uid}/${id}${ext ? "." + ext : ""}`;
      const mime = MIME[ext] || "application/octet-stream";
      try {
        const body = await fs.read(abs);
        const r1 = await sb.storage.from("files").upload(objPath, body, { contentType: mime, upsert: true, cacheControl: "0" });
        if (r1.error) throw r1.error;
        const now = new Date().toISOString();
        const r2 = await sb.from("files").upsert(
          { id, user_id: uid, name: f.rel, folder, path: objPath, size: f.size, mime, local_key: key, updated_at: now, ...metaOf(f.rel, body), ...(prev ? {} : { created_at: now }) },
          { onConflict: "id" });
        if (r2.error) throw r2.error;
        state[key] = { size: f.size, mtimeMs: f.mtimeMs, id, path: objPath, cloudAt: now, meta: 1 };
        changed.add(key); up++;
        log("已上传", folder + "/" + f.rel);
      } catch (e) {
        log("上传失败", f.rel, e.message || e);
      }
    }
    for (const [key, v] of Object.entries(state)) {
      if (!key.startsWith(root + "::") || seen.has(key) || !isMd(key.slice(root.length + 2)) || keep(key.slice(root.length + 2))) continue;
      if (v.path) {
        const r1 = await sb.storage.from("files").remove([v.path]);
        const r2 = await sb.from("files").delete().eq("id", v.id);
        if (r1.error || r2.error) { log("云端删除失败", key.split("::")[1], (r1.error || r2.error).message); continue; }
        log("本地已删除，云端同步删除", folder + "/" + key.split("::")[1]);
        changed.add(key); del++;
      }
      delete state[key];
    }
    if (up || del) log(`「${folder}」上传 ${up} 个，删除 ${del} 个`);
  }

  // Storage reads can be served from a cache for a moment after an upload, so fetch through a fresh signed URL.
  async function fetchObject(objPath) {
    const s = await sb.storage.from("files").createSignedUrl(objPath, 60);
    if (s.error) throw s.error;
    const r = await fetch(s.data.signedUrl + "&t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  // Cloud rows of synced folders. updated_at is set by whoever wrote last: the sync records the value it
  // wrote (cloudAt), so a row whose updated_at differs was edited somewhere else, e.g. in the app on the phone.
  async function cloudRows() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("files").select("id,path,size,updated_at,local_key").not("local_key", "is", null).range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  // Returns true when something should be retried shortly (the download did not match the database yet).
  async function pullFolder(root, state, rows, changed) {
    const folder = baseName(root);
    let retry = false;
    if (!await fs.stat(root)) return retry;
    for (const row of rows) {
      const key = row.local_key, prev = state[key];
      if (!key.startsWith(root + "::") || !prev?.path || !isMd(key)) continue;
      if (!prev.cloudAt) { prev.cloudAt = row.updated_at; continue; }   // first run after upgrading: take the cloud as baseline
      if (Date.parse(row.updated_at) === Date.parse(prev.cloudAt)) continue;
      const rel = key.slice(root.length + 2), abs = root + "/" + rel;
      let buf;
      try { buf = await fetchObject(row.path); } catch (e) { log("下载失败", rel, e.message || e); retry = true; continue; }
      if (buf.length !== row.size) { retry = true; continue; }   // still the old copy; try again in a moment
      const st = await fs.stat(abs);
      if (st && (st.size !== prev.size || st.mtimeMs !== prev.mtimeMs)) {
        // Changed on both sides: keep the local file (the scan uploads it) and save the cloud version beside it.
        const dot = abs.lastIndexOf("."), ext = dot > abs.lastIndexOf("/") ? abs.slice(dot) : "";
        const copy = abs.slice(0, abs.length - ext.length) + "（随记副本）" + ext;
        try { await fs.write(copy, buf); } catch (e) { log("写不进磁盘", folder + "/" + copy.slice(root.length + 1), e.message || e); continue; }
        prev.cloudAt = row.updated_at;
        log("两边都改了，云端版本另存为", folder + "/" + copy.slice(root.length + 1));
        continue;
      }
      // One file that cannot be written (no permission, a full disk) is skipped, not the whole pass.
      try { await fs.write(abs, buf); } catch (e) { log("写不进磁盘", folder + "/" + rel, e.message || e); continue; }
      const now = await fs.stat(abs);
      state[key] = { ...prev, size: now.size, mtimeMs: now.mtimeMs, cloudAt: row.updated_at };
      changed.add(key);
      log("已写回手机上的修改", folder + "/" + rel);
    }
    return retry;
  }

  // A synced Hexo `_posts` folder: the blog's skip_render keeps some of its subfolders unpublished. The app
  // gives those no blog link; the list is kept in the account (user metadata), never in the app's code.
  async function hexoUnpublished(root) {
    if (baseName(root) !== "_posts") return null;
    const src = await fs.readText(root.split("/").slice(0, -2).join("/") + "/_config.yml");
    if (src == null) return null;
    const out = [];
    let inSkip = false;
    for (const line of src.split("\n")) {
      if (/^skip_render:/.test(line)) { inSkip = true; continue; }
      if (inSkip && /^\S/.test(line)) break;
      const m = inSkip && /^\s*-\s*["']?_posts\/([^/*"']+)\//.exec(line);
      if (m && !out.includes(m[1] + "/")) out.push(m[1] + "/");
    }
    return out;
  }
  async function shareUnpublished(user, folders) {
    const skip = [...new Set((await Promise.all(folders.map(hexoUnpublished))).flatMap((s) => s || []))].sort();
    const had = user.user_metadata?.blog_skip || [];
    if (JSON.stringify(had) === JSON.stringify(skip)) return;
    const { error } = await sb.auth.updateUser({ data: { blog_skip: skip } });
    if (error) log("没能保存博客未发布的文件夹：", error.message); else log("已更新博客未发布的文件夹：", skip.length, "个");
  }

  // One full pass over every folder; updates state in place. Returns { retry, changed }.
  async function syncAll(user, folders, state) {
    await shareUnpublished(user, folders);
    const rows = await cloudRows();
    const changed = new Set();
    let retry = false;
    for (const root of folders) {
      if (await pullFolder(root, state, rows, changed)) retry = true;
      await syncFolder(user.id, root, state, changed);
    }
    return { retry, changed };
  }

  return { syncAll };
}
