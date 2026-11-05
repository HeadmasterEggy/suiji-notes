// Mac app only: the folders in 设置 → 本地文件夹 are read and written on disk, and synced with the cloud by
// public/syncengine.js running in this page. The app (mac/main.swift) gives the page a narrow file
// bridge, `suijiFs`, limited to those folders; it also watches them and calls changed() on any change.
import { syncEngine, keyOf } from "./syncengine.js";

const bridge = window.webkit?.messageHandlers?.suijiFs;
export const available = !!bridge;
const call = (op, args = {}) => bridge.postMessage({ op, ...args });

const fromB64 = (s) => Uint8Array.fromBase64 ? Uint8Array.fromBase64(s) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function toB64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const diskFs = {
  walk: (root) => call("walk", { path: root }),
  stat: (path) => call("stat", { path }),
  read: async (path) => fromB64(await call("read", { path })),
  readText: (path) => call("readText", { path }),
  write: (path, bytes) => call("write", { path, data: toB64(bytes) }),
};

let sb = null, user = null, folders = [], state = null, onChange = () => {}, onStatus = () => {};
let timer = null, busy = false, again = false, channel = null, last = "";
const log = (...a) => {
  const line = a.map(String).join(" ");
  last = line;
  call("log", { line: new Date().toLocaleString("zh-CN") + " " + line }).catch(() => {});
};
const status = (text) => { onStatus(text); call("status", { text }).catch(() => {}); };

// The folder a file row belongs to on this Mac, and its path there, if it is in one of the synced folders.
export function localPath(f) {
  const k = f.local_key;
  if (!k) return null;
  const root = folders.find((r) => k.startsWith(r + "::"));
  return root ? root + "/" + k.slice(root.length + 2) : null;
}
export const readLocal = async (f) => new TextDecoder().decode(await diskFs.read(localPath(f)));
// Saves straight to disk; the sync uploads it a moment later (or once back online).
export async function writeLocal(f, text) {
  await diskFs.write(localPath(f), new TextEncoder().encode(text));
  kick(300);
}

export const listFolders = () => folders.slice();
export async function addFolder() {
  const r = await call("addFolder");
  if (r) { folders = r; kick(0); }
  return folders;
}
export async function removeFolder(root) {
  folders = await call("removeFolder", { path: root });
  if (state) {
    for (const k of Object.keys(state)) if (k.startsWith(root + "::")) delete state[k];
    await call("saveState", { state: JSON.stringify(state) });
  }
  onChange(new Set());
  return folders;
}
export const lastLine = () => last;

// Passes never overlap; a request during one runs another right after it.
export function kick(ms = 2000) { clearTimeout(timer); timer = setTimeout(go, ms); }
async function go() {
  if (!user) return;
  if (busy) { again = true; return; }
  busy = true;
  let retry = false;
  try {
    state ||= JSON.parse(await call("loadState") || "{}");
    if (folders.length) status("syncing");
    const r = await engine.syncAll(user, folders, state);
    await call("saveState", { state: JSON.stringify(state) });
    retry = r.retry;
    if (r.changed.size) onChange(r.changed);
    status(navigator.onLine ? "ok" : "offline");
  } catch (e) {
    log("同步出错：", e.message || e);
    status("error");
  }
  busy = false;
  if (again) { again = false; go(); }
  else if (retry) kick(10000);
}
let engine = null;

// Starts syncing for the signed-in account; called again with null on sign-out.
export async function start(client, session, hooks) {
  if (!available) return;
  if (channel) { client.removeChannel(channel); channel = null; }
  clearTimeout(timer);
  sb = client; user = session?.user || null;
  ({ onChange, onStatus } = hooks);
  folders = await call("folders");
  if (!user) return;
  engine = syncEngine({ sb, fs: diskFs, log });
  // Edits made on other devices arrive right away through Realtime; the 5-minute rescan covers missed events.
  channel = sb.channel("local-" + user.id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "files", filter: "user_id=eq." + user.id }, () => kick(1500))
    .subscribe();
  kick(0);
}
if (available) {
  window.suijiLocal = { changed: () => kick(), kick };   // the app calls these
  setInterval(() => kick(0), 5 * 60 * 1000);
  addEventListener("online", () => kick(0));
}
export { keyOf };
