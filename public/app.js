// 随记: offline-first notes. Edits land in localStorage first, then sync to Supabase;
// other devices get them through Supabase Realtime. Conflicts: the newer updated_at wins.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { mdMeta } from "./mdmeta.js";
import { mountGraph } from "./graph.js";
import { t, lang, langChoice, translatePage } from "./i18n.js";
import * as local from "./localsync.js";
import { mountAgent, toggleAgent, resetAgent, localModel, setLocalModel, localHttp, refreshMagpie, askAgent } from "./agent.js";
import { mountMenu } from "./ctxmenu.js";

translatePage();

const $ = (id) => document.getElementById(id);
const app = $("app"), list = $("list"), search = $("search");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- styles ----------
// Glass (no attribute) follows the system; the others set their own colours and color-scheme.
const PIXEL_FONTS = "https://fonts.googleapis.com/css2?family=DotGothic16&family=Pixelify+Sans:wght@400;600&display=swap";
const isDark = () => getComputedStyle(document.documentElement).colorScheme.includes("dark");
function applyStyle(name, save) {
  if (name) document.documentElement.dataset.style = name; else delete document.documentElement.dataset.style;
  if (name === "blocks" && !document.getElementById("pixelFonts")) {
    document.head.append(Object.assign(document.createElement("link"), { id: "pixelFonts", rel: "stylesheet", href: PIXEL_FONTS }));
  }
  if (save) try { name ? localStorage.setItem("suiji:style", name) : localStorage.removeItem("suiji:style"); } catch {}
  for (const b of $("styleChoices").querySelectorAll("[data-style]")) b.setAttribute("aria-checked", String(b.dataset.style === (name || "")));
  // The tab icon follows the style; in the Mac app the Dock icon does too. iPhone keeps the Home Screen icon
  // it was added with, so adding the app after picking a style gives that style's icon.
  document.querySelector('link[rel="icon"]').href = name ? `icon-${name}.svg` : "icon.svg";
  document.querySelector('link[rel="apple-touch-icon"]').href = name ? `icon-${name}-180.png` : "icon-180.png";
  window.webkit?.messageHandlers?.suiji?.postMessage({ style: name || "", lang });
  paintBar();
}
// The browser and status bar take the page's background.
function paintBar() {
  const bar = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = bar;
  // The Android app colours its system bars to match and switches its launcher icon to the style.
  window.suijiAndroid?.post(JSON.stringify({ style: document.documentElement.dataset.style || "", bg: bar, dark: isDark() }));
}
applyStyle(document.documentElement.dataset.style || "");
// Light / dark: data-mode on the root is always "light" or "dark", which every style reads. The choice is
// saved as "suiji:mode"; without one it follows the system, live. The head script sets it before first paint.
let modeChoice = "";
try { const m = localStorage.getItem("suiji:mode"); if (m === "light" || m === "dark") modeChoice = m; } catch {}
const systemDark = matchMedia("(prefers-color-scheme: dark)");
function applyMode(choice, save) {
  modeChoice = choice;
  document.documentElement.dataset.mode = choice || (systemDark.matches ? "dark" : "light");
  if (save) try { choice ? localStorage.setItem("suiji:mode", choice) : localStorage.removeItem("suiji:mode"); } catch {}
  for (const b of $("modeChoices").querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === choice));
  paintBar();
}
applyMode(modeChoice);
systemDark.addEventListener("change", () => { if (!modeChoice) { applyMode(""); restyled(); } });
// Text size of documents and the note editor: --doc-size on the root, saved as "suiji:font".
const FONT_DEFAULT = 16;
const fontSize = () => parseFloat(document.documentElement.style.getPropertyValue("--doc-size")) || FONT_DEFAULT;
function applyFont(px, save) {
  if (px === FONT_DEFAULT) document.documentElement.style.removeProperty("--doc-size");
  else document.documentElement.style.setProperty("--doc-size", px + "px");
  if (save) try { px === FONT_DEFAULT ? localStorage.removeItem("suiji:font") : localStorage.setItem("suiji:font", String(px)); } catch {}
  for (const b of $("fontChoices").querySelectorAll("[data-size]")) b.setAttribute("aria-checked", String(+b.dataset.size === px));
}
applyFont(fontSize());

// ---------- updates ----------
// Every deploy changes the cache name in sw.js. Open windows (the Mac app, a PWA left open) check it every
// 10 minutes and whenever they come back to the front. A window in the background with nothing being edited
// reloads by itself; otherwise a button offers the reload.
const swVersion = () => fetch("sw.js?v=" + Date.now(), { cache: "no-store" }).then((r) => r.text())
  .then((t) => /CACHE = "([^"]+)"/.exec(t)?.[1] || null).catch(() => null);
const loadedVersion = swVersion();
async function checkUpdate() {
  if (!navigator.onLine) return;
  const [was, now] = await Promise.all([loadedVersion, swVersion()]);
  if (!was || !now || was === now) return;
  const busy = [...panes.values()].some((p) => p.editing || p.fileEdit || p.saving);
  if (document.hidden && !busy) return location.reload();
  $("updateToast").hidden = false;
}
$("updateToast").onclick = async () => {
  commitAll();
  await Promise.all([...panes.values()].map((p) => p.saving));
  location.reload();
};
setInterval(checkUpdate, 10 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  $("setup").hidden = false;
  throw new Error("Supabase is not configured");
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------- local store ----------
let uid = null;
let store = { notes: {} };   // id -> {id, body, created_at, updated_at, deleted, dirty}
const storeKey = () => "suiji:" + uid;
function load() {
  try { store = JSON.parse(localStorage.getItem(storeKey())) || { notes: {} }; }
  catch { store = { notes: {} }; }
}
function persist() {
  try { localStorage.setItem(storeKey(), JSON.stringify(store)); }
  catch { showNote(t("本机存储已满，最新改动可能只在内存里，请保持联网让它同步。"), "err"); }
}
const visible = () => Object.values(store.notes).filter((n) => !n.deleted)
  .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

// Remote row wins only if it is newer than what this device has.
function merge(row) {
  const local = store.notes[row.id];
  if (local && local.updated_at >= row.updated_at) return false;
  store.notes[row.id] = { id: row.id, body: row.body, created_at: row.created_at, updated_at: row.updated_at, deleted: row.deleted, dirty: false };
  return true;
}

// ---------- sync ----------
let syncing = false, again = false, channel = null;
function setSync(state, text) { $("sync").dataset.s = state; $("syncText").textContent = text; }
function showNote(text, kind) { const n = $("note"); n.hidden = !text; n.textContent = text || ""; n.dataset.kind = kind || ""; }

async function sync() {
  if (!uid) return;
  if (!navigator.onLine) { setSync("err", t("离线 · 已存在本机")); return; }
  if (syncing) { again = true; return; }
  syncing = true; setSync("saving", t("同步中…"));
  try {
    const dirty = Object.values(store.notes).filter((n) => n.dirty);
    if (dirty.length) {
      const rows = dirty.map(({ id, body, created_at, updated_at, deleted }) => ({ id, user_id: uid, body, created_at, updated_at, deleted }));
      const { error } = await sb.from("notes").upsert(rows);
      if (error) throw error;
      for (const d of dirty) {
        const cur = store.notes[d.id];
        if (cur && cur.updated_at === d.updated_at) cur.dirty = false;
      }
    }
    const { data, error } = await sb.from("notes").select("id,body,created_at,updated_at,deleted").limit(5000);
    if (error) throw error;
    let changed = false;
    for (const row of data) changed = merge(row) || changed;
    persist();
    if (changed) render();
    else renderList();
    setSync("ok", t("已同步"));
    showNote(filesErr ? t("没能载入文件列表，几秒后会自动重试。") : "", "err");
  } catch (e) {
    console.error(e);
    setSync("err", t("同步失败"));
    showNote(t("没能同步到云端，改动已保存在本机，联网后会自动重试。"), "err");
  } finally {
    syncing = false;
    if (again) { again = false; sync(); }
  }
}

let syncTimer = null;
function scheduleSync(ms = 800) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }

function subscribe() {
  channel = sb.channel("sync-" + uid)
    .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: "user_id=eq." + uid }, (p) => {
      if (p.new && p.new.id && merge(p.new)) { persist(); render(); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "files", filter: "user_id=eq." + uid }, () => loadFiles())
    .subscribe();
}

// ---------- files ----------
// File bytes live in the private "files" bucket at <uid>/<id>.<ext>; the files table keeps the real name.
const MAX_FILE = 50 * 1024 * 1024;
let files = [], filesLoaded = false, filesErr = false, filesRetry = null;
const isImage = (f) => f.mime.startsWith("image/");
const extOf = (name) => { const m = /\.([a-z0-9]{1,6})$/i.exec(name); return m ? m[1].toLowerCase() : ""; };
function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

async function loadFiles() {
  if (!uid || !navigator.onLine) return;
  clearTimeout(filesRetry);
  let data, error;
  try { ({ data, error } = await sb.from("files").select("id,name,folder,path,size,mime,created_at,updated_at,links,tags,local_key").order("updated_at", { ascending: false }).limit(5000)); }
  catch (e) { error = e; }
  if (error) {
    console.error(error);
    // With no list yet, say so instead of loading forever, and try again shortly.
    if (!filesLoaded) {
      filesErr = true; renderList();
      showNote(t("没能载入文件列表，几秒后会自动重试。"), "err");
      filesRetry = setTimeout(loadFiles, 5000);
    }
    return;
  }
  if (filesErr) { filesErr = false; showNote(""); }
  const before = new Map(files.map((f) => [f.id, versionOf(f)]));
  for (const f of data) if (before.has(f.id) && before.get(f.id) !== versionOf(f)) forgetUrls(f.path);
  files = data; filesLoaded = true;
  render();
  schedulePrefetch();
}

// Folder name and path inside it. Files picked from a folder carry webkitRelativePath "Folder/sub/a.txt".
function placeOf(file) {
  const rel = file.webkitRelativePath || "";
  const i = rel.indexOf("/");
  return i > 0 ? { folder: rel.slice(0, i), name: rel.slice(i + 1) } : { folder: "", name: file.name || t("未命名") };
}
const baseName = (n) => n.split("/").pop();

let uploading = 0;
async function uploadFiles(input) {
  if (!uid) return;
  const all = [...input].filter((f) => !baseName(f.webkitRelativePath || f.name).startsWith("."));
  const tooBig = all.filter((f) => f.size > MAX_FILE);
  if (tooBig.length) showNote(t("{names} 超过 50 MB，没有上传。", { names: tooBig.map((f) => f.name).join(lang === "en" ? ", " : "、") }), "err");
  const ok = all.filter((f) => f.size <= MAX_FILE);
  uploading += ok.length;
  for (const file of ok) {
    setSync("saving", t("上传中 · 剩 {n} 个", { n: uploading }));
    const id = crypto.randomUUID(), ext = extOf(file.name);
    const path = `${uid}/${id}${ext ? "." + ext : ""}`;
    const mime = file.type || "application/octet-stream";
    const { folder, name } = placeOf(file);
    try {
      const up = await sb.storage.from("files").upload(path, file, { contentType: mime });
      if (up.error) throw up.error;
      const ins = await sb.from("files").insert({ id, user_id: uid, name, folder, path, size: file.size, mime });
      if (ins.error) { await sb.storage.from("files").remove([path]); throw ins.error; }
    } catch (e) {
      console.error(e);
      showNote(t("「{name}」上传失败：{msg}。", { name: file.name, msg: e.message || t("网络问题") }), "err");
    } finally {
      uploading--;
    }
  }
  setSync("ok", t("已同步"));
  await loadFiles();
}


// ---------- file content cache ----------
// Opening a document used to cost two signed-URL requests plus a download every time. Signed URLs are
// reused until shortly before they expire, and text files are kept in Cache Storage keyed by
// id@updated_at, so a document opens instantly the second time (offline too) and refreshes when it changes.
const signed = new Map();   // "path|download" -> { url, exp }
async function signedUrls(paths, download) {
  const now = Date.now(), out = new Map(), need = [];
  for (const p of paths) {
    const hit = signed.get(p + "|" + (download || ""));
    if (hit && hit.exp > now) out.set(p, hit.url); else need.push(p);
  }
  if (need.length) {
    const res = download
      ? await Promise.all(need.map((p) => sb.storage.from("files").createSignedUrl(p, 3600, { download }).then((r) => ({ path: p, signedUrl: r.data?.signedUrl }))))
      : (await sb.storage.from("files").createSignedUrls(need, 3600)).data || [];
    for (const r of res) if (r.signedUrl) { out.set(r.path, r.signedUrl); signed.set(r.path + "|" + (download || ""), { url: r.signedUrl, exp: now + 50 * 60 * 1000 }); }
  }
  return out;
}
const signedUrl = async (f) => (await signedUrls([f.path])).get(f.path);
// A URL signed before an upload can keep serving the old copy for half a minute or more, even with a
// cache-buster; one signed afterwards is current. So a file's URLs are dropped whenever its version changes.
function forgetUrls(path) { for (const k of signed.keys()) if (k.startsWith(path + "|")) signed.delete(k); }

const FILE_CACHE = "suiji-files-2";   // renamed when old entries must not be trusted
// In milliseconds: the database and this app write the same time in different formats (+00:00 vs Z).
const versionOf = (f) => f.id + "@" + Date.parse(f.updated_at || f.created_at);
const cacheReq = (f) => new Request(new URL("__files/" + encodeURIComponent(versionOf(f)), location.href));
// id -> cached request for that file, built once from the cache, so replacing a version is cheap.
let cacheIndex = null;
function loadCacheIndex(store) {
  return cacheIndex ||= store.keys().then((ks) => {
    const m = new Map();
    for (const k of ks) m.set(decodeURIComponent(k.url.split("__files/")[1] || "").split("@")[0], k);
    return m;
  }).catch(() => new Map());
}
const inflight = new Map();   // version -> Promise<text>
const bodies = new Map();     // id -> lowercased text of every text file read so far, for search
function fileText(f) {
  const v = versionOf(f);
  if (!inflight.has(v)) inflight.set(v, readText(f).then((text) => { bodies.set(f.id, text.toLowerCase()); return text; }).finally(() => inflight.delete(v)));
  return inflight.get(v);
}
// Search also looks inside text files: the first search reads every one this device already has (cached
// copies, the Mac app's files on disk) without downloading anything, then shows the results again.
let warming = null;
function warmBodies() {
  return warming ||= (async () => {
    let index = new Map();
    try { index = await loadCacheIndex(await caches.open(FILE_CACHE)); } catch {}
    for (const f of files) {
      if (!isTextish(f) || bodies.has(f.id)) continue;
      const cached = index.get(f.id)?.url.endsWith("__files/" + encodeURIComponent(versionOf(f)));
      if (cached || local.localPath(f)) await fileText(f).catch(() => {});
    }
  })().finally(() => { if (search.value.trim()) renderList(); });
}
// Storage can serve the previous copy for a moment after an upload, so reads bypass caches and must match
// the size in the row; a mismatched read is retried and never cached under the new version. If it is still
// the old copy after that, the id goes in staleIds and the pane tries again a little later.
const staleIds = new Set(), retried = new Set();   // retried: versions already given their one extra try
async function readText(f) {
  if (local.localPath(f)) return local.readLocal(f);   // Mac app: the file on disk
  try { const hit = await (await caches.open(FILE_CACHE)).match(cacheReq(f)); if (hit) return await hit.text(); } catch {}
  const url = await signedUrl(f);
  if (!url) throw new Error("no url");
  let text;
  for (let i = 0; i < 5; i++) {
    if (i) await new Promise((r) => setTimeout(r, 800 * i));
    const r = await fetch(url + "&t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const buf = await r.arrayBuffer();
    text = new TextDecoder().decode(buf);
    if (buf.byteLength === f.size) { await cacheText(f, text); staleIds.delete(f.id); return text; }
  }
  staleIds.add(f.id);
  return text;
}
async function cacheText(f, text) {
  try {
    const store = await caches.open(FILE_CACHE);
    const index = await loadCacheIndex(store), old = index.get(f.id);
    if (old) await store.delete(old);
    const req = cacheReq(f);
    await store.put(req, new Response(text, { headers: { "content-type": "text/plain;charset=utf-8" } }));
    index.set(f.id, req);
  } catch {}
}
const isTextish = (f) => (f.mime.startsWith("text/") || /json|xml|javascript|markdown/.test(f.mime) || ["md", "txt", "csv", "log"].includes(extOf(f.name))) && f.size < 300 * 1024;

// Downloads every text document in the background (a few at a time) so they all open instantly and
// can be read offline. Skipped in data-saver mode; already-cached versions are not fetched again.
let prefetching = false, prefetchTimer = null;
function schedulePrefetch(ms = 3000) { clearTimeout(prefetchTimer); prefetchTimer = setTimeout(prefetchDocs, ms); }
async function prefetchDocs() {
  if (prefetching || !uid || !navigator.onLine || navigator.connection?.saveData) return;
  prefetching = true;
  try {
    const store = await caches.open(FILE_CACHE), index = await loadCacheIndex(store);
    const have = new Set([...index.values()].map((k) => decodeURIComponent(k.url.split("__files/")[1] || "")));
    const todo = files.filter((f) => isTextish(f) && !have.has(versionOf(f)));
    for (let i = 0; i < todo.length && uid; i += 60) {
      const batch = todo.slice(i, i + 60);
      await signedUrls(batch.map((f) => f.path));
      for (let j = 0; j < batch.length && uid; j += 4) await Promise.all(batch.slice(j, j + 4).map((f) => fileText(f).catch(() => {})));
    }
  } catch (e) { console.error(e); }
  prefetching = false;
}

// Rendered Markdown kept in memory for a while (its images use signed URLs that expire after an hour).
const rendered = new Map();   // version -> { node, exp }
function cachedRender(f) {
  const hit = rendered.get(versionOf(f));
  if (!hit || hit.exp < Date.now()) return null;
  rendered.delete(versionOf(f)); rendered.set(versionOf(f), hit);   // most recent last
  return hit.node.cloneNode(true);
}
function keepRender(f, node) {
  rendered.set(versionOf(f), { node: node.cloneNode(true), exp: Date.now() + 45 * 60 * 1000 });
  while (rendered.size > 30) rendered.delete(rendered.keys().next().value);
}

// Text gets lines shaped like a document; an image, video or PDF one block in its place.
function skeleton(media) {
  const d = document.createElement("div");
  d.className = "skeleton" + (media ? " media" : "");
  d.setAttribute("aria-label", t("加载中"));
  for (let i = 0; i < (media ? 1 : 9); i++) d.append(document.createElement("i"));
  return d;
}

// ---------- markdown ----------
// Renders blog-style Markdown: Hexo front matter, $…$ / $$…$$ math (KaTeX), and images
// referenced by relative path, which are looked up among the synced files.
// Posts synced from the Hexo blog's _posts folder are published at BLOG/posts/<abbrlink>.html
// (permalink: posts/:abbrlink.html in the blog's _config.yml). Folders the blog's skip_render keeps
// unpublished get no link, nor do posts without an abbrlink yet. The Mac agent reads that list from the blog
// and keeps it in the account's metadata, so folder names never appear in this code.
const BLOG = "https://qiao1.top";
let unpublished = [];
function blogUrl(f, fm) {
  const slug = String(fm.abbrlink || "").trim();
  if (f.folder !== "_posts" || !/^[\w-]+$/.test(slug) || unpublished.some((d) => f.name.startsWith(d))) return null;
  return `${BLOG}/posts/${encodeURIComponent(slug)}.html`;
}
const isMarkdown = (f) => ["md", "markdown"].includes(extOf(f.name)) || f.mime === "text/markdown";
const CDN = "https://cdn.jsdelivr.net/npm/";
let mdLibs = null, mermaidLib = null, mermaidSeq = 0;
const MERMAID_CSS = `
  .node rect, .node circle, .node ellipse, .node polygon, .node path, .actor, rect.actor, .classGroup rect, .stateGroup rect,
  .statediagram-state rect, .er.entityBox, .entityBox, .task, .section0, .section1, .section2, .section3 {
    fill: var(--mm-node) !important; stroke: var(--mm-border) !important; stroke-width: 1px !important; }
  .node rect, rect.actor, .statediagram-state rect, .entityBox, .classGroup rect { rx: 10px; ry: 10px; }
  .nodeLabel, .label, .label text, text.actor, .actor > tspan, .messageText, .noteText, .classText, .loopText, .labelText,
  .er.entityLabel, .entityLabel, span { color: var(--ink) !important; fill: var(--ink) !important; }
  .flowchart-link, .messageLine0, .messageLine1, .relation, .transition, line, .actor-line, .loopLine {
    stroke: var(--mm-line) !important; stroke-width: 1.4px !important; }
  .actor-line { stroke-dasharray: 3 4; }
  marker path, .arrowheadPath, .arrowMarkerPath, #arrowhead path, .marker { fill: var(--mm-line) !important; stroke: var(--mm-line) !important; }
  .edgeLabel, .edgeLabel p, .edgeLabel span, .labelBkg { background: var(--mm-label-bg) !important; color: var(--muted) !important; font-size: 13px; }
  .edgeLabel rect { fill: var(--mm-label-bg) !important; opacity: 1; }
  .cluster rect { fill: var(--mm-cluster) !important; stroke: var(--mm-border) !important; rx: 14px; ry: 14px; }
  .cluster .nodeLabel, .cluster-label span { color: var(--muted) !important; }
  .note { fill: var(--mm-cluster) !important; stroke: var(--mm-border) !important; }
`;
function loadMermaid() {
  mermaidLib ||= import(CDN + "mermaid@10.9.1/dist/mermaid.esm.min.mjs").then(({ default: m }) => {
    const dark = isDark();
    // "base" theme in greys for Mermaid's own colour maths; MERMAID_CSS then repaints everything with the
    // page's CSS variables, so diagrams match the app and follow light/dark even after they are rendered.
    const v = dark
      ? { primaryColor: "#1a1a1a", primaryBorderColor: "#4a4a4a", primaryTextColor: "#f0f0f0", lineColor: "#8c8c8c", edgeLabelBackground: "#0e0e0e", tertiaryColor: "#141414" }
      : { primaryColor: "#f6f6f6", primaryBorderColor: "#cfcfcf", primaryTextColor: "#111111", lineColor: "#8a8a8a", edgeLabelBackground: "#ffffff", tertiaryColor: "#fafafa" };
    m.initialize({
      startOnLoad: false, securityLevel: "strict", theme: "base", darkMode: dark,
      themeVariables: { ...v, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: "14px" },
      themeCSS: MERMAID_CSS,
      flowchart: { curve: "basis", nodeSpacing: 42, rankSpacing: 54, padding: 14, htmlLabels: true },
      sequence: { actorMargin: 60, boxMargin: 8, mirrorActors: false },
    });
    return m;
  }).catch((e) => { mermaidLib = null; throw e; });
  return mermaidLib;
}
// ```mermaid blocks become diagrams; a block with a syntax error stays as code with a note.
async function renderMermaid(frag) {
  const blocks = [...frag.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return;
  let mermaid;
  try { mermaid = await loadMermaid(); } catch (e) { console.error(e); return; }
  for (const code of blocks) {
    const id = "mmd" + ++mermaidSeq;
    try {
      const { svg } = await mermaid.render(id, code.textContent);
      const box = document.createElement("div");
      box.className = "mermaid-box";
      box.innerHTML = svg;
      // Fit the width, but never shrink below 560px (or the natural size): past that it scrolls sideways.
      const el = box.querySelector("svg"), natural = parseFloat(el?.style.maxWidth);
      if (natural) { el.style.width = "100%"; el.style.minWidth = Math.min(natural, 560) + "px"; }
      code.parentElement.replaceWith(box);
    } catch (e) {
      document.getElementById("d" + id)?.remove();
      code.parentElement.before(Object.assign(document.createElement("p"), { className: "md-missing", textContent: t("这段 Mermaid 图表有语法错误，下面显示原文：") }));
    }
  }
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
}
function loadMarkdownLibs() {
  return mdLibs ||= (async () => {
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: CDN + "katex@0.16.11/dist/katex.min.css" });
    document.head.append(css);
    await Promise.all([
      loadScript(CDN + "marked@12.0.2/marked.min.js"),
      loadScript(CDN + "dompurify@3.1.6/dist/purify.min.js"),
      loadScript(CDN + "katex@0.16.11/dist/katex.min.js"),
    ]);
  })().catch((e) => { mdLibs = null; throw e; });
}

function parseFrontMatter(src) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return { body: src, meta: {} };
  const meta = {};
  let listKey = null, block = null;
  for (const line of m[1].split(/\r?\n/)) {
    // A YAML block scalar (key: > or |) continues on the indented lines after it.
    if (block && /^\s+\S/.test(line)) { const [k, sep] = block; meta[k] += (meta[k] ? sep : "") + line.trim(); continue; }
    block = null;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { meta[listKey].push(item[1].replace(/^["']|["']$/g, "")); continue; }
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, v] = kv;
    listKey = null;
    if (!v) { meta[k] = []; listKey = k; }
    else if (/^\[.*\]$/.test(v)) meta[k] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else if (/^[>|][+-]?$/.test(v)) { meta[k] = ""; block = [k, v[0] === ">" ? " " : "\n"]; }
    else meta[k] = v.replace(/^["']|["']$/g, "");
  }
  return { body: src.slice(m[0].length), meta };
}

function resolveRel(dir, href) {
  const out = [...dir];
  for (const seg of decodeURIComponent(href.split(/[?#]/)[0]).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop(); else out.push(seg);
  }
  return out.join("/");
}

// [[links]] and relative .md links resolve the way Obsidian does: relative to the file, then from the
// vault root, then by file name when only one file has it. Shared by the preview and the graph.
const stripMd = (n) => n.replace(/\.(md|markdown)$/i, "");
function linkResolver(md) {
  const byPath = new Map(), byBase = new Map();
  for (const f of md) {
    byPath.set(stripMd(f.name).toLowerCase(), f);
    byPath.set(stripMd(fullPath(f).join("/")).toLowerCase(), f);
    const b = stripMd(baseName(f.name)).toLowerCase();
    byBase.set(b, byBase.has(b) ? null : f);
  }
  return (dir, target) => {
    const t = stripMd(target.trim()).replace(/^\/+/, "");
    let rel = t;
    try { rel = resolveRel(dir, t); } catch {}
    return byPath.get(rel.toLowerCase()) ?? byPath.get(t.toLowerCase()) ?? byBase.get(baseName(t).toLowerCase()) ?? null;
  };
}
// Obsidian syntax marked doesn't know: [[target#heading|alias]] becomes a placeholder link, resolved after
// rendering; ==text== becomes highlighted text.
const WIKI = /(?<!!)\[\[([^\]\n]+?)\]\]/g;
const mdEscape = (t) => t.replace(/[\\`*_[\]<>]/g, "\\$&");
function obsidianSyntax(part, wiki) {
  return part
    .replace(WIKI, (_, inner) => {
      const [target, alias] = inner.split(/\\?\|/);
      const [file, heading] = target.split("#");
      const label = (alias || (file ? baseName(stripMd(file.trim())) + (heading ? " › " + heading : "") : heading || "")).trim();
      wiki.push(file.trim());
      return `[${mdEscape(label || inner)}](#suiji-wiki-${wiki.length - 1})`;
    })
    .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, "<mark>$1</mark>");
}

async function renderMarkdown(src, f) {
  await loadMarkdownLibs();
  const { body, meta: fm } = parseFrontMatter(src);
  let text = body
    .replace(/\{%\s*asset_img\s+(\S+)\s*(.*?)%\}/g, (_, file, alt) => `![${alt.trim()}](${file})`)
    .replace(/^\s*\{%[^%]*%\}\s*$/gm, "");

  // Pull math out before Markdown sees it (so _ and * inside formulas stay intact), skipping code.
  const math = [];
  const keep = (tex, display) => {
    math.push(window.katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: "html" }));
    return display ? `\n\nKATEXBLOCK${math.length - 1}END\n\n` : `KATEXINLINE${math.length - 1}END`;
  };
  const wiki = [];
  text = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g).map((part, i) => i % 2 ? part : obsidianSyntax(part
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
    .replace(/(?<![\\$\w])\$(?!\s)([^\n$]+?)(?<![\s\\])\$(?!\d)/g, (_, t) => keep(t, false)), wiki)
  ).join("");

  let html = window.DOMPurify.sanitize(window.marked.parse(text, { gfm: true, breaks: false }));
  html = html
    .replace(/<p>KATEXBLOCK(\d+)END<\/p>/g, (_, i) => `<div class="math-block">${math[i]}</div>`)
    .replace(/KATEX(?:BLOCK|INLINE)(\d+)END/g, (_, i) => math[i]);

  const art = document.createElement("article");
  art.className = "md-body";
  const web = blogUrl(f, fm);
  if (web) art.dataset.web = web;
  art.append(docHead(f, fm, web, body));
  // Parse inside a <template> so relative images aren't fetched from this site before we resolve them.
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const frag = tpl.content;
  await renderMermaid(frag);

  // Relative images and links point at sibling files in the synced folder.
  const dir = fullPath(f).slice(0, -1);
  const byPath = new Map(files.map((x) => [fullPath(x).join("/"), x]));
  const isRel = (u) => u && !/^([a-z]+:|\/\/|#|data:)/i.test(u);
  const imgs = [...frag.querySelectorAll("img")].filter((img) => isRel(img.getAttribute("src")));
  const targets = imgs.map((img) => byPath.get(resolveRel(dir, img.getAttribute("src"))));
  const paths = [...new Set(targets.filter(Boolean).map((t) => t.path))];
  const urls = paths.length ? await signedUrls(paths) : new Map();
  imgs.forEach((img, i) => {
    const url = targets[i] && urls.get(targets[i].path);
    if (url) img.src = url;
    else img.replaceWith(Object.assign(document.createElement("span"), { className: "md-missing", textContent: t("[图片：{name}]", { name: img.alt || img.getAttribute("src") }) }));
  });
  for (const img of frag.querySelectorAll("img")) img.loading = "lazy";
  const content = document.createElement("div");
  content.append(frag);
  art.append(content);
  // A document that opens with its own # heading: that heading is the title, above the properties.
  const first = content.firstElementChild;
  if (first?.tagName === "H1") { first.classList.add("md-title"); art.querySelector(".md-head").prepend(first); }
  const find = wiki.length ? linkResolver(files.filter(isMarkdown)) : null, wdir = f.name.split("/").slice(0, -1);
  for (const a of content.querySelectorAll('a[href^="#suiji-wiki-"]')) {
    const target = find(wdir, wiki[+a.getAttribute("href").slice(12)] || "");
    if (target) { a.dataset.open = target.id; a.href = "#"; a.title = target.name; a.classList.add("wikilink"); }
    else a.replaceWith(Object.assign(document.createElement("span"), { className: "wikilink missing", textContent: a.textContent, title: t("没有找到这篇笔记") }));
  }
  for (const a of content.querySelectorAll("a[href]")) {
    if (a.dataset.open) continue;
    const href = a.getAttribute("href");
    const target = isRel(href) && byPath.get(resolveRel(dir, href));
    if (target) a.dataset.open = target.id;   // handled by the pane's click listener, so cached copies keep working
    else if (!href.startsWith("#")) { a.target = "_blank"; a.rel = "noopener"; }
  }
  return art;
}

// The title (front matter title, else the file name, unless the text opens with its own # heading), the blog
// link, and every front matter field as a row of a properties card. Tags are buttons that search for the tag.
const PROP_ICONS = {
  text: '<path d="M2.5 4h11M2.5 8h11M2.5 12h7"/>',
  list: '<path d="M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>',
  tags: '<path d="M2 2.5h5.5l6.5 6.5-5 5L2.5 7.5z"/><circle cx="5.3" cy="5.3" r=".8"/>',
  date: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>',
  link: '<path d="M7 9a3 3 0 0 0 4.2 0l2-2A3 3 0 0 0 9 2.8l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2A3 3 0 0 0 7 13.2l.8-.8"/>',
};
let propsOpen = true;
try { propsOpen = localStorage.getItem("suiji:props") !== "0"; } catch {}
function docHead(f, fm, web, body) {
  const head = el$("header", "md-head");
  if (!/^\s*#\s/.test(body)) head.append(el$("h1", "md-title", fm.title || stripMd(baseName(f.name))));   // else renderMarkdown moves that heading here
  if (web) head.append(Object.assign(el$("a", "md-web", web.replace(/^https?:\/\//, "")), { href: web, target: "_blank", rel: "noopener" }));
  const keys = Object.keys(fm).filter((k) => [].concat(fm[k]).some((v) => v !== ""));
  if (!keys.length) return head;
  const box = el$("details", "md-props"), rows = el$("dl", "md-prop-list");
  box.open = propsOpen;
  box.addEventListener("toggle", () => { propsOpen = box.open; try { localStorage.setItem("suiji:props", propsOpen ? "1" : "0"); } catch {} });
  for (const k of keys) {
    const v = fm[k], many = Array.isArray(v), tags = k === "tags";
    const kind = tags ? "tags" : many ? "list" : /^\d{4}-\d\d-\d\d/.test(v) ? "date" : /^https?:\/\//.test(v) ? "link" : "text";
    const dt = el$("dt"), dd = el$("dd"), row = el$("div", "md-prop");
    dt.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${PROP_ICONS[kind]}</svg>`;
    dt.append(el$("span", null, k));
    if (tags) for (const tag of v) { const b = el$("button", "md-tag", tag); b.type = "button"; b.dataset.tag = b.title = tag; dd.append(b); }
    else if (many) for (const x of v) dd.append(Object.assign(el$("span", "md-chip", x), { title: x }));
    else if (kind === "link") dd.append(Object.assign(el$("a", null, v), { href: v, target: "_blank", rel: "noopener" }));
    else { dd.textContent = v; if (v.length > 90) { dd.className = "clamp"; dd.onclick = () => dd.classList.remove("clamp"); } }
    row.append(dt, dd); rows.append(row);
  }
  box.append(el$("summary", null, t("属性")), rows);
  head.append(box);
  return head;
}

async function showFile(f, p) {
  const token = ++p.token, preview = p.preview;
  p.meta.textContent = `${baseName(f.name)} · ${fmtSize(f.size)} · ${fmt(f.updated_at || f.created_at)}`;
  const md = isMarkdown(f) && f.size < 2 * 1024 * 1024;
  preview.classList.toggle("doc", md);
  const show = (el) => {
    if (token !== p.token) return;
    clearTimeout(wait); preview.replaceChildren(el); preview.scrollTop = 0; p.shownId = f.id;
    if (staleIds.has(f.id) && !retried.has(versionOf(f))) {
      retried.add(versionOf(f));
      setTimeout(() => { if (token === p.token) { p.shown = null; renderPane(p); } }, 5000);
    }
  };
  // The skeleton only appears if loading takes a noticeable moment, so cached documents never flash.
  const media = isImage(f) || /^(video|audio)\/|\/pdf$/.test(f.mime);
  const wait = setTimeout(() => { if (token === p.token) preview.replaceChildren(skeleton(media)); }, 120);
  // The download link is not needed to show the file; fetch it alongside.
  p.dl.removeAttribute("href");
  p.web.hidden = true; p.web.removeAttribute("href");
  setToc(p, null);
  signedUrls([f.path], f.name).then((m) => { if (token === p.token && m.get(f.path)) p.dl.href = m.get(f.path); }).catch(() => {});

  const textish = isTextish(f);
  try {
    if (md) {
      let el = cachedRender(f);
      if (!el) {
        const [text] = await Promise.all([fileText(f), loadMarkdownLibs()]);
        if (token !== p.token) return;
        el = await renderMarkdown(text, f);
        if (!staleIds.has(f.id)) keepRender(f, el);
      }
      if (el.dataset.web) { p.web.href = el.dataset.web; p.web.hidden = false; }
      show(el);
      if (token === p.token) setToc(p, el);
      return;
    }
    if (textish) {
      const text = await fileText(f);
      return show(Object.assign(document.createElement("pre"), { textContent: text }));
    }
    const url = await signedUrl(f);
    if (!url) throw new Error("no url");
    if (!p.dl.href) p.dl.href = url;
    if (isImage(f)) {
      const img = Object.assign(document.createElement("img"), { src: url, alt: f.name });
      img.decode().catch(() => {}).finally(() => show(img));   // swap in once decoded, no half-painted image
      return;
    }
    if (f.mime.startsWith("video/") || f.mime.startsWith("audio/")) return show(Object.assign(document.createElement(f.mime.startsWith("video/") ? "video" : "audio"), { src: url, controls: true, playsInline: true }));
    if (f.mime === "application/pdf") return show(Object.assign(document.createElement("iframe"), { src: url, title: f.name }));
    show(Object.assign(document.createElement("div"), { className: "big-ext", textContent: extOf(f.name) || t("文件") }));
  } catch (e) {
    console.error(e);
    show(Object.assign(document.createElement("div"), { className: "big-ext", textContent: navigator.onLine ? t("读取失败") : t("离线，这个文件还没缓存过") }));
  }
}

window.addEventListener("online", () => { sync(); if (!filesLoaded) loadFiles(); });
window.addEventListener("offline", () => setSync("err", t("离线 · 已存在本机")));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { commitAll(); sync(); } else sync();
});

// ---------- UI ----------
// One list holds everything: notes written here live in the 随手记 folder at the top of the tree,
// synced and uploaded files below it. Clicking an item opens it in the focused pane.
const NOTES_KEY = "\u0000notes";
const DND = "application/x-suiji-item";

// The first line that has text, without the "# " that makes it a Markdown heading.
function titleOf(body) {
  const l = (body || "").split("\n").find((s) => s.trim())?.trim().replace(/^#{1,6}(\s+|$)/, "");
  return l || t("无标题");
}
function fmt(iso) {
  const d = new Date(iso), now = new Date(), p = (n) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return t("今天 {time}", { time: `${p(d.getHours())}:${p(d.getMinutes())}` });
  if (d.getFullYear() === now.getFullYear()) return lang === "en"
    ? `${d.toLocaleDateString("en", { month: "short", day: "numeric" })} ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------- folder tree ----------
// Every file sits at fullPath = [folder, ...name segments]. Folders open and close in place,
// like a file explorer sidebar; which ones are open is remembered per device.
const fullPath = (f) => [f.folder, ...f.name.split("/")].filter(Boolean);
const byName = (a, b) => a.localeCompare(b, "zh", { numeric: true });
let expanded = new Set();
try { expanded = new Set(JSON.parse(localStorage.getItem("suiji:open")) || []); } catch {}
const saveExpanded = () => { try { localStorage.setItem("suiji:open", JSON.stringify([...expanded])); } catch {} };
// Sort order of the sidebar, saved as "suiji:sort": name / name-desc by name, new / old by last change.
// Under the time orders a folder ranks by its newest file. Quick notes stay newest first under the name
// orders, since they read as a journal.
const SORTS = ["name", "name-desc", "new", "old"];
let sortBy = "name";
try { const s = localStorage.getItem("suiji:sort"); if (SORTS.includes(s)) sortBy = s; } catch {}
const stamp = (x) => x.updated_at || x.created_at || "";
function order(items, nameOf, timeOf) {
  const cmp = sortBy === "name" ? (a, b) => byName(nameOf(a), nameOf(b))
    : sortBy === "name-desc" ? (a, b) => byName(nameOf(b), nameOf(a))
    : sortBy === "new" ? (a, b) => timeOf(b).localeCompare(timeOf(a)) || byName(nameOf(a), nameOf(b))
    : (a, b) => timeOf(a).localeCompare(timeOf(b)) || byName(nameOf(a), nameOf(b));
  return [...items].sort(cmp);
}
const orderFiles = (fs) => order(fs, (f) => baseName(f.name), stamp);
const orderNotes = (ns) => sortBy === "old" ? [...ns].reverse() : ns;

function buildTree() {
  const root = { dirs: new Map(), files: [], count: 0, latest: "" };
  for (const f of files) {
    const p = fullPath(f), at = stamp(f);
    let node = root;
    node.count++;
    for (const seg of p.slice(0, -1)) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [], count: 0, latest: "" });
      node = node.dirs.get(seg);
      node.count++;
      if (at > node.latest) node.latest = at;
    }
    node.files.push(f);
  }
  return root;
}

// "COMP5318-Week01" inside folder COMP5318 reads as "Week01"; the full name stays in the tooltip.
function shortName(name, parent) {
  if (!parent || name.length <= parent.length + 1) return name;
  return name.startsWith(parent) && /[-_ ·.]/.test(name[parent.length]) ? name.slice(parent.length + 1).replace(/^[-_ ]+/, "") : name;
}

// An item row: click opens it in the focused pane, ⌘/Ctrl-click opens it in a new pane on the right,
// and it can be dragged onto any edge of a pane to split there.
function itemRow(kind, id, label, depth, metaText, title) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "tree-row tree-file";
  b.style.setProperty("--depth", depth);
  b.setAttribute("aria-current", String(!!focused && focused.kind === kind && focused.itemId === id));
  b.classList.toggle("shown", [...panes.values()].some((p) => p.kind === kind && p.itemId === id));
  b.title = title;
  b.append(Object.assign(document.createElement("span"), { className: "tree-name", textContent: label }));
  if (metaText) b.append(Object.assign(document.createElement("span"), { className: "tree-meta", textContent: metaText }));
  b.dataset.kind = kind; b.dataset.id = id;
  if (kind === "file") b.onpointerenter = b.ontouchstart = () => {
    const f = files.find((x) => x.id === id);
    if (f && isTextish(f)) fileText(f).catch(() => {});
  };
  b.draggable = true;
  b.ondragstart = (e) => { e.dataTransfer.setData(DND, JSON.stringify({ kind, id })); e.dataTransfer.effectAllowed = "copy"; };
  b.onclick = (e) => {
    if ((e.metaKey || e.ctrlKey) && !isPhone.matches) split(focused, "row", false, { kind, id });
    else openIn(focused, kind, id);
  };
  return b;
}
// The Edit button's label (also its tooltip, for narrow panes that show only its icon); "on" swaps the pencil for a tick.
function editLabel(p, text, on) {
  p.edit.querySelector(".lbl").textContent = text; p.edit.title = text; p.edit.classList.toggle("on", on);
}
// In search results metaText is the file's folder path; the row shows only the nearest folder, where the
// name differs, and the tooltip gives the whole path.
function fileRow(f, depth, metaText) {
  const name = baseName(f.name), parent = fullPath(f).slice(-2, -1)[0];
  return itemRow("file", f.id, metaText ? name : shortName(name, parent), depth, metaText && metaText.split("/").pop(),
    `${name}\n${metaText ? metaText + "\n" : ""}${fmtSize(f.size)} · ${fmt(f.updated_at || f.created_at)}`);
}
function noteRow(n, depth, metaText) {
  return itemRow("note", n.id, titleOf(n.body), depth, n.dirty ? t("未同步") : metaText, t("修改于 {time}", { time: fmt(n.updated_at) }));
}

// A folder row plus its drawer; children are built the first time it opens.
function folderRow(box, key, name, count, depth, fillChildren) {
  const open = expanded.has(key);
  const head = document.createElement("button");
  head.type = "button"; head.className = "tree-row tree-folder";
  head.style.setProperty("--depth", depth);
  head.setAttribute("aria-expanded", String(open));
  head.append(
    Object.assign(document.createElement("span"), { className: "chev", ariaHidden: "true" }),
    Object.assign(document.createElement("span"), { className: "tree-name", textContent: name }),
    Object.assign(document.createElement("span"), { className: "tree-count", textContent: count }),
  );
  const drawer = document.createElement("div");
  drawer.className = "drawer" + (open ? " open" : "");
  const inner = document.createElement("div");
  inner.className = "drawer-inner";
  inner.style.setProperty("--depth", depth);
  drawer.append(inner);
  let filled = false;
  const fill = () => { if (!filled) { fillChildren(inner); filled = true; } };
  if (open) fill();
  head.onclick = () => {
    const now = !expanded.has(key);
    if (now) {
      expanded.add(key); fill();
      // The cascade-in animation plays only when the user opens a folder, never on re-render.
      drawer.classList.add("opening");
      setTimeout(() => drawer.classList.remove("opening"), 600);
    } else expanded.delete(key);
    saveExpanded(); showCounts();
    head.setAttribute("aria-expanded", String(now));
    drawer.classList.toggle("open", now);
  };
  box.append(head, drawer);
}

function renderNode(node, path, depth, box) {
  for (const [name, child] of order(node.dirs, (d) => d[0], (d) => d[1].latest)) {
    folderRow(box, [...path, name].join("/"), name, child.count, depth, (inner) => renderNode(child, [...path, name], depth + 1, inner));
  }
  for (const f of orderFiles(node.files)) box.append(fileRow(f, depth));
}

function renderList() {
  const q = search.value.trim().toLowerCase();
  const keepScroll = list.scrollTop;
  list.replaceChildren();
  const notes = orderNotes(visible());
  const hitNotes = q ? notes.filter((n) => n.body.toLowerCase().includes(q)) : notes;
  const tag = q.startsWith("#") && q.slice(1);   // "#name" also finds files whose front matter has that tag
  const hitFiles = q ? files.filter((f) => fullPath(f).join("/").toLowerCase().includes(q) || (tag && (f.tags || []).some((x) => x.toLowerCase() === tag)) || bodies.get(f.id)?.includes(q)) : files;
  if (!hitNotes.length && !hitFiles.length) {
    const li = document.createElement("li");
    li.className = "empty";
    // Before the first file list arrives an empty account and one still loading look the same; don't call it empty yet.
    li.innerHTML = q ? t("<strong>没有找到</strong>换个关键词试试。")
                 : !filesLoaded && navigator.onLine ? `<strong>${t("载入中…")}</strong>`
                     : t("<strong>这里还是空的</strong>点「新建」写一条笔记，或者点「上传」放文件进来。Mac 上运行同步程序后，选中的文件夹会自动出现在这里。");
    list.append(li);
    showCounts();
    return;
  }
  const li = document.createElement("li");
  li.className = "tree";
  if (q) {
    for (const n of hitNotes) li.append(noteRow(n, 0, t("随手记")));
    // Files whose path matches come before those that only mention the word inside.
    const byPath = (f) => fullPath(f).join("/").toLowerCase().includes(q);
    const ranked = orderFiles(hitFiles);
    for (const f of [...ranked.filter(byPath), ...ranked.filter((f) => !byPath(f))]) li.append(fileRow(f, 0, fullPath(f).slice(0, -1).join("/")));
  } else {
    if (notes.length) folderRow(li, NOTES_KEY, t("随手记"), notes.length, 0, (inner) => { for (const n of notes) inner.append(noteRow(n, 1)); });
    renderNode(buildTree(), [], 0, li);
  }
  list.append(li);
  list.scrollTop = keepScroll;
  showCounts();
}
// Under the app's name: how many files and folders there are. The fold button closes every open folder,
// or opens them all when none is open.
function folderKeys() {
  const keys = [], walk = (node, path) => { for (const [name, child] of node.dirs) { keys.push([...path, name].join("/")); walk(child, [...path, name]); } };
  walk(buildTree(), []);
  return keys;
}
function showCounts() {
  $("counts").textContent = t("{files} 个文件 · {folders} 个文件夹", { files: files.length, folders: folderKeys().length });
  const label = expanded.size ? t("全部折叠") : t("全部展开");
  $("foldBtn").title = label; $("foldBtn").setAttribute("aria-label", label);
}

// ---------- panes ----------
// The editor area is a tree of splits. A leaf {pane} holds one pane; a split {dir, ratio, a, b} holds two
// children side by side ("row") or stacked ("col"). Each pane shows one note or one file. On phones only
// the focused pane is shown. The layout and what each pane shows are remembered per device.
const ws = $("ws"), paneTpl = $("paneTpl");
const isPhone = matchMedia("(max-width: 720px)");
const panes = new Map();
let layout = null, focused = null, paneSeq = 0;

// ---------- outline ----------
// Headings of the open Markdown file in a panel beside it. Each pane opens and closes its own outline
// (kept with the layout). It sits beside the text while the text keeps at least TEXT_MIN, shrinking to fit,
// so side-by-side panes each keep theirs; narrower panes and phones open it over the text on demand.
const TOC_MIN = 180, TOC_DEFAULT = 240, TEXT_MIN = 340;
const isNarrow = (p) => p.el.clientWidth < TOC_MIN + TEXT_MIN;
const paneSizes = new ResizeObserver((es) => {
  for (const e of es) for (const p of panes.values()) if (p.el === e.target) applyToc(p);
});
// Its width is shared by all panes: drag the grip on its left edge, double-click to reset.
const tocMax = (p) => Math.max(TOC_MIN, Math.min(440, p.el.clientWidth - TEXT_MIN));
// A pane too narrow for the shared width gets a slimmer outline of its own.
function fitToc(p) {
  const w = isNarrow(p) ? 0 : Math.min(tocWidth(), p.el.clientWidth - TEXT_MIN);
  p.toc.style.flexBasis = w && w < tocWidth() ? w + "px" : "";
}
const refitTocs = () => panes.forEach((x) => { fitToc(x); x.tocCur = null; markHeading(x); });
// Escape closes an outline that is open over the text, the one in the focused pane first.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("settings").open) return;
  const open = [...panes.values()].filter((p) => p.tocNarrow && isNarrow(p) && !p.toc.hidden);
  const p = open.includes(focused) ? focused : open[0];
  if (p) { p.tocNarrow = false; applyToc(p); p.outline.focus(); }
});
function setTocWidth(px, p, save) {
  const w = Math.round(Math.min(p ? tocMax(p) : 440, Math.max(TOC_MIN, px)));
  document.documentElement.style.setProperty("--toc-w", w + "px");
  if (save) try { localStorage.setItem("suiji:toc-w", String(w)); } catch {}
  return w;
}
try { const w = +localStorage.getItem("suiji:toc-w"); if (w) setTocWidth(w); } catch {}
const tocWidth = () => parseFloat(document.documentElement.style.getPropertyValue("--toc-w")) || TOC_DEFAULT;

const el$ = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
function setToc(p, art) {
  p.heads = art ? [...art.querySelectorAll("h1, h2, h3, h4")].filter((h) => h.textContent.trim()) : [];
  if (p.heads.length < 2) p.heads = [];
  if (!p.heads.length) { p.toc.replaceChildren(); p.tocList = null; applyToc(p); return; }
  const top = Math.min(...p.heads.map((h) => +h.tagName[1]));
  const grip = el$("div", "toc-grip"); grip.title = t("拖动调整宽度，双击恢复");
  const close = el$("button", "toc-close"); close.type = "button"; close.dataset.close = ""; close.setAttribute("aria-label", t("关闭大纲"));
  close.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  const head = el$("div", "toc-head");
  head.append(el$("span", "toc-title", t("大纲")), el$("span", "toc-count", String(p.heads.length)), close);
  const bar = el$("div", "toc-bar"); p.tocBar = el$("i"); bar.append(p.tocBar);
  p.tocList = el$("div", "toc-list"); p.tocInk = el$("span", "toc-ink");
  p.tocList.append(p.tocInk, ...p.heads.map((h, i) => {
    const t = h.textContent.trim(), b = el$("button");
    b.append(el$("span", null, t));
    b.type = "button"; b.title = t; b.dataset.i = i; b.dataset.lvl = Math.min(+h.tagName[1] - top, 3);
    return b;
  }));
  p.toc.replaceChildren(grip, head, bar, p.tocList);
  applyToc(p);
}
function applyToc(p) {
  const has = p.heads.length > 0 && !p.fv.hidden;
  const narrow = isNarrow(p), on = has && (narrow ? p.tocNarrow : p.tocOpen);
  p.outline.hidden = !has;
  p.outline.setAttribute("aria-pressed", String(on));
  p.toc.hidden = !on;
  p.toc.classList.toggle("overlay", narrow);
  fitToc(p);
  if (on) { p.tocCur = null; markHeading(p); }
}
// The current section: the last heading that has scrolled past the top of the pane.
function markHeading(p) {
  if (p.toc.hidden || !p.tocList) return;
  const pv = p.preview, room = pv.scrollHeight - pv.clientHeight;
  p.tocBar.style.transform = `scaleX(${room > 0 ? Math.min(1, pv.scrollTop / room) : 1})`;   // reading progress
  const top = pv.getBoundingClientRect().top + 80;
  let cur = 0;
  if (p.tocLock != null) cur = p.tocLock;
  else if (room > 0 && pv.scrollTop >= room - 2) cur = p.heads.length - 1;   // at the end, the last section counts as current
  else p.heads.forEach((h, i) => { if (h.getBoundingClientRect().top <= top) cur = i; });
  if (cur === p.tocCur) return;
  p.tocCur = cur;
  p.tocList.querySelector("[aria-current]")?.removeAttribute("aria-current");
  const next = p.tocList.querySelector(`[data-i="${cur}"]`);
  next.setAttribute("aria-current", "true");
  // One marker slides to the current row instead of each row drawing its own.
  p.tocInk.style.transform = `translateY(${next.offsetTop + 6}px)`;
  p.tocInk.style.height = Math.max(10, next.offsetHeight - 12) + "px";
  const list = p.tocList, y = next.offsetTop - list.scrollTop;
  if (y < 24 || y + next.offsetHeight > list.clientHeight - 24) list.scrollTo({ top: next.offsetTop - list.clientHeight / 3, behavior: "smooth" });
}

function makePane(item) {
  const el = paneTpl.content.firstElementChild.cloneNode(true);
  const q = (c) => el.querySelector("." + c);
  const p = {
    id: ++paneSeq, el, ta: q("p-ta"), ph: q("p-ph"), fv: q("p-fv"), preview: q("p-preview"), meta: q("p-meta"),
    dl: q("p-dl"), del: q("p-del"), hint: q("p-hint"), edit: q("p-edit"), web: q("p-web"), fileEdit: false, fileBase: null,
    acts: q("p-acts"), more: q("p-more"), info: q("p-info"),
    outline: q("p-outline"), toc: q("p-toc"), heads: [], tocOpen: tocAuto, tocNarrow: false, tocLock: null, tocCur: null,
    tocList: null, tocInk: null, tocBar: null,
    kind: item?.kind || null, itemId: item?.id || null, shown: null, token: 0,
    editing: false, editTimer: null,
    hist: item?.kind ? [{ kind: item.kind, id: item.id, top: 0 }] : [], hi: item?.kind ? 0 : -1,
    prev: q("p-prev"), next: q("p-next"),
  };
  if (p.kind === "note") p.ta.value = store.notes[p.itemId]?.body || "";
  panes.set(p.id, p);
  el.classList.add("fresh");
  el.addEventListener("animationend", () => el.classList.remove("fresh"), { once: true });
  el.addEventListener("pointerdown", () => focusPane(p), true);
  el.addEventListener("focusin", () => focusPane(p));

  p.ta.addEventListener("input", () => {
    p.editing = true; setSync("saving", t("待保存…"));
    clearTimeout(p.editTimer); p.editTimer = setTimeout(() => commit(p), p.kind === "file" ? 1200 : 600);
  });
  p.ta.addEventListener("blur", () => commit(p));
  p.preview.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-open]");
    if (a) { e.preventDefault(); openIn(p, "file", a.dataset.open); }
    const tag = e.target.closest("[data-tag]");
    if (tag) searchTag(tag.dataset.tag);
  });
  // A narrow pane cuts the file's details short; hovering them shows the whole line.
  p.meta.onpointerenter = () => { p.meta.title = p.meta.scrollWidth > p.meta.clientWidth ? p.meta.textContent : ""; };
  // Phones keep the file's details, Web and Download in a menu under ⋯.
  p.more.onclick = () => {
    p.info.textContent = p.meta.textContent;
    p.more.setAttribute("aria-expanded", String(p.acts.classList.toggle("menu")));
  };
  p.acts.addEventListener("click", (e) => { if (e.target.closest(".p-extra a")) closeMenu(p); });
  // Deleting a note marks it deleted and syncs that; an empty one goes without asking. The pane then goes
  // back to what it showed before, if anything.
  p.del.onclick = () => {
    const n = p.kind === "note" && store.notes[p.itemId];
    closeMenu(p);
    if (!n || ((n.body.trim() || p.ta.value.trim()) && !confirm(t("删除这条笔记？")))) return;
    clearTimeout(p.editTimer); p.editing = false;
    Object.assign(n, { deleted: true, updated_at: new Date().toISOString(), dirty: true });
    persist(); render(); goHist(p, -1); scheduleSync();
  };
  p.outline.onclick = () => {
    if (isNarrow(p)) p.tocNarrow = !p.tocNarrow;
    else { p.tocOpen = !p.tocOpen; saveLayout(); }
    applyToc(p);
  };
  p.toc.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".toc-grip")) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = tocWidth();
    document.body.classList.add("resizing", "resizing-row");
    const move = (ev) => { setTocWidth(w0 + x0 - ev.clientX, p); panes.forEach(fitToc); };
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row");
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      setTocWidth(tocWidth(), p, true); refitTocs();
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  p.toc.addEventListener("dblclick", (e) => { if (e.target.closest(".toc-grip")) { setTocWidth(TOC_DEFAULT, p, true); refitTocs(); } });
  // An outline open over the text closes again on a click in the text.
  p.preview.addEventListener("pointerdown", () => { if (p.tocNarrow && isNarrow(p)) { p.tocNarrow = false; applyToc(p); } });
  p.toc.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { if (isNarrow(p)) p.tocNarrow = false; else { p.tocOpen = false; saveLayout(); } applyToc(p); return; }
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const h = p.heads[+b.dataset.i], top = p.preview.getBoundingClientRect().top;
    p.preview.scrollTo({ top: p.preview.scrollTop + h.getBoundingClientRect().top - top - 12, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (isNarrow(p)) { p.tocNarrow = false; applyToc(p); }
    p.tocLock = +b.dataset.i; markHeading(p);   // keep the clicked heading marked while the scroll settles
  });
  let spy = 0, settle = 0;
  p.ta.addEventListener("scroll", () => saveLater(), { passive: true });
  p.preview.addEventListener("scroll", () => {
    saveLater();
    clearTimeout(settle); settle = setTimeout(() => { p.tocLock = null; }, 200);
    if (!spy) spy = requestAnimationFrame(() => { spy = 0; markHeading(p); });
  }, { passive: true });
  paneSizes.observe(el);
  q("p-back").onclick = () => { commitAll(); app.dataset.view = "list"; };
  p.prev.onclick = () => goHist(p, -1);
  p.next.onclick = () => goHist(p, 1);
  q("p-split-r").onclick = () => split(p, "row", false, p.kind && { kind: p.kind, id: p.itemId });
  q("p-split-d").onclick = () => split(p, "col", false, p.kind && { kind: p.kind, id: p.itemId });
  q("p-close").onclick = () => closePane(p);
  // Text files can be edited in place; saving replaces the cloud copy, and the Mac agent writes it back to disk.
  p.edit.onclick = async () => {
    if (p.fileEdit) {
      // Wait for the save (this one or an autosave already under way), so the preview shows the new version.
      p.edit.disabled = true;
      await commit(p); await p.saving;
      p.edit.disabled = false;
      p.fileEdit = false; p.shown = null; renderPane(p); return;
    }
    const f = files.find((x) => x.id === p.itemId);
    if (!f) return;
    p.edit.disabled = true; editLabel(p, t("载入中…"), false);   // the fresh read takes a moment
    // The file on disk in the Mac app; otherwise a fresh signed URL plus a cache-buster, so editing never
    // starts from a stale copy.
    let text = null;
    if (local.localPath(f)) text = await local.readLocal(f).catch(() => null);
    else { const s = await sb.storage.from("files").createSignedUrl(f.path, 60);
      if (!s.error) try { const r = await fetch(s.data.signedUrl + "&t=" + Date.now(), { cache: "no-store" }); if (r.ok) text = await r.text(); } catch {} }
    p.edit.disabled = false; editLabel(p, t("编辑"), false);
    if (text === null) { showNote(t("读取文件失败，请检查网络。"), "err"); return; }
    p.fileBase = text;
    p.ta.value = p.fileBase; p.fileEdit = true; p.editing = false;
    renderPane(p); p.ta.focus();
  };


  // Tree items dropped on an edge split this pane that way; dropped in the middle they replace it.
  const zoneOf = (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const d = Math.min(x, 1 - x, y, 1 - y);
    return d > 0.25 ? "center" : d === x ? "left" : d === 1 - x ? "right" : d === y ? "top" : "bottom";
  };
  el.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes(DND)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    p.hint.dataset.zone = zoneOf(e); p.hint.hidden = false;
  });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) p.hint.hidden = true; });
  el.addEventListener("drop", (e) => {
    const raw = e.dataTransfer.getData(DND);
    p.hint.hidden = true;
    if (!raw) return;
    e.preventDefault(); e.stopPropagation();
    const item = JSON.parse(raw), z = zoneOf(e);
    if (z === "center") openIn(p, item.kind, item.id);
    else split(p, z === "left" || z === "right" ? "row" : "col", z === "left" || z === "top", item);
  });
  return p;
}


function commit(p) {
  clearTimeout(p.editTimer);
  if (!p.editing) return;
  if (p.kind === "file") return (p.saving = saveFile(p).finally(() => { p.saving = null; }));
  if (p.kind !== "note") return;
  p.editing = false;
  const n = store.notes[p.itemId];
  if (!n || n.body === p.ta.value) return;
  n.body = p.ta.value; n.updated_at = new Date().toISOString(); n.dirty = true;
  persist(); render(); scheduleSync();
}
const commitAll = () => panes.forEach(commit);

const TEXT_EXT = ["md", "markdown", "txt", "csv", "log", "json", "yml", "yaml", "toml", "tex", "py", "js", "ts", "html", "css", "sh"];
const isEditable = (f) => f.size < 2 * 1024 * 1024 && (f.mime.startsWith("text/") || /json|xml/.test(f.mime) || TEXT_EXT.includes(extOf(f.name)));

// Replaces a text file's content: on disk in the Mac app (the folder sync then uploads it), otherwise in the
// cloud. Throws an error whose message is for the user.
async function writeFileText(f, text) {
  if (local.localPath(f)) {
    try { await local.writeLocal(f, text); } catch (e) {
      console.error(e); throw new Error(t("「{name}」没能写入磁盘：{msg}", { name: baseName(f.name), msg: e.message || e }));
    }
    rendered.delete(versionOf(f));
    return;
  }
  const blob = new Blob([text], { type: f.mime || "text/plain" });
  const now = new Date().toISOString();
  const up = await sb.storage.from("files").upload(f.path, blob, { upsert: true, contentType: f.mime || "text/plain", cacheControl: "0" });
  const meta = isMarkdown(f) ? mdMeta(text) : {};
  const row = up.error ? up : await sb.from("files").update({ size: blob.size, updated_at: now, ...meta }).eq("id", f.id);
  if (up.error || row.error) {
    console.error(up.error || row.error);
    throw new Error(t("「{name}」没保存上，请联网后再改一下或点「完成」重试。", { name: baseName(f.name) }));
  }
  Object.assign(f, { size: blob.size, updated_at: now }, meta);
  forgetUrls(f.path);
  await cacheText(f, text);   // the preview shows exactly what was saved, without downloading it again
}

async function saveFile(p) {
  p.editing = false;
  const f = files.find((x) => x.id === p.itemId), text = p.ta.value;
  if (!f || text === p.fileBase) { setSync("ok", t("已同步")); return; }
  setSync("saving", t("保存中…"));
  try { await writeFileText(f, text); } catch (e) {
    p.editing = true;   // keep it unsaved so the next edit or blur retries
    setSync("err", t("保存失败")); showNote(e.message, "err");
    return;
  }
  p.fileBase = text;
  p.shown = local.localPath(f) ? null : versionOf(f);   // the preview refreshes when editing ends, not now
  setSync("ok", t("已同步")); showNote("");
  if (!p.fileEdit) renderPane(p);
}

// ---------- assistant (public/agent.js) ----------
let openSettings = () => {};   // set with the settings dialog below; takes the id of a section to scroll to
// Everything the assistant's tools may use. Its edits arrive here only after the user pressed 应用.
mountMenu({ ask: (text, _from, question) => askAgent(text, question) });
mountAgent({
  openSettings: (sec) => openSettings(sec),
  notes: visible, files: () => files, titleOf, isText: isEditable, fileText,
  context() {
    const p = focused, item = p?.kind === "note" ? store.notes[p.itemId] : p?.kind === "file" ? files.find((f) => f.id === p.itemId) : null;
    return item ? { id: item.id, kind: p.kind, title: p.kind === "note" ? titleOf(item.body) : baseName(item.name) } : null;
  },
  token: async () => (await sb.auth.getSession()).data.session?.access_token || "",
  async markdown(text) {
    await loadMarkdownLibs();
    // Formulas as in documents: pulled out before Markdown sees them, code spans left alone.
    const math = [], keep = (tex, display) => {
      math.push(window.katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: "html" }));
      return `KATEXMATH${math.length - 1}END`;
    };
    text = text.replace(/\]\(suiji:/g, "](#suiji:").split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, i) => i % 2 ? part : part
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
      .replace(/(?<![\\$\w])\$(?!\s)([^\n$]+?)(?<![\s\\])\$(?!\d)/g, (_, t) => keep(t, false))).join("");
    return window.DOMPurify.sanitize(window.marked.parse(text, { gfm: true, breaks: true }))
      .replace(/KATEXMATH(\d+)END/g, (_, i) => math[i]);
  },
  open(kind, id) { if (isPhone.matches) toggleAgent(false); openIn(focused, kind, id); },
  ui: { open: uiOpen, graph: uiGraph, sidebar: uiSidebar },
  newNote(body) {
    const now = new Date().toISOString(), id = crypto.randomUUID();
    store.notes[id] = { id, body, created_at: now, updated_at: now, deleted: false, dirty: true };
    persist(); render(); scheduleSync();
    return id;
  },
  async apply(d, text) {
    const open = [...panes.values()].filter((p) => p.itemId === d.id);
    if (open.some((p) => p.editing || p.fileEdit)) throw new Error(t("这篇正在编辑，先点「完成」再应用。"));
    if (d.kind === "note") {
      const n = store.notes[d.id];
      n.body = text; n.updated_at = new Date().toISOString(); n.dirty = true;
      persist(); scheduleSync();
      for (const p of open) p.ta.value = text;
      render();
      return;
    }
    await writeFileText(d.file, text);
    for (const p of open) { p.shown = null; renderPane(p); }
    render();
  },
});

// ---------- graph ----------
// Nodes: Markdown files and notes (plus tags when switched on). Edges: [[links]] and relative .md links,
// resolved the way Obsidian does: relative to the file, then from the vault root, then by unique file name.
function graphData(withTags) {
  const nodes = [], edges = new Set(), idx = new Map();
  const add = (key, node) => { if (!idx.has(key)) { idx.set(key, nodes.length); nodes.push(node); } return idx.get(key); };
  const md = files.filter(isMarkdown);
  for (const f of md) add("file:" + f.id, { label: stripMd(baseName(f.name)), kind: "file", ref: f.id });
  const find = linkResolver(md);
  const resolve = (dir, target) => { const f = find(dir, target); return f ? idx.get("file:" + f.id) : undefined; };
  const link = (a, b) => { if (b !== undefined && a !== b) edges.add(a < b ? a + "," + b : b + "," + a); };
  for (const f of md) {
    const i = idx.get("file:" + f.id), dir = f.name.split("/").slice(0, -1);
    for (const l of f.links || []) link(i, resolve(dir, l));
    if (withTags) for (const t of f.tags || []) link(i, add("tag:" + t, { label: "#" + t, kind: "tag", ref: t }));
  }
  for (const n of visible()) {
    const i = add("note:" + n.id, { label: titleOf(n.body), kind: "note", ref: n.id });
    const meta = mdMeta(n.body);
    for (const l of meta.links) link(i, resolve([], l));
    if (withTags) for (const t of meta.tags) link(i, add("tag:" + t, { label: "#" + t, kind: "tag", ref: t }));
  }
  return { nodes, edges: [...edges].map((e) => e.split(",").map(Number)) };
}

function graphKey(p) {
  let latest = "";
  for (const f of files) if ((f.updated_at || "") > latest) latest = f.updated_at;
  return ["graph", files.length, latest, visible().length, p.graphTags ? 1 : 0].join("@");
}

function showGraph(p) {
  p.graph?.destroy();
  const data = graphData(p.graphTags);
  p.meta.textContent = t("关系图谱 · {nodes} 个节点 · {edges} 条链接", { nodes: data.nodes.length, edges: data.edges.length });
  const wrap = document.createElement("div");
  wrap.className = "graph";
  const tools = document.createElement("div");
  tools.className = "graph-tools";
  const tagBtn = Object.assign(document.createElement("button"), { type: "button", className: "ghost bordered small", textContent: p.graphTags ? t("隐藏标签") : t("显示标签") });
  tagBtn.onclick = () => { p.graphTags = !p.graphTags; p.shown = null; saveLayout(); renderPane(p); };
  const fitBtn = Object.assign(document.createElement("button"), { type: "button", className: "ghost bordered small", textContent: t("居中") });
  fitBtn.onclick = () => { p.graphFocus = null; p.graph?.fit(); };
  tools.append(tagBtn, fitBtn);
  wrap.append(tools);
  if (!data.nodes.length) wrap.append(Object.assign(document.createElement("p"), { className: "graph-empty", textContent: t("还没有 Markdown 文件或笔记。") }));
  p.preview.classList.remove("doc");
  p.preview.replaceChildren(wrap);
  p.graph = mountGraph(wrap, data, {
    isActive: (n) => n.kind !== "tag" && [...panes.values()].some((x) => x !== p && x.kind === n.kind && x.itemId === n.ref),
    onOpen: (n) => {
      if (n.kind === "tag") { searchTag(n.ref); return; }
      // Open beside the graph: in another pane if there is one, otherwise in a new pane on the right.
      const other = [...panes.values()].find((x) => x !== p && x.kind !== "graph");
      if (isPhone.matches) openIn(p, n.kind, n.ref);
      else if (other) openIn(other, n.kind, n.ref);
      else split(p, "row", false, { kind: n.kind, id: n.ref });
    },
  });
  if (p.graphFocus) p.graph.focus(p.graphFocus);
}

// ---------- what the assistant can do in the interface ----------
// Its show/open tools (public/agent.js). Each acts at once — nothing here changes a document — and returns
// what happened, for the model.
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// Opens a document where the user can see it: the pane already showing it, else beside a graph (or beside
// the current document when asked), else the focused pane.
function showItem(kind, id, beside) {
  const have = [...panes.values()].find((x) => x.kind === kind && x.itemId === id);
  if (have) { focusPane(have); app.dataset.view = "edit"; return have; }
  if (!isPhone.matches && (beside || focused.kind === "graph") && focused.kind) {
    const other = [...panes.values()].find((x) => x !== focused && x.kind !== "graph");
    if (other && focused.kind === "graph" && !beside) { openIn(other, kind, id); return other; }
    split(focused, "row", false, { kind, id }); return focused;
  }
  openIn(focused, kind, id); return focused;
}
const norm = (x) => String(x || "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
async function uiOpen({ kind, id, heading, beside }) {
  if (isPhone.matches) toggleAgent(false);
  const p = showItem(kind, id, beside);
  if (!heading) return { opened: true };
  const want = norm(heading);
  if (kind === "note") {
    const ta = p.ta, lines = ta.value.split("\n");
    const i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && norm(l).includes(want));
    if (i < 0) return { opened: true, heading: "not found", headings: lines.filter((l) => /^#{1,6}\s/.test(l)).slice(0, 60) };
    const at = lines.slice(0, i).join("\n").length + (i ? 1 : 0);
    ta.focus(); ta.setSelectionRange(at, at + lines[i].length);
    ta.scrollTop = Math.max(0, (i / lines.length) * ta.scrollHeight - 40);
    return { opened: true, heading: lines[i] };
  }
  // A file renders asynchronously; wait for its headings.
  for (let n = 0; n < 60 && !(p.itemId === id && p.heads.length); n++) await sleepMs(100);
  const i = p.heads.findIndex((h) => norm(h.textContent).includes(want));
  if (i < 0) return { opened: true, heading: "not found", headings: p.heads.slice(0, 60).map((h) => h.textContent.trim()) };
  const h = p.heads[i], top = p.preview.getBoundingClientRect().top;
  p.preview.scrollTo({ top: p.preview.scrollTop + h.getBoundingClientRect().top - top - 12, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  h.classList.remove("ag-flash"); void h.offsetWidth; h.classList.add("ag-flash");
  return { opened: true, heading: h.textContent.trim() };
}
async function uiGraph({ ids, query, tag }) {
  if (isPhone.matches) toggleAgent(false);
  let g = [...panes.values()].find((x) => x.kind === "graph");
  if (g) { focusPane(g); app.dataset.view = "edit"; }
  else if (!isPhone.matches && focused.kind) { split(focused, "row", false, { kind: "graph", id: "all" }); g = focused; }
  else { openIn(focused, "graph", "all"); g = focused; }
  const idSet = new Set(ids || []), q = norm(query), tg = norm(tag).replace(/^#/, "");
  const pathOf = new Map(files.map((f) => [f.id, fullPath(f).join("/").toLowerCase()]));
  const match = (n) => idSet.has(n.ref)
    || (q && n.kind !== "tag" && (n.label.toLowerCase().includes(q) || (pathOf.get(n.ref) || "").includes(q)))
    || (tg && n.kind === "tag" && n.ref.toLowerCase() === tg);
  if (tg && !g.graphTags) { g.graphTags = true; g.shown = null; }
  g.graphFocus = idSet.size || q || tg ? match : null;
  if (g.shown == null) renderPane(g);   // a fresh graph applies graphFocus when it is built
  const labels = g.graphFocus ? g.graph.focus(match) : (g.graph.fit(), []);
  if (g.graphFocus && !labels.length) g.graphFocus = null;
  saveLayout();
  return { shown: true, focused: labels.length, nodes: labels.slice(0, 30) };
}
async function uiSidebar({ kind, id, folder, filter }) {
  if (isPhone.matches) { toggleAgent(false); commitAll(); app.dataset.view = "list"; }
  if (filter != null) { search.value = filter; renderList(); return { filtered: filter, matches: list.querySelectorAll(".tree-file").length }; }
  search.value = "";
  let segs = null;
  if (kind === "note") expanded.add(NOTES_KEY);
  else if (kind === "file") { const f = files.find((x) => x.id === id); if (!f) return { error: "no such file" }; segs = fullPath(f).slice(0, -1); }
  else if (folder) segs = String(folder).split("/").filter(Boolean);
  for (let i = 1; segs && i <= segs.length; i++) expanded.add(segs.slice(0, i).join("/"));
  saveExpanded(); renderList();
  const row = id ? list.querySelector(`.tree-file[data-id="${CSS.escape(id)}"]`)
    : [...list.querySelectorAll(".tree-folder")].find((b) => b.nextElementSibling && segs && b.querySelector(".tree-name")?.textContent === segs.at(-1));
  if (!row) return { error: "not found in the sidebar" };
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("ag-flash"); void row.offsetWidth; row.classList.add("ag-flash");
  return { shown: true };
}

function renderPane(p) {
  if (p.kind === "note" && !(store.notes[p.itemId] && !store.notes[p.itemId].deleted)) p.kind = p.itemId = null;
  if (p.kind === "file" && filesLoaded && !files.some((f) => f.id === p.itemId)) p.kind = p.itemId = null;
  p.el.classList.toggle("empty", !p.kind);
  navState(p);   // documents in its history may have arrived (the file list) or gone since
  const note = p.kind === "note" && store.notes[p.itemId];
  const file = p.kind === "file" && files.find((f) => f.id === p.itemId);
  const waiting = p.kind === "file" && !file;   // files list not loaded yet
  if (p.kind !== "graph" && p.graph) { p.graph.destroy(); p.graph = null; }
  if (p.kind === "graph") {
    p.ta.hidden = true; p.ph.hidden = true; p.fv.hidden = false; p.dl.hidden = true; p.edit.hidden = true; p.web.hidden = true;
    setToc(p, null);
    const key = graphKey(p);
    if (p.shown !== key) { p.shown = key; showGraph(p); }
    return;
  }
  const editingFile = !!file && p.fileEdit;
  if (!file) p.fileEdit = false;
  p.ta.hidden = !(note || editingFile); p.fv.hidden = !file || editingFile; p.ph.hidden = !!(note || file || waiting);
  p.dl.hidden = !file; p.del.hidden = !note;
  if (!file || editingFile) p.web.hidden = true;
  p.edit.hidden = !(file && isEditable(file)); editLabel(p, editingFile ? t("完成") : t("编辑"), editingFile);
  applyToc(p);
  p.ta.placeholder = file ? "" : t("第一行是标题…");
  if (!note && !file) {
    p.meta.textContent = waiting ? t("载入中…") : ""; p.shown = null;
    if (p === focused && !p.kind) app.dataset.view = "list";
    return;
  }
  if (note) {
    p.shown = null;
    p.meta.textContent = t("修改于 {time}", { time: fmt(note.updated_at) });
    // Never overwrite what the user is in the middle of typing.
    if (!p.editing && p.ta.value !== note.body) p.ta.value = note.body;
    return;
  }
  if (editingFile) { p.meta.textContent = t("{name} · 编辑中，自动保存", { name: baseName(file.name) }); return; }
  const key = versionOf(file);
  if (p.shown !== key) { p.shown = key; showFile(file, p); }
}
function render() { renderList(); panes.forEach(renderPane); }
// Moves the tree highlight without rebuilding the tree (rebuilding makes it flicker).
function markCurrent() {
  for (const b of list.querySelectorAll(".tree-file[data-id]")) {
    const { kind, id } = b.dataset;
    b.setAttribute("aria-current", String(!!focused && focused.kind === kind && focused.itemId === id));
    b.classList.toggle("shown", [...panes.values()].some((p) => p.kind === kind && p.itemId === id));
  }
  for (const p of panes.values()) p.graph?.redraw();
}

function openIn(p, kind, id, fromHist) {
  focusPane(p);
  app.dataset.view = "edit";
  if (p.kind === kind && p.itemId === id) { if (kind === "note" && !isPhone.matches) p.ta.focus(); return; }
  const pending = p.restoreTop;   // left before it scrolled back to where it was: keep that place
  delete p.restoreTop;
  if (!fromHist) {
    if (p.kind && p.hi >= 0) p.hist[p.hi] = pending ? { kind: p.kind, id: p.itemId, top: pending } : here(p);
    p.hist.splice(p.hi + 1, Infinity, { kind, id, top: 0 });
    if (p.hist.length > 100) p.hist.shift();
    p.hi = p.hist.length - 1;
  }
  navState(p);
  commit(p); closeMenu(p);
  const left = p.kind === "note" && p.itemId;
  p.kind = kind; p.itemId = id; p.shown = null; p.shownId = null; p.fileEdit = false; p.editing = false;
  if (kind === "note") p.ta.value = store.notes[id]?.body || "";
  saveLayout(); markCurrent(); renderPane(p); dropIfEmpty(left);
  if (kind === "note" && !isPhone.matches) p.ta.focus();
}
function openFile(id) { openIn(focused, "file", id); }
// A note left empty (New, then off to something else) is thrown away rather than kept as 无标题 forever.
function dropIfEmpty(id) {
  const n = id && store.notes[id];
  if (!n || n.deleted || n.body.trim() || [...panes.values()].some((x) => x.kind === "note" && x.itemId === id)) return;
  Object.assign(n, { deleted: true, updated_at: new Date().toISOString(), dirty: true });
  persist(); renderList(); scheduleSync();
}
// Back and forward, per pane, like a browser's: the documents opened in it, each where it was scrolled to.
const scroller = (p) => p.kind === "note" || p.fileEdit ? p.ta : p.preview;
const here = (p) => ({ kind: p.kind, id: p.itemId, top: scroller(p).scrollTop });
const exists = (h) => h.kind === "note" ? store.notes[h.id] && !store.notes[h.id].deleted : h.kind === "file" ? files.some((f) => f.id === h.id) : true;
function navState(p) { p.prev.disabled = !p.hist.slice(0, p.hi).some(exists); p.next.disabled = !p.hist.slice(p.hi + 1).some(exists); }
async function goHist(p, d) {
  let i = p.hi + d;
  while (p.hist[i] && !exists(p.hist[i])) i += d;   // skip documents deleted since
  const to = p.hist[i];
  if (!to) return;
  if (p.kind && p.hi >= 0) p.hist[p.hi] = p.restoreTop ? { kind: p.kind, id: p.itemId, top: p.restoreTop } : here(p);
  p.hi = i;
  openIn(p, to.kind, to.id, true);
  scrollBack(p, to.id, to.top);
}
// A file renders asynchronously (and at startup the file list loads first): wait until the document is tall
// enough to scroll back to where it was, unless it was closed or scrolled by hand in the meantime.
async function scrollBack(p, id, top, tries = 80) {
  if (!top) return;
  let moved = false;
  const stop = () => { moved = true; }, on = ["wheel", "touchstart", "keydown", "pointerdown"];
  for (const t of on) p.el.addEventListener(t, stop, { passive: true });
  try {
    for (let n = 0; n < tries && !moved && p.itemId === id; n++) {
      const el = scroller(p), ready = el !== p.preview || p.shownId === id;   // a file's own text, not the one before
      if (ready && el.scrollHeight - el.clientHeight >= top || n === tries - 1) { el.scrollTop = top; return; }
      await sleepMs(75);
    }
  } finally { for (const t of on) p.el.removeEventListener(t, stop); }
}
// ⌘[ / ⌘] (and ⌘⌥← / ⌘⌥→, as in Obsidian), and a mouse's back and forward buttons, in the focused pane.
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || !focused) return;
  const d = e.key === "[" || e.altKey && e.key === "ArrowLeft" ? -1 : e.key === "]" || e.altKey && e.key === "ArrowRight" ? 1 : 0;
  if (!d || e.altKey !== e.key.startsWith("Arrow")) return;
  e.preventDefault(); goHist(focused, d);
});
// ⌘O (Obsidian's quick switcher; ⌘K is already a link in the editor) jumps to the search box with what was
// typed there selected. On phones the sidebar slides in first.
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "o" || $("settings").open) return;
  e.preventDefault();
  if (isPhone.matches) app.dataset.view = "list";
  search.focus(); search.select();
});
// WebKit doesn't pass a mouse's side buttons to the page, so the Mac app catches them and calls this.
window.suijiNav = (d) => { if (focused) goHist(focused, d); };
addEventListener("mouseup", (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();   // otherwise the browser itself goes back, out of the app
  const p = [...panes.values()].find((x) => x.el.contains(e.target)) || focused;
  if (p) goHist(p, e.button === 3 ? -1 : 1);
});
// Android's back button: closes what is open (settings, a ⋯ menu, an outline over the text), then goes from a
// document to the sidebar. false means nothing was left to close, and the app goes to the background.
window.suijiBack = () => {
  if ($("settings").open) { $("settings").close(); return true; }
  for (const p of panes.values()) if (p.acts.classList.contains("menu")) { closeMenu(p); return true; }
  if (focused?.tocNarrow && !focused.toc.hidden) { focused.tocNarrow = false; applyToc(focused); return true; }
  if (isPhone.matches && app.dataset.view !== "list") { commitAll(); app.dataset.view = "list"; return true; }
  return false;
};
function closeMenu(p) { p.acts.classList.remove("menu"); p.more.setAttribute("aria-expanded", "false"); }
document.addEventListener("pointerdown", (e) => { for (const p of panes.values()) if (!p.acts.contains(e.target)) closeMenu(p); });
// Shows the files with a tag; on a phone that means opening the sidebar.
function searchTag(tag) {
  search.value = "#" + tag; renderList();
  if (isPhone.matches) { commitAll(); app.dataset.view = "list"; }
}

function focusPane(p) {
  if (focused === p) return;
  focused = p;
  for (const x of panes.values()) x.el.classList.toggle("focused", x === p);
  if (isPhone.matches) buildLayout();
  saveLayout(); markCurrent();
}

const firstPane = (n) => n.pane || firstPane(n.a);
const replaceNode = (tree, target, repl) => tree === target ? repl
  : tree.pane ? tree : Object.assign(tree, { a: replaceNode(tree.a, target, repl), b: replaceNode(tree.b, target, repl) });
const findLeaf = (tree, p) => tree.pane ? (tree.pane === p ? tree : null) : findLeaf(tree.a, p) || findLeaf(tree.b, p);
const parentOf = (tree, node) => tree.pane ? null : tree.a === node || tree.b === node ? tree : parentOf(tree.a, node) || parentOf(tree.b, node);

function split(p, dir, before, item) {
  commit(p);
  const np = makePane(item || null);
  const leaf = findLeaf(layout, p), fresh = { pane: np }, self = { pane: p };
  layout = replaceNode(layout, leaf, { dir, ratio: 0.5, a: before ? fresh : self, b: before ? self : fresh });
  focused = np;
  buildLayout(); saveLayout(); render();
  if (np.kind === "note") np.ta.focus();
}

function closePane(p) {
  if (panes.size < 2) return;
  commit(p);
  const leaf = findLeaf(layout, p), parent = parentOf(layout, leaf);
  const sibling = parent.a === leaf ? parent.b : parent.a;
  layout = replaceNode(layout, parent, sibling);
  panes.delete(p.id); p.el.remove(); p.graph?.destroy(); paneSizes.unobserve(p.el);
  if (focused === p) focused = firstPane(sibling);
  buildLayout(); saveLayout(); render();
  if (p.kind === "note") dropIfEmpty(p.itemId);
}

// ---------- sidebar width ----------
// Drag the handle between the sidebar and the panes; double-click resets it, arrow keys nudge it.
const SIDE_MIN = 220, SIDE_DEFAULT = 320;
const sideMax = () => Math.max(SIDE_MIN, Math.min(560, (app.clientWidth || innerWidth) - 380));   // the app is hidden until sign-in
function setSide(px, save) {
  const w = Math.round(Math.min(sideMax(), Math.max(SIDE_MIN, px)));
  app.style.setProperty("--side", w + "px");
  if (save) try { localStorage.setItem("suiji:side", String(w)); } catch {}
}
try { const w = +localStorage.getItem("suiji:side"); if (w) setSide(w); } catch {}
addEventListener("resize", () => { const w = parseFloat(app.style.getPropertyValue("--side")); if (w > sideMax()) setSide(w); });
{
  const h = $("sideHandle");
  h.onpointerdown = (e) => {
    e.preventDefault();
    const left = app.getBoundingClientRect().left;
    document.body.classList.add("resizing", "resizing-row");
    const move = (ev) => setSide(ev.clientX - left - 6);
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row");
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      setSide(parseFloat(app.style.getPropertyValue("--side")) || SIDE_DEFAULT, true);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  h.ondblclick = () => setSide(SIDE_DEFAULT, true);
  h.onkeydown = (e) => {
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (d) { e.preventDefault(); setSide((parseFloat(app.style.getPropertyValue("--side")) || SIDE_DEFAULT) + d, true); }
  };
}

function buildLayout() {
  // Moving a pane's element to a new place in the page resets its scrolling, so note it first and put it back.
  // As a share of the way through: a pane that gets narrower or wider reflows its text.
  const at = (el) => el.scrollTop / Math.max(1, el.scrollHeight);
  const kept = [...panes.values()].map((p) => [p, at(p.ta), at(p.preview), p.tocList?.scrollTop || 0]);
  const mk = (node) => {
    if (node.pane) { node.pane.el.classList.toggle("focused", node.pane === focused); return node.pane.el; }
    const box = document.createElement("div");
    box.className = "split " + node.dir;
    const a = mk(node.a), b = mk(node.b);
    const size = () => { a.style.flex = `${node.ratio} 1 0`; b.style.flex = `${1 - node.ratio} 1 0`; };
    size();
    const bar = document.createElement("div");
    bar.className = "divider"; bar.setAttribute("role", "separator");
    bar.setAttribute("aria-orientation", node.dir === "row" ? "vertical" : "horizontal");
    bar.onpointerdown = (e) => {
      e.preventDefault();
      const r = box.getBoundingClientRect(), row = node.dir === "row";
      document.body.classList.add("resizing", row ? "resizing-row" : "resizing-col");
      const move = (ev) => {
        const t = row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        node.ratio = Math.min(0.85, Math.max(0.15, t)); size();
      };
      const up = () => {
        document.body.classList.remove("resizing", "resizing-row", "resizing-col");
        removeEventListener("pointermove", move); removeEventListener("pointerup", up); saveLayout();
      };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    };
    bar.ondblclick = () => { node.ratio = 0.5; size(); saveLayout(); };
    box.append(a, bar, b);
    return box;
  };
  const root = isPhone.matches ? focused.el : mk(layout);
  root.style.flex = "1 1 0";
  ws.replaceChildren(root);
  ws.dataset.multi = String(panes.size > 1);
  for (const [p, ta, pv, toc] of kept) {
    p.ta.scrollTop = ta * p.ta.scrollHeight; p.preview.scrollTop = pv * p.preview.scrollHeight;
    if (p.tocList) p.tocList.scrollTop = toc;
  }
}
isPhone.addEventListener("change", () => layout && buildLayout());

// The panes as they were when the app was last closed: what each shows, where it was scrolled to, and its
// back / forward history (up to 30 entries).
const layoutKey = () => "suiji:layout:" + uid;
function saveLayout() {
  const pane = (p) => {
    const top = p.restoreTop || (p.kind ? Math.round(scroller(p).scrollTop) : 0);   // still waiting to scroll back: keep that
    if (p.kind && p.hi >= 0) p.hist[p.hi] = { kind: p.kind, id: p.itemId, top };
    const from = Math.max(0, p.hi - 20), h = p.hist.slice(from, from + 30);
    return { kind: p.kind, id: p.itemId, f: p === focused ? 1 : 0, t: p.graphTags ? 1 : 0, o: p.tocOpen ? 1 : 0, top, h, hi: p.hi - from };
  };
  const ser = (n) => n.pane ? pane(n.pane) : { dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) };
  try { localStorage.setItem(layoutKey(), JSON.stringify(ser(layout))); } catch {}
}
function restoreLayout() {
  for (const p of panes.values()) { p.el.remove(); p.graph?.destroy(); }
  panes.clear(); focused = null;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(layoutKey())); } catch {}
  const de = (s) => {
    if (!s || !s.dir) {
      const p = makePane(s && s.kind ? { kind: s.kind, id: s.id } : null);
      if (s && s.f) focused = p;
      p.graphTags = !!(s && s.t);
      p.tocOpen = s && "o" in s ? s.o !== 0 : tocAuto;   // each pane keeps its own outline open or closed
      if (Array.isArray(s?.h) && s.h[s.hi]?.id === s.id) { p.hist = s.h.filter((x) => x && x.kind); p.hi = Math.min(s.hi, p.hist.length - 1); navState(p); }
      if (s?.top) p.restoreTop = s.top;
      return { pane: p };
    }
    return { dir: s.dir === "col" ? "col" : "row", ratio: Math.min(0.85, Math.max(0.15, +s.ratio || 0.5)), a: de(s.a), b: de(s.b) };
  };
  layout = de(saved);
  focused ||= firstPane(layout);
  buildLayout();
  for (const p of panes.values()) if (p.restoreTop) scrollBack(p, p.itemId, p.restoreTop, 160).finally(() => { delete p.restoreTop; });
}
// Scrolling is saved a moment after it stops, and once more when the page goes away (window closed, app quit).
let saveSoon = 0;
const saveLater = () => { clearTimeout(saveSoon); saveSoon = setTimeout(saveLayout, 500); };
addEventListener("pagehide", () => layout && saveLayout());
document.addEventListener("visibilitychange", () => { if (document.hidden && layout) saveLayout(); });

$("newBtn").onclick = () => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  store.notes[id] = { id, body: "", created_at: now, updated_at: now, deleted: false, dirty: true };
  persist(); search.value = "";
  expanded.add(NOTES_KEY); saveExpanded();
  openIn(focused, "note", id); focused.ta.focus();
  scheduleSync();
};

$("graphBtn").onclick = () => {
  // One graph is enough: focus it if it is already open.
  const g = [...panes.values()].find((x) => x.kind === "graph");
  if (g) { focusPane(g); app.dataset.view = "edit"; return; }
  openIn(focused, "graph", "all");
};
$("foldBtn").onclick = () => {
  expanded = new Set(expanded.size ? [] : [NOTES_KEY, ...folderKeys()]);
  saveExpanded(); renderList();
};
// Phones: the sidebar is a drawer. A tap beside it, Escape or a swipe to the left closes it; a swipe in
// from the left edge opens it.
const closeDrawer = () => { if (app.dataset.view === "list") app.dataset.view = "edit"; };
$("scrim").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isPhone.matches && !$("settings").open) closeDrawer(); });
{
  let x0 = null, y0 = 0;
  addEventListener("touchstart", (e) => {
    const pt = e.touches[0];
    x0 = isPhone.matches && e.touches.length === 1 && (app.dataset.view === "list" || pt.clientX < 24) ? pt.clientX : null;
    y0 = pt.clientY;
  }, { passive: true });
  addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const pt = e.changedTouches[0], dx = pt.clientX - x0, dy = pt.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * .7) return;
    if (dx < 0) closeDrawer();
    else if (app.dataset.view !== "list") { commitAll(); app.dataset.view = "list"; }
  }, { passive: true });
}
$("upBtn").onclick = () => $("fileInput").click();
$("fileInput").addEventListener("change", (e) => { const fl = e.target.files; if (fl.length) uploadFiles(fl); e.target.value = ""; });
$("folderBtn").onclick = () => $("folderInput").click();
$("folderInput").addEventListener("change", (e) => { const fl = e.target.files; if (fl.length) uploadFiles(fl); e.target.value = ""; });

// Drag files from Finder anywhere onto the window, or paste them.
let dragDepth = 0;
const hasFiles = (e) => uid && [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("dropzone").hidden = false; });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $("dropzone").hidden = true; } });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $("dropzone").hidden = true;
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});
window.addEventListener("paste", (e) => {
  if (!uid || document.activeElement?.tagName === "TEXTAREA") return;
  const fl = e.clipboardData?.files;
  if (fl && fl.length) { e.preventDefault(); uploadFiles(fl); }
});
search.addEventListener("input", () => { renderList(); if (search.value.trim() && filesLoaded) warmBodies(); });
// From the keyboard: Enter in the search box opens the first hit, ↓ moves into the list, and ↑ / ↓ step
// through the rows that are showing (↑ from the top row goes back to the search box).
const shownRows = () => [...list.querySelectorAll(".tree-row")].filter((r) => !r.closest(".drawer:not(.open)"));
search.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "Enter" && search.value.trim()) { e.preventDefault(); list.querySelector(".tree-file")?.click(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); shownRows()[0]?.focus(); }
});
list.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" || !e.target.closest(".tree-row")) return;
  e.preventDefault();
  const rows = shownRows(), i = rows.indexOf(e.target) + (e.key === "ArrowDown" ? 1 : -1);
  (i < 0 ? search : rows[Math.min(i, rows.length - 1)])?.focus();
});
const sortSel = $("sortSel");
sortSel.value = sortBy;
sortSel.onchange = () => {
  sortBy = sortSel.value;
  try { localStorage.setItem("suiji:sort", sortBy); } catch {}
  renderList();
};
// ---------- local folders (Mac app) ----------
// Files the folder sync wrote: their text on disk changed, maybe before their row did, so drop what was drawn.
function localChanged(keys) {
  for (const f of files) if (keys.has(f.local_key)) rendered.delete(versionOf(f));
  for (const p of panes.values()) {
    const f = p.kind === "file" && files.find((x) => x.id === p.itemId);
    if (f && keys.has(f.local_key) && !p.fileEdit) { p.shown = null; renderPane(p); }
  }
  loadFiles();
}
const LOCAL_STATUS = { syncing: "同步中…", ok: "已同步", offline: "离线 · 联网后同步", error: "同步出错，稍后重试" };
let localState = "";
function localStatus(s) {
  if (s) localState = s;
  const n = local.listFolders().length;
  if (!$("localInfo") || !n) return;
  const line = local.lastLine();
  $("localInfo").textContent = t(LOCAL_STATUS[localState] || "已同步") + (line ? " · " + line : "");
}

// ---------- settings ----------
// One dialog for the per-device preferences, sync, the local cache, the account and updates.
let tocAuto = true;
try { tocAuto = localStorage.getItem("suiji:toc-auto") !== "0"; } catch {}
// After a style or light / dark change: diagrams and cached renders were drawn with the old colours.
function restyled() {
  mermaidLib = null; rendered.clear();
  for (const p of panes.values()) { if (p.kind === "file") { p.shown = null; renderPane(p); } p.graph?.redraw(); }
}
{
  const dlg = $("settings");
  const px = (v) => Math.round(v) + "px";
  async function cacheSummary() {
    let n = 0;
    try { n = (await (await caches.open(FILE_CACHE)).keys()).length; } catch {}
    const est = await navigator.storage?.estimate?.().catch(() => null);
    $("cacheInfo").textContent = t("{n} 个文档已存在本机", { n }) + (est?.usage ? t(" · 共用 {size}", { size: fmtSize(est.usage) }) : "") + t("，离线也能打开");
  }
  function fill() {
    $("tocAuto").checked = tocAuto;
    $("widthInfo").textContent = t("侧边栏 {side} · 大纲 {toc}，拖动边缘调整，双击恢复", { side: px(parseFloat(app.style.getPropertyValue("--side")) || SIDE_DEFAULT), toc: px(tocWidth()) });
    $("setSync").textContent = $("syncText").textContent;
    $("setCounts").textContent = t("{notes} 条随手记 · {files} 个文件", { notes: visible().length, files: files.length });
    $("setWho").textContent = $("who").textContent;
    loadedVersion.then((v) => { $("verInfo").textContent = t("版本 {v}", { v: v ? v.replace(/^suiji-/, "") : t("未知") }); });
    cacheSummary();
  }
  function fillLocal() {
    const ul = $("localList");
    ul.replaceChildren(...local.listFolders().map((root) => {
      const li = document.createElement("li"), name = document.createElement("span"), rm = document.createElement("button");
      name.textContent = root.replace(/^\/Users\/[^/]+/, "~"); name.title = root;
      rm.type = "button"; rm.className = "ghost bordered small"; rm.textContent = t("停止同步");
      rm.onclick = async () => {
        if (!confirm(t("停止同步「{name}」？云端已有的文件会保留。", { name: root.split("/").pop() }))) return;
        await local.removeFolder(root); fillLocal();
      };
      li.append(name, rm); return li;
    }));
    localStatus();
  }
  $("localSec").hidden = !local.available;
  $("localAdd").onclick = async () => { await local.addFolder(); fillLocal(); };
  // Settings → Assistant: the user's own key for any OpenAI-compatible API, kept encrypted by api/ai-key.js.
  // The key never comes back to the page; only its last four characters.
  const AI_PRESETS = {
    deepseek: { base: "https://api.deepseek.com", model: "deepseek-flash" },
    openrouter: { base: "https://openrouter.ai/api/v1", hint: "deepseek/deepseek-chat" },
    moonshot: { base: "https://api.moonshot.cn/v1", hint: "kimi-…" },
    zhipu: { base: "https://open.bigmodel.cn/api/paas/v4", hint: "glm-…" },
    dashscope: { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", hint: "qwen-…" },
    openai: { base: "https://api.openai.com/v1", hint: "gpt-…" },
    custom: { base: "", hint: "" },
    // On this computer: the page calls these itself and keeps their settings on this device only.
    magpie: { base: "http://127.0.0.1:3425/v1", hint: "deepseek/deepseek-flash", local: true },
    localapi: { base: "http://127.0.0.1:11434/v1", hint: t("模型名称"), local: true },
  };
  const isLocalPreset = (name) => !!AI_PRESETS[name]?.local;
  let aiOwn = null, aiLast = { own: null, fallback: null };
  const aiApi = async (method, body) => {
    const res = await fetch("/api/ai-key", { method, headers: { "content-type": "application/json", authorization: "Bearer " + ((await sb.auth.getSession()).data.session?.access_token || "") }, body: body && JSON.stringify(body) });
    const out = await res.json().catch(() => ({ error: "HTTP " + res.status }));
    if (!res.ok) throw new Error(out.error || "HTTP " + res.status);
    return out;
  };
  const aiMsg = (text, bad) => { $("aiMsg").textContent = text; $("aiMsg").classList.toggle("bad", !!bad); };
  function aiPreset(name, keepModel) {
    const p = AI_PRESETS[name];
    $("aiPreset").value = name;
    $("aiBase").readOnly = !(name === "custom" || p.local);
    if (name !== "custom") $("aiBase").value = p.base;
    $("aiFetch").hidden = !p.local;
    if (!keepModel) $("aiModel").value = p.model || "";
    $("aiModel").placeholder = p.model || p.hint || t("模型名称");
  }
  function aiShow(st) {
    aiLast = st; aiOwn = st.own;
    const lc = localModel();
    $("aiForm").hidden = !!lc?.magpie;
    if (lc?.magpie) {
      $("aiState").textContent = t("由 Magpie 接入（{m}）", { m: lc.model });
      $("aiInfo").textContent = t("在 Magpie 的 Agent 页面里换模型或断开。");
      $("aiRemove").hidden = true;
      return;
    }
    if (lc) {
      $("aiState").textContent = t("使用本机模型（{m}）", { m: lc.model });
      $("aiInfo").textContent = t("只在这台设备上：直接连接 {host}，不经过服务器。", { host: lc.base.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "") });
      $("aiRemove").hidden = false;
      $("aiKey").value = ""; $("aiKey").placeholder = lc.key ? t("留空则保留已保存的 key") : t("网关 key（没有可留空）");
      $("aiKey").required = false;
      aiPreset(isLocalPreset(lc.preset) ? lc.preset : "localapi", true); $("aiBase").value = lc.base; $("aiModel").value = lc.model;
      return;
    }
    $("aiState").textContent = st.own ? t("使用你的 key（…{h}）", { h: st.own.hint }) : st.fallback ? t("使用默认 key") : t("还没有设置");
    $("aiInfo").textContent = st.own ? st.own.model + " · " + new URL(st.own.base_url).host
      : st.fallback ? t("你的账号可以用服务器上的 DeepSeek key（{m}）；也可以填你自己的。", { m: st.fallback.model })
      : t("用你自己的 API key，支持任何 OpenAI 兼容接口。key 加密保存在你的账号里，换设备也能用。");
    $("aiRemove").hidden = !st.own;
    $("aiKey").value = ""; $("aiKey").placeholder = st.own ? t("留空则保留已保存的 key") : "sk-…";
    $("aiKey").required = !st.own;
    if (st.own) {
      const name = Object.keys(AI_PRESETS).find((k) => k !== "custom" && AI_PRESETS[k].base === st.own.base_url) || "custom";
      aiPreset(name, true); $("aiBase").value = st.own.base_url; $("aiModel").value = st.own.model;
    } else aiPreset($("aiPreset").value || "deepseek");
  }
  async function fillAi() {
    aiMsg("");
    await refreshMagpie();
    try { aiShow(await aiApi("GET")); } catch (e) { $("aiState").textContent = t("读取失败：{msg}", { msg: e.message }); }
  }
  $("aiPreset").onchange = () => {
    aiPreset($("aiPreset").value);
    const local = isLocalPreset($("aiPreset").value);
    $("aiKey").required = !local && !aiOwn;
    if (local) $("aiKey").placeholder = localModel()?.key ? t("留空则保留已保存的 key") : t("网关 key（没有可留空）");
  };
  // The models a local server offers, as suggestions for the model field.
  $("aiFetch").onclick = async () => {
    const base = $("aiBase").value.trim().replace(/\/+$/, ""), key = $("aiKey").value.trim() || localModel()?.key || "";
    aiMsg(t("读取中…"));
    try {
      const res = await localHttp(base + "/models", { headers: key ? { authorization: "Bearer " + key } : {} });
      let body = {}; try { body = JSON.parse(res.text); } catch {}
      if (res.status < 200 || res.status >= 300) throw new Error(body.error?.message || "HTTP " + res.status);
      const ids = (body.data || []).map((m) => m.id).filter(Boolean).sort();
      $("aiModels").replaceChildren(...ids.map((id) => Object.assign(document.createElement("option"), { value: id })));
      aiMsg(t("找到 {n} 个模型，在「模型」里选一个。", { n: ids.length }));
      $("aiModel").focus();
    } catch (err) { aiMsg(localHelp(err), true); }
  };
  // A page can only reach Magpie once Magpie lists it; say so instead of a bare network error.
  const localHelp = (err) => $("aiPreset").value === "magpie" && local.available
    ? t("连不上 Magpie：{msg}。确认 Magpie 正在运行，再用 magpie gateway-key add suiji 生成一个 key 填进来。", { msg: err.message })
    : $("aiPreset").value === "magpie"
    ? t("连不上 Magpie：{msg}。先在 Magpie 的 Settings → Network and sharing → Web pages 里加上 {origin}，再用 magpie gateway-key add suiji 生成一个 key 填进来。", { msg: err.message, origin: location.origin })
    : t("连不上 {base}：{msg}", { base: $("aiBase").value.trim(), msg: err.message });
  $("aiForm").onsubmit = async (e) => {
    e.preventDefault();
    const key = $("aiKey").value.trim();
    if (isLocalPreset($("aiPreset").value)) {
      const base = $("aiBase").value.trim().replace(/\/+$/, ""), model = $("aiModel").value.trim();
      if (!/^https?:\/\/[^/]+/.test(base)) { aiMsg(t("接口地址要以 http:// 或 https:// 开头"), true); return; }
      setLocalModel({ preset: $("aiPreset").value, base, model, key: key || localModel()?.key || "" });
      aiShow(aiLast); aiMsg(t("已保存（只在这台设备上）"));
      return;
    }
    setLocalModel(null);   // a key in the account replaces this device's local model
    $("aiSave").disabled = true; aiMsg(t("保存中…"));
    try {
      aiShow(await aiApi("PUT", { base_url: $("aiBase").value.trim(), model: $("aiModel").value.trim(), ...(key ? { api_key: key } : {}) }));
      aiMsg(t("已保存"));
    } catch (err) { aiMsg(t("保存失败：{msg}", { msg: err.message }), true); }
    $("aiSave").disabled = false;
  };
  $("aiRemove").onclick = async () => {
    if (localModel()) { setLocalModel(null); aiShow(aiLast); aiMsg(t("已改回不用本机模型")); return; }
    if (!confirm(t("删除保存的 API key？"))) return;
    try { aiShow(await aiApi("DELETE")); aiMsg(t("已删除")); } catch (err) { aiMsg(t("删除失败：{msg}", { msg: err.message }), true); }
  };
  openSettings = (sec) => {
    fill(); if (local.available) fillLocal(); fillAi(); dlg.showModal();
    if (sec) requestAnimationFrame(() => $(sec)?.scrollIntoView({ block: "start" }));
  };
  $("setBtn").onclick = () => openSettings();
  $("setClose").onclick = () => dlg.close();
  // A click on the backdrop closes it, but only one that also started there: dragging to select text in a
  // field and letting go outside the panel must not throw away what was typed.
  const outside = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  let downOutside = false;
  dlg.addEventListener("pointerdown", (e) => { downOutside = e.target === dlg && outside(e); });
  dlg.addEventListener("click", (e) => { if (downOutside && e.target === dlg && outside(e)) dlg.close(); downOutside = false; });
  // Arrow keys move through each group of choices and pick as they go, like any radio group. The language is
  // the exception: picking it reloads the page, so there the arrows only move and Enter or Space picks.
  dlg.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const b = e.target.closest?.('[role="radio"]'), g = b?.closest('[role="radiogroup"]');
    if (!d || !g) return;
    e.preventDefault();
    const all = [...g.querySelectorAll('[role="radio"]')], next = all[(all.indexOf(b) + d + all.length) % all.length];
    next.focus();
    if (g.id !== "langChoices") next.click();
  });
  $("styleChoices").onclick = (e) => {
    const b = e.target.closest("[data-style]");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    applyStyle(b.dataset.style, true);
    restyled();
  };
  $("modeChoices").onclick = (e) => {
    const b = e.target.closest("[data-mode]");
    if (b && b.dataset.mode !== modeChoice) { applyMode(b.dataset.mode, true); restyled(); }
  };
  $("fontChoices").onclick = (e) => { const b = e.target.closest("[data-size]"); if (b) applyFont(+b.dataset.size, true); };
  for (const b of $("langChoices").querySelectorAll("[data-lang]")) b.setAttribute("aria-checked", String(b.dataset.lang === langChoice));
  $("langChoices").onclick = async (e) => {
    const b = e.target.closest("[data-lang]");
    if (!b || b.dataset.lang === langChoice) return;
    try { b.dataset.lang ? localStorage.setItem("suiji:lang", b.dataset.lang) : localStorage.removeItem("suiji:lang"); } catch {}
    // Text drawn by the app follows the language from the start, so a reload is simplest; edits are saved first.
    commitAll();
    await Promise.all([...panes.values()].map((p) => p.saving));
    location.reload();
  };
  $("tocAuto").onchange = (e) => {
    tocAuto = e.target.checked;
    try { localStorage.setItem("suiji:toc-auto", tocAuto ? "1" : "0"); } catch {}
  };
  $("resetWidths").onclick = () => {
    setSide(SIDE_DEFAULT, true); setTocWidth(TOC_DEFAULT, null, true); refitTocs();
    fill();
  };
  $("syncNow").onclick = async (e) => {
    e.target.disabled = true;
    await Promise.all([sync(), loadFiles()]);
    e.target.disabled = false; fill();
  };
  $("clearCache").onclick = async () => {
    await caches.delete(FILE_CACHE).catch(() => {});
    cacheIndex = null; rendered.clear();
    $("cacheInfo").textContent = t("已清除，文档会在打开时重新下载");
  };
  $("checkUpd").onclick = async (e) => {
    const b = e.target; b.disabled = true; b.textContent = t("检查中…");
    const [was, now] = await Promise.all([loadedVersion, swVersion()]);
    b.disabled = false; b.textContent = t("检查更新");
    if (!now) { $("verInfo").textContent = t("没能连上网站，稍后再试"); return; }
    if (was && now !== was) { dlg.close(); $("updateToast").hidden = false; return; }
    $("verInfo").textContent = t("版本 {v} · 已是最新", { v: now.replace(/^suiji-/, "") });
  };
}
$("outBtn").onclick = async () => {
  $("settings").close();
  commitAll();
  if (Object.values(store.notes).some((n) => n.dirty)) await sync();
  // Only this device: the default (global) would also sign out the Mac agent and every other device.
  await sb.auth.signOut({ scope: "local" });
};

// ---------- auth ----------
let signUp = false;
const authMsg = (t, kind) => { const m = $("authMsg"); m.hidden = !t; m.textContent = t || ""; m.dataset.kind = kind || ""; };
$("modeBtn").onclick = () => {
  signUp = !signUp;
  $("authBtn").textContent = signUp ? t("注册") : t("登录");
  $("modeBtn").textContent = signUp ? t("已有账号？登录") : t("还没有账号？注册");
  $("password").autocomplete = signUp ? "new-password" : "current-password";
  authMsg("");
};
$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || password.length < 6) { authMsg(t("请填写邮箱，密码至少 6 位。"), "err"); return; }
  $("authBtn").disabled = true; authMsg(signUp ? t("正在注册…") : t("正在登录…"));
  const { data, error } = signUp
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
    : await sb.auth.signInWithPassword({ email, password });
  $("authBtn").disabled = false;
  if (error) {
    const msg = /invalid login/i.test(error.message) ? t("邮箱或密码不对。")
      : /not confirmed/i.test(error.message) ? t("这个邮箱还没确认，请先点邮件里的确认链接。")
      : /already registered/i.test(error.message) ? t("这个邮箱已经注册过了，直接登录吧。")
      : t("出错了：{msg}", { msg: error.message });
    authMsg(msg, "err"); return;
  }
  if (signUp && !data.session) authMsg(t("确认邮件已发到 {email}，点里面的链接后回来登录。", { email }));
});

function enter(session) {
  if (session && session.user.id === uid) return;
  if (channel) { sb.removeChannel(channel); channel = null; }
  uid = session ? session.user.id : null;
  $("auth").hidden = !!session; app.hidden = !session;
  if (!session) {
    local.start(sb, null, { onChange: localChanged, onStatus: localStatus }).catch(console.error);
    store = { notes: {} }; files = []; filesLoaded = filesErr = false; clearTimeout(filesRetry); bodies.clear(); warming = null; rendered.clear(); signed.clear();
    resetAgent(); toggleAgent(false);
    // Another account may sign in on this device; its documents must not mix with these.
    caches.delete(FILE_CACHE).catch(() => {}); cacheIndex = null;
    return;
  }
  $("who").textContent = session.user.email;
  unpublished = session.user.user_metadata?.blog_skip || [];
  // The session can hold old metadata; once the current list arrives, documents already shown get redrawn.
  sb.auth.getUser().then(({ data }) => {
    const now = data?.user?.user_metadata?.blog_skip || [];
    if (!data?.user || JSON.stringify(now) === JSON.stringify(unpublished)) return;
    unpublished = now; rendered.clear();
    for (const p of panes.values()) if (p.kind === "file") { p.shown = null; renderPane(p); }
  }).catch(() => {});
  local.start(sb, session, { onChange: localChanged, onStatus: localStatus }).catch(console.error);
  load(); filesLoaded = false; restoreLayout();
  // Empty notes left from before (not open anywhere, untouched for an hour, so not one just made elsewhere).
  for (const n of visible()) if (!n.body.trim() && Date.now() - Date.parse(n.updated_at) > 3600e3) dropIfEmpty(n.id);
  render();
  if (focused?.kind) app.dataset.view = "edit";
  // Warm up the Markdown renderer in the background so the first document opens without waiting for it.
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => loadMarkdownLibs().catch(() => {})); sync(); loadFiles(); subscribe();
}
sb.auth.onAuthStateChange((_ev, session) => enter(session));
const { data: { session } } = await sb.auth.getSession();
enter(session);

// Glass highlight follows the pointer (desktop only; CSS keeps it off until hover).
if (matchMedia("(hover: hover)").matches) {
  window.addEventListener("pointermove", (e) => {
    const g = e.target.closest?.(".glass");
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty("--mx", e.clientX - r.left + "px");
    g.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true });
}
