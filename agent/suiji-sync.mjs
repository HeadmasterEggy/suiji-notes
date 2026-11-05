#!/usr/bin/env node
// 随记 Mac 同步程序：把选中的文件夹自动上传到随记的「文件」里。随记 Mac App 自带同样的同步（设置 → 本地文件夹），
// 用 App 时不需要它；两者共用 ~/.suiji/ 里的配置和状态，App 启动时会停掉这里 install 的后台任务。
// 新增、修改的文件会上传；本地删除的文件，云端也会删除。
// 在手机上改过的文件会自动下载回来，覆盖本地文件；如果两边同时改了，云端版本另存为「名字（随记副本）」。
//
//   node agent/suiji-sync.mjs login       登录随记账号
//   node agent/suiji-sync.mjs add [路径]   添加文件夹（不写路径会弹出选择窗口）
//   node agent/suiji-sync.mjs remove 路径  停止同步某个文件夹（云端文件保留）
//   node agent/suiji-sync.mjs status      查看同步状态
//   node agent/suiji-sync.mjs run         前台运行，持续同步
//   node agent/suiji-sync.mjs install     登录 Mac 后自动在后台运行
//   node agent/suiji-sync.mjs uninstall   取消后台运行
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncEngine } from "../public/syncengine.js";

const HOME = process.env.SUIJI_HOME || path.join(os.homedir(), ".suiji");
const CONFIG = path.join(HOME, "config.json");
const STATE = path.join(HOME, "state.json");
const SESSION = path.join(HOME, "session.json");
const LOG = path.join(HOME, "sync.log");
const PLIST = path.join(os.homedir(), "Library/LaunchAgents/app.suiji.sync.plist");
const SKIP = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db"]);
const SELF = fileURLToPath(import.meta.url);

fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 });
const log = (...a) => console.log(new Date().toLocaleString("zh-CN"), ...a);

// ---------- Supabase ----------
async function supabaseConfig() {
  const local = path.join(path.dirname(SELF), "../public/config.js");
  let src = fs.existsSync(local) ? fs.readFileSync(local, "utf8") : "";
  if (!/SUPABASE_URL = "https/.test(src)) src = await (await fetch("https://suiji-notes.vercel.app/config.js")).text();
  const url = /SUPABASE_URL = "([^"]+)"/.exec(src)?.[1], key = /SUPABASE_ANON_KEY = "([^"]+)"/.exec(src)?.[1];
  if (!url || !key) throw new Error("找不到随记的服务器配置");
  return { url, key };
}
const fileStorage = {
  getItem: (k) => readJson(SESSION, {})[k] ?? null,
  setItem: (k, v) => { const s = readJson(SESSION, {}); s[k] = v; writeJson(SESSION, s); },
  removeItem: (k) => { const s = readJson(SESSION, {}); delete s[k]; writeJson(SESSION, s); },
};
async function client() {
  const { url, key } = await supabaseConfig();
  return createClient(url, key, { auth: { storage: fileStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
}
async function signedIn(sb) {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error("还没登录，先运行：node agent/suiji-sync.mjs login");
  return data.session.user;
}

// ---------- prompts ----------
function ask(q, hidden = false) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    let buf = "";
    stdin.setRawMode?.(hidden);
    stdin.resume(); stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { stdin.removeListener("data", onData); stdin.setRawMode?.(false); stdin.pause(); process.stdout.write("\n"); return resolve(buf); }
        if (c === "\u0003") process.exit(1);
        if (c === "\u007f") { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on("data", onData);
  });
}
function chooseFolder() {
  try {
    return execFileSync("osascript", ["-e", 'POSIX path of (choose folder with prompt "选择要自动同步到随记的文件夹")'], { encoding: "utf8" }).trim();
  } catch { return ""; }
}

// ---------- syncing (public/syncengine.js, shared with the Mac app) ----------
function walk(root) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { log("读不了", dir, e.code); return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name) || e.name.endsWith("~")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) visit(abs);
      else if (e.isFile()) {
        const st = fs.statSync(abs);
        out.push({ rel: path.relative(root, abs).split(path.sep).join("/"), size: st.size, mtimeMs: Math.round(st.mtimeMs) });
      }
    }
  };
  visit(root);
  return out;
}
const diskFs = {
  walk: async (root) => walk(root),
  stat: async (p) => { const st = fs.statSync(p, { throwIfNoEntry: false }); return st && { size: st.size, mtimeMs: Math.round(st.mtimeMs) }; },
  read: async (p) => new Uint8Array(fs.readFileSync(p)),
  readText: async (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
  write: async (p, bytes) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = path.join(path.dirname(p), "." + path.basename(p) + ".suiji-tmp");
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, p);
  },
};

async function syncAll(sb) {
  const user = await signedIn(sb);
  const { folders = [] } = readJson(CONFIG, {});
  const state = readJson(STATE, {});
  const { retry } = await syncEngine({ sb, fs: diskFs, log }).syncAll(user, folders, state);
  writeJson(STATE, state);
  return retry;
}

// ---------- commands ----------
const [cmd, arg] = process.argv.slice(2);
const sb = await client();

if (cmd === "login") {
  const email = (await ask("随记邮箱：")).trim();
  const password = await ask("密码（输入时不显示）：", true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { console.error("登录失败：", error.message); process.exit(1); }
  console.log("已登录", email);
  process.exit(0);
} else if (cmd === "add") {
  await signedIn(sb);
  let root = arg ? path.resolve(arg.replace(/^~(?=$|\/)/, os.homedir())) : chooseFolder();
  if (!root) { console.log("没有选择文件夹"); process.exit(0); }
  root = root.replace(/\/+$/, "");
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) { console.error("不是文件夹：", root); process.exit(1); }
  const cfg = readJson(CONFIG, { folders: [] });
  if (!cfg.folders.includes(root)) cfg.folders.push(root);
  writeJson(CONFIG, cfg);
  console.log("已添加：", root, "\n正在上传…");
  await syncAll(sb);
  console.log("完成。保持 run 运行（或执行 install）后，之后的改动会自动上传。");
  process.exit(0);
} else if (cmd === "remove") {
  const root = path.resolve((arg || "").replace(/^~(?=$|\/)/, os.homedir())).replace(/\/+$/, "");
  const cfg = readJson(CONFIG, { folders: [] });
  cfg.folders = cfg.folders.filter((f) => f !== root);
  writeJson(CONFIG, cfg);
  const state = readJson(STATE, {});
  for (const k of Object.keys(state)) if (k.startsWith(root + "::")) delete state[k];
  writeJson(STATE, state);
  console.log("已停止同步：", root, "（云端已有的文件保留）");
  process.exit(0);
} else if (cmd === "status") {
  const user = await signedIn(sb).catch(() => null);
  const { folders = [] } = readJson(CONFIG, {});
  const state = readJson(STATE, {});
  console.log("账号：", user ? user.email : "未登录");
  console.log("后台运行：", fs.existsSync(PLIST) ? "已安装" : "未安装");
  for (const f of folders) console.log(" ·", f, "—", Object.keys(state).filter((k) => k.startsWith(f + "::")).length, "个文件");
  if (!folders.length) console.log("还没有同步的文件夹，运行 add 添加。");
  process.exit(0);
} else if (cmd === "run") {
  await signedIn(sb);
  log("随记同步已启动");
  let timer = null, busy = false, again = false;
  const kick = (ms = 2000) => { clearTimeout(timer); timer = setTimeout(go, ms); };
  async function go() {
    if (busy) { again = true; return; }
    busy = true;
    let retry = false;
    try { retry = await syncAll(sb); } catch (e) { log("同步出错：", e.message || e); }
    busy = false;
    if (again) { again = false; kick(); }
    else if (retry) kick(10000);
  }
  const watchers = new Map();
  const rewatch = () => {
    const { folders = [] } = readJson(CONFIG, {});
    for (const f of folders) {
      if (watchers.has(f) || !fs.existsSync(f)) continue;
      try { watchers.set(f, fs.watch(f, { recursive: true }, () => kick())); } catch (e) { log("无法监听", f, e.code); }
    }
  };
  rewatch();
  // Edits made in the app arrive right away through Realtime; the 5-minute rescan covers missed events.
  const uid = (await signedIn(sb)).id;
  sb.channel("agent-" + uid)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "files", filter: "user_id=eq." + uid }, () => kick(1500))
    .subscribe();
  go();
  setInterval(() => { rewatch(); kick(0); }, 5 * 60 * 1000);   // backstop in case a watch event is missed
} else if (cmd === "install") {
  await signedIn(sb);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.suiji.sync</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${SELF}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST], { stdio: "ignore" }); } catch {}
  fs.writeFileSync(PLIST, plist);
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST]);
  console.log("已设置为登录后自动运行。日志：", LOG);
  process.exit(0);
} else if (cmd === "uninstall") {
  try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST], { stdio: "ignore" }); } catch {}
  fs.rmSync(PLIST, { force: true });
  console.log("已取消后台运行。");
  process.exit(0);
} else {
  console.log(fs.readFileSync(SELF, "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
