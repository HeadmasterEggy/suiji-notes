// The page's access to local folders (public/localsync.js), the same as mac/LocalFiles.swift. The page can only
// reach the folders the user picked in an open panel (~/.suiji/config.json, shared with the Node agent), plus a
// Hexo `_posts` folder's _config.yml, and the sync's own state and log in ~/.suiji.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");

const suijiHome = process.env.SUIJI_HOME || path.join(os.homedir(), ".suiji");
const configFile = path.join(suijiHome, "config.json");
const SKIP = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db"]);

const readJSON = (f) => { try { const o = JSON.parse(fs.readFileSync(f, "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; } };

// ---------- config ----------
function folders() {
  const f = readJSON(configFile)?.folders;
  return Array.isArray(f) ? f.filter((x) => typeof x === "string") : [];
}
function setFolders(list) {
  const obj = readJSON(configFile) || {};
  obj.folders = list;
  try { save(Buffer.from(JSON.stringify(obj, null, 2)), configFile); } catch {}
}
function add(dir) {
  const root = dir.replace(/\/+$/, ""), list = folders();
  if (!list.includes(root)) { list.push(root); setFolders(list); }
  return list;
}
function remove(root) {
  const list = folders().filter((f) => f !== root);
  setFolders(list);
  return list;
}

// The real location of a path, symlinks resolved, including the part that does not exist yet.
function real(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head) && head !== "/") { tail.unshift(path.basename(head)); head = path.dirname(head); }
  try { head = fs.realpathSync(head); } catch {}
  return path.join(head, ...tail);
}

// A path the page may use: inside a synced folder once symlinks are resolved, or a `_posts` folder's _config.yml.
function allowed(p, write = false) {
  const r0 = real(p);
  for (const root of folders()) {
    const r = real(root);
    if (r0 === r || r0.startsWith(r + "/")) return p;
    if (!write && path.basename(root) === "_posts" && r0 === real(path.join(path.dirname(path.dirname(root)), "_config.yml"))) return p;
  }
  throw new Error("not in a synced folder: " + p);
}

// ---------- files ----------
function stat(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return null; }
  return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };   // what the Node agent stores, so the state file means the same to both
}

function walk(root) {
  const out = [];
  (function visit(dir) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) {
      // Gone since it was listed: its files really are gone. Anything else (no permission, a drive that
      // dropped out): say so, so the sync does not take its files as deleted.
      if (dir === root || e.code !== "ENOENT") out.push({ rel: dir.slice(root.length + 1), unreadable: true });
      return;
    }
    for (const name of names.sort()) {
      if (name.startsWith(".") || SKIP.has(name) || name.endsWith("~")) continue;
      const abs = dir + "/" + name;
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      if (st.isDirectory()) visit(abs);
      else if (st.isFile()) out.push({ size: st.size, mtimeMs: Math.round(st.mtimeMs), rel: abs.slice(root.length + 1) });
      // symlinks and the rest are skipped, as the Node agent does
    }
  })(root);
  return out;
}

// Written beside the target, then renamed over it, so a crash never leaves half a file.
function save(data, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.suiji-${process.pid}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function appendLog(line) {
  try {
    fs.mkdirSync(suijiHome, { recursive: true });
    fs.appendFileSync(path.join(suijiHome, "sync.log"), line + "\n");
  } catch {}
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

// One request from the page; returns what the promise resolves to, or throws to reject it.
// addFolder needs an open panel, so the app handles it before calling this.
function handle(body) {
  const p = typeof body.path === "string" ? body.path : "";
  switch (body.op) {
    case "folders": return folders();
    case "removeFolder": return remove(p);
    case "walk":
      if (!folders().includes(p)) throw new Error("not a synced folder: " + p);
      return walk(p);
    case "stat": return stat(allowed(p));
    case "read": return fs.readFileSync(allowed(p)).toString("base64");
    case "readText":
      try { return utf8.decode(fs.readFileSync(allowed(p))); } catch { return null; }
    case "write":
      if (typeof body.data !== "string" || !BASE64.test(body.data)) throw new Error("bad data");
      save(Buffer.from(body.data, "base64"), allowed(p, true));
      return undefined;
    case "loadState":
      try { return fs.readFileSync(path.join(suijiHome, "state.json"), "utf8"); } catch { return null; }
    case "saveState": {
      let ok = false;
      try { const o = JSON.parse(body.state); ok = !!o && typeof o === "object" && !Array.isArray(o); } catch {}
      if (typeof body.state !== "string" || !ok) throw new Error("bad state");
      save(Buffer.from(body.state), path.join(suijiHome, "state.json"));
      return undefined;
    }
    case "log": appendLog(typeof body.line === "string" ? body.line : ""); return undefined;
    default: throw new Error("unknown op");
  }
}

// Calls back (at most every half second) when anything under the folders changes.
function watcher(onChange) {
  let watches = [], timer = null, pending = false;
  const fire = () => {
    if (timer) { pending = true; return; }
    onChange();
    timer = setTimeout(() => { timer = null; if (pending) { pending = false; fire(); } }, 500);
  };
  return function watch(list) {
    watches.forEach((w) => w.close());
    watches = [];
    for (const f of list) {
      try {
        // An error event with no listener would be thrown in the main process (an error dialog); the sync's
        // 5-minute rescan still covers a folder whose watch stopped.
        watches.push(fs.watch(f, { recursive: true }, fire).on("error", () => {}));
      } catch {}   // a folder that is gone is watched again once re-added
    }
  };
}

module.exports = { suijiHome, folders, add, handle, appendLog, watcher };
