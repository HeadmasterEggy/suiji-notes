// 随记 for Mac, in Electron: the web app in a window, with the same file bridge as the Swift app in mac/, so the
// page's own code (public/localsync.js, public/agent.js) runs unchanged through preload.js. Keeps running while
// the window is closed, with a menu bar item for the folder sync. Build with desktop/build.sh.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, screen, shell, systemPreferences } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFileSync, spawn } = require("node:child_process");
const local = require("./localfiles");

// SUIJI_URL and SUIJI_HOME (see localfiles.js) point a test copy elsewhere, as for the Swift app.
const appURL = new URL(process.env.SUIJI_URL || "https://suiji-notes.vercel.app/");
const testing = !!process.env.SUIJI_HOME;
const agentPlist = path.join(os.homedir(), "Library/LaunchAgents/app.suiji.sync.plist");
// Where Magpie writes the gateway and model it picked for 随记 (magpie/suiji.agent.js); SUIJI_MAGPIE moves it for a test copy.
const magpieLink = process.env.SUIJI_MAGPIE || path.join(os.homedir(), ".config/suiji/magpie.json");
// A test copy keeps its sign-in and settings beside its folder state, away from the real app's.
if (testing) app.setPath("userData", path.join(local.suijiHome, "electron"));

// Settings live in the app.suiji.mac defaults, where the Swift app keeps them (lang, iconStyle, updateFeed), so
// switching apps keeps them. A test copy keeps them in memory only.
const memory = {};
const pref = (k) => testing ? memory[k] ?? "" : systemPreferences.getUserDefault(k, "string") || "";
const setPref = (k, v) => { if (testing) memory[k] = v; else systemPreferences.setUserDefault(k, "string", v); };

// Published by `desktop/build.sh --publish`; `defaults write app.suiji.mac updateFeed <url>` points it elsewhere for testing.
const updateFeed = () => new URL(pref("updateFeed") || "https://suiji-notes.vercel.app/mac/version.json");
let currentBuild = 0, version = app.getVersion();   // version: "2.0" from the bundle, like the Swift app, not package.json's "2.0.0"
// Interface language: the one the page reports (its 设置 → 语言), before that the system's.
let appLang = "en";
const L = (zh, en) => appLang === "zh" ? zh : en;

const STYLES = ["", "paper", "terminal", "blocks", "ink", "eink", "notebook", "swiss", "neon", "blueprint", "clay", "sunset", "eyecare"];
const iconsDir = app.isPackaged ? path.join(process.resourcesPath, "icons") : path.join(__dirname, "../mac");
const bundlePath = path.resolve(process.execPath, "../../..");   // …/随记.app when packaged

let win, quitting = false;
const watch = local.watcher(() => win?.webContents.executeJavaScript("window.suijiLocal?.changed()").catch(() => {}));

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showWindow());

app.whenReady().then(() => {
  currentBuild = Number(readPlist(path.join(bundlePath, "Contents/Info.plist"), "CFBundleVersion")) || 0;
  version = readPlist(path.join(bundlePath, "Contents/Info.plist"), "CFBundleShortVersionString") || version;
  appLang = pref("lang") || (app.getPreferredSystemLanguages()[0]?.startsWith("zh") ? "zh" : "en");
  buildMainMenu();
  buildWindow();
  watch(local.folders());
  if (!testing || process.env.SUIJI_MAGPIE) makeMagpieLink();
  if (testing) { app.dock.hide(); return; }   // a test copy runs unseen: no window, menu bar item or updates, and leaves the agent alone
  retireAgent();
  win.show();
  setDockIcon(pref("iconStyle"));
  setTimeout(() => checkForUpdates(false), 5000);
  setInterval(() => checkForUpdates(false), 6 * 3600 * 1000);
});

app.on("activate", () => showWindow());
app.on("before-quit", () => {
  quitting = true;
  if (stagedUpdate) install(stagedUpdate, false);   // 「退出时更新」
});

// ---------- self-update ----------
// The web content updates itself on every deploy; this replaces the app bundle when a newer build is published.
// A newer build is downloaded in the background, checked, then installed on restart or on quit. The feed and the
// checks are the Swift app's, so either app can update to the other.

let stagedUpdate = null, checking = false;

function readPlist(file, key) {
  try { return execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", file], { encoding: "utf8" }).trim(); } catch { return ""; }
}

async function checkForUpdates(manual) {
  if (checking || !app.isPackaged) return;
  if (stagedUpdate) { if (manual) offerRestart(stagedUpdate); return; }
  checking = true;
  let r = null, problem = "";
  try { r = await (await net.fetch(updateFeed().href, { cache: "no-store" })).json(); } catch (e) { problem = e.message; }
  if (!r || typeof r.version !== "string" || !Number.isInteger(r.build) || typeof r.url !== "string") {
    checking = false;
    if (manual) tell(L("检查更新失败", "Couldn’t check for updates"), problem || L("没有读到版本信息。", "No version information was found."));
    return;
  }
  if (r.build <= currentBuild) {
    checking = false;
    if (manual) tell(L("已是最新版本", "You’re up to date"), L(`随记 ${version} 是最新的。`, `Suiji ${version} is the latest version.`));
    return;
  }
  let staged = null;
  const downloadFailed = L("下载失败。", "The download failed.");
  problem = downloadFailed;
  try {
    const res = await net.fetch(new URL(r.url, updateFeed()).href);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const dir = path.join(os.tmpdir(), "suiji-update-" + r.build), zip = dir + ".zip";
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    problem = L("下载的安装包不完整或签名不对，已丢弃。", "The download was incomplete or wrongly signed, so it was discarded.");
    execFileSync("/usr/bin/ditto", ["-x", "-k", zip, dir]);
    fs.rmSync(zip, { force: true });
    const name = fs.readdirSync(dir).find((n) => n.endsWith(".app"));
    const next = name && path.join(dir, name), info = next && path.join(next, "Contents/Info.plist");
    if (next && readPlist(info, "CFBundleIdentifier") === readPlist(path.join(bundlePath, "Contents/Info.plist"), "CFBundleIdentifier")
        && Number(readPlist(info, "CFBundleVersion")) === r.build) {
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", next]);   // throws if the signature is broken
      staged = next;
    }
  } catch (e) { if (problem === downloadFailed && e.message) problem = e.message; }
  checking = false;
  if (staged) { stagedUpdate = staged; offerRestart(staged, r); }
  else if (manual) tell(L("更新失败", "Update failed"), problem);
}

async function offerRestart(next, r) {
  const { response } = await dialog.showMessageBox({
    message: r ? L(`随记 ${r.version} 已下载`, `Suiji ${r.version} is ready`) : L("新版本已下载", "A new version is ready"),
    detail: (r?.notes ? r.notes + "\n\n" : "") + L("重启随记就能用上新版本；也可以等下次退出时再更新。", "Restart Suiji to use it, or let it update the next time you quit."),
    buttons: [L("立即重启", "Restart Now"), L("退出时更新", "Update on Quit")],
  });
  if (response === 0) { install(next, true); stagedUpdate = null; app.quit(); }
}

// Swaps the bundle once this process has exited (a running app cannot replace itself), then optionally reopens it.
function install(next, relaunch) {
  stagedUpdate = null;
  const script = `
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
old="$2"; new="$3"
# The download may have waited days in the temporary folder, which macOS trims: swap only a whole, signed bundle.
codesign --verify --deep "$new" 2>/dev/null || { [ "$4" = 1 ] && open "$old"; exit 0; }
rm -rf "$old.previous" && mv "$old" "$old.previous" && mv "$new" "$old" && rm -rf "$old.previous" || { [ -d "$old" ] || mv "$old.previous" "$old"; }
xattr -dr com.apple.quarantine "$old" 2>/dev/null
[ "$4" = 1 ] && open "$old"
exit 0`;
  spawn("/bin/sh", ["-c", script, "sh", String(process.pid), bundlePath, next, relaunch ? "1" : "0"], { detached: true, stdio: "ignore" }).unref();
}

function tell(message, detail) { return dialog.showMessageBox({ message, detail }); }

// ---------- style icon ----------
// The page reports its style (玻璃 / 纸张 / 终端 / 方块 …) and the Dock icon follows it while the app runs.
// The bundle's own icon, which Finder and Launchpad show, stays the glass one.

function setDockIcon(style) {
  setPref("iconStyle", style);
  if (!testing) app.dock.setIcon(path.join(iconsDir, style ? `AppIcon-${style}.png` : "AppIcon.png"));
}

// Only the app's own pages, in the main frame, may use the bridge.
const fromApp = (e) => {
  try { return e.sender === win?.webContents && !!e.senderFrame && e.senderFrame === e.sender.mainFrame && new URL(e.senderFrame.url).origin === appURL.origin; }
  catch { return false; }   // a frame mid-navigation; throwing here would be an error dialog from the main process
};

// The page reports its style and language: {style, lang}.
ipcMain.on("suiji", (e, body) => {
  if (!fromApp(e) || !body || typeof body !== "object") return;
  if (STYLES.includes(body.style) && body.style !== pref("iconStyle")) setDockIcon(body.style);
  if (["zh", "en"].includes(body.lang) && body.lang !== appLang) {
    appLang = body.lang; setPref("lang", appLang);
    buildMainMenu(); win.setTitle(L("随记", "Suiji"));
  }
});

// ---------- local folders ----------
// The file bridge for public/localsync.js. Replies are {value} or {error}; preload.js turns them into the promise.

ipcMain.handle("suijiFs", async (e, body) => {
  try {
    if (!fromApp(e) || !body || typeof body !== "object") throw new Error("not allowed");
    return { value: await bridge(body) };
  } catch (err) { return { error: err.message || String(err) }; }
});

async function bridge(body) {
  switch (body.op) {
    case "addFolder": {
      const r = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: L("同步这个文件夹", "Sync This Folder"),
        message: L("选一个文件夹，随记会直接读写它，并和云端同步。", "Choose a folder. Suiji reads and writes it directly and syncs it with the cloud."),
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const folders = local.add(r.filePaths[0]);
      watch(folders);
      return folders;
    }
    case "status": return undefined;   // the sync state; it was for the menu bar item, which is gone
    // Settings → 本地文件夹 (Local folders): what the menu bar item used to offer.
    case "reveal":
      if (!local.folders().includes(body.path)) throw new Error("not a synced folder");
      return shell.openPath(body.path).then((err) => { if (err) throw new Error(err); });
    case "syncLog": {
      const file = path.join(local.suijiHome, "sync.log");
      if (!fs.existsSync(file)) local.appendLog(new Date().toISOString() + " 还没有同步记录");   // else the button did nothing
      return shell.openPath(file).then(() => undefined);
    }
    case "checkUpdates": checkForUpdates(true); return undefined;
    case "zoom": return typeof body.f === "number" && body.f > 0 ? setZoom(body.f) : win.webContents.getZoomFactor();
    case "appVersion": return currentBuild ? `${version} (${currentBuild})` : version;
    case "loginItem":
      if (typeof body.on === "boolean" && body.on !== app.getLoginItemSettings().openAtLogin) toggleLogin();
      return app.getLoginItemSettings().openAtLogin;
    case "magpieLink": {
      // {enabled, model, url, key} once 随记 is connected on Magpie's Agents page, else enabled is false.
      let j;
      try { j = JSON.parse(fs.readFileSync(magpieLink, "utf8")); } catch { return undefined; }
      if (!j || typeof j !== "object" || Array.isArray(j)) return undefined;
      const g = j.gateway && typeof j.gateway === "object" ? j.gateway : {};
      const str = (v) => typeof v === "string" ? v : "";
      return { enabled: j.enabled === true, model: str(j.model), url: str(g.url), key: str(g.key) };
    }
    case "localHttp": return localHttp(body);
    case "localHttpAbort": localHttpRuns.get(body.id)?.abort(new Error("stopped")); return undefined;
    default: {
      const v = local.handle(body);
      if (body.op === "removeFolder") watch(local.folders());
      return v;
    }
  }
}

// The assistant's model on this computer (Magpie, Ollama…): the page's https origin can't call http://127.0.0.1
// in WebKit, and the Swift app makes the request; this does the same here. Only loopback addresses; the answer
// comes back whole. Gives up after ten minutes without a byte from the server.
// Requests still running, by the id the page gave them, so its Stop button can end them (op localHttpAbort).
const localHttpRuns = new Map();
async function localHttp(body) {
  let u;
  try { u = new URL(body.url); } catch { u = null; }
  if (!u || !["http:", "https:"].includes(u.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname.toLowerCase())) {
    throw new Error("only addresses on this computer");
  }
  const ctl = new AbortController(), id = typeof body.id === "string" ? body.id : null;
  if (id) localHttpRuns.set(id, ctl);
  let idle;
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error("timed out")), 600_000); };
  const headers = { "user-agent": `Suiji/${version}` };   // how Magpie tells 随记's requests apart
  for (const [k, v] of Object.entries(body.headers && typeof body.headers === "object" ? body.headers : {})) if (typeof v === "string") headers[k.toLowerCase()] = v;
  touch();
  try {
    const res = await net.fetch(u.href, {
      method: typeof body.method === "string" ? body.method : "GET", headers,
      body: typeof body.body === "string" ? body.body : undefined, signal: ctl.signal, bypassCustomProtocolHandlers: true,
    });
    const chunks = [];
    if (res.body) for await (const c of res.body) { chunks.push(c); touch(); }
    return { status: res.status, body: Buffer.concat(chunks).toString("utf8") };
  } finally { clearTimeout(idle); if (id) localHttpRuns.delete(id); }
}

// Magpie lists 随记 on its Agents page once this file exists; it fills it in when 随记 is connected there.
function makeMagpieLink() {
  if (fs.existsSync(magpieLink)) return;
  try {
    fs.mkdirSync(path.dirname(magpieLink), { recursive: true, mode: 0o700 });
    fs.writeFileSync(magpieLink, JSON.stringify({ schemaVersion: 1, enabled: false, model: "", gateway: { url: "", key: "" } }) + "\n", { mode: 0o600, flag: "wx" });
  } catch {}
}

// The Node agent (npm run sync install) syncs the same folders from the same state; the app does that
// now, so its launchd job is stopped and its plist set aside (the agent itself still works by hand).
function retireAgent() {
  if (!fs.existsSync(agentPlist)) return;
  try { execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, agentPlist], { stdio: "ignore" }); } catch {}
  const aside = agentPlist + ".disabled";
  fs.rmSync(aside, { force: true });
  try { fs.renameSync(agentPlist, aside); } catch {}
  local.appendLog(new Date().toISOString() + " 随记 App 接管了文件夹同步，已停用后台的 Node 同步程序");
}

// ---------- window ----------

const boundsFile = () => path.join(app.getPath("userData"), "window.json");

function buildWindow() {
  let bounds = {};
  try { bounds = JSON.parse(fs.readFileSync(boundsFile(), "utf8")) || {}; } catch {}
  // Saved on a screen that is no longer there (an external display unplugged): macOS would open the window off
  // screen, out of reach. Keep only the size then, and center it.
  const onScreen = Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width - 80 && bounds.x + (bounds.width || 0) > a.x + 80 && bounds.y >= a.y - 10 && bounds.y < a.y + a.height - 40);
  if (!onScreen) { delete bounds.x; delete bounds.y; }
  win = new BrowserWindow({
    width: 1280, height: 820, ...bounds, minWidth: 380, minHeight: 480,
    title: L("随记", "Suiji"), titleBarStyle: "hidden", show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false,   // keeps the page (and so the sync) running at full speed while the window is closed or hidden
      spellcheck: true,
    },
  });
  if (!onScreen) win.center();   // x is 0 for a window at the left edge, so that alone does not mean "no position"
  const saveBounds = () => { if (!win.isFullScreen()) try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds())); } catch {} };
  win.on("resized", saveBounds); win.on("moved", saveBounds);
  win.on("page-title-updated", (e) => e.preventDefault());
  for (const [ev, on] of [["enter-full-screen", true], ["leave-full-screen", false]]) win.on(ev, () => win.webContents.send("fullscreen", on));
  // A reload (⌘R, or the page updating itself after a deploy) starts without the class, so each load is told
  // again; otherwise the 32 px title-bar gap and the drag strip come back in full screen.
  win.webContents.on("dom-ready", () => { win.webContents.send("fullscreen", win.isFullScreen()); win.webContents.setZoomFactor(savedZoom()); });

  // Closing the window keeps the app (and the sync) running; the Dock icon or the menu bar item brings it back.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    if (win.isFullScreen()) { win.once("leave-full-screen", () => win.hide()); win.setFullScreen(false); }
    else win.hide();
  });

  const wc = win.webContents;
  // Pages of the app stay in the window; storage links download; everything else (the blog, any link in a
  // note) opens in the default browser.
  const isStorage = (u) => u.pathname.includes("/storage/v1/object/");
  wc.on("will-navigate", (e, url) => {
    const u = new URL(url);
    if (isStorage(u)) { e.preventDefault(); wc.downloadURL(url); return; }
    if (u.host !== appURL.host && /^(https?|mailto):$/.test(u.protocol)) { e.preventDefault(); shell.openExternal(url); }
  });
  // target="_blank" links and window.open
  wc.setWindowOpenHandler(({ url }) => {
    const u = new URL(url);
    if (isStorage(u) && u.search.includes("download")) wc.downloadURL(url);
    else if (/^(https?|mailto):$/.test(u.protocol)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Downloads go to ~/Downloads without asking (like Safari), then show in Finder.
  wc.session.on("will-download", (_, item) => {
    const dir = app.getPath("downloads"), name = item.getFilename();
    const ext = path.extname(name), stem = path.basename(name, ext);
    let dest = path.join(dir, name);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${stem} ${i}${ext}`);
    item.setSavePath(dest);
    item.once("done", (_, state) => { if (state === "completed") shell.showItemInFolder(dest); });
  });

  // The system menu, wherever the page leaves it (outside a document, or with ⇧): spelling, edit, links,
  // and 检查元素 (Inspect Element), the reason for the switch to Electron.
  wc.on("context-menu", (_, p) => {
    const items = [];
    for (const s of p.dictionarySuggestions || []) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (p.misspelledWord) items.push({ label: L("学习拼写", "Learn Spelling"), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
    if (p.selectionText.trim()) items.push({ label: L(`查询“${p.selectionText.trim().slice(0, 20)}”`, `Look Up “${p.selectionText.trim().slice(0, 20)}”`), click: () => wc.showDefinitionForSelection() }, { type: "separator" });
    if (p.linkURL) {
      items.push({ label: L("在浏览器中打开链接", "Open Link in Browser"), click: () => shell.openExternal(p.linkURL) },
                 { label: L("拷贝链接", "Copy Link"), click: () => require("electron").clipboard.writeText(p.linkURL) }, { type: "separator" });
    }
    if (p.mediaType === "image") items.push({ label: L("拷贝图像", "Copy Image"), click: () => wc.copyImageAt(p.x, p.y) }, { type: "separator" });
    const f = p.editFlags;
    if (p.isEditable) items.push({ role: "cut", label: L("剪切", "Cut"), enabled: f.canCut });
    if (p.isEditable || p.selectionText) items.push({ role: "copy", label: L("拷贝", "Copy"), enabled: f.canCopy });
    if (p.isEditable) items.push({ role: "paste", label: L("粘贴", "Paste"), enabled: f.canPaste }, { role: "selectAll", label: L("全选", "Select All") });
    if (items.length && items.at(-1).type !== "separator") items.push({ type: "separator" });
    items.push({ label: L("检查元素", "Inspect Element"), click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  wc.loadURL(appURL.href);
}

function showWindow() {
  if (!win) return;
  win.show(); win.focus();
}

// Page zoom: ⌘+ / ⌘− and the 界面大小 slider in Settings set the same factor, kept in userData/zoom.
const zoomFile = () => path.join(app.getPath("userData"), "zoom");
function savedZoom() {
  try { const f = +fs.readFileSync(zoomFile(), "utf8"); return f >= 0.5 && f <= 2 ? f : 1; } catch { return 1; }
}
function setZoom(f) {
  f = Math.min(Math.max(Math.round(f * 100) / 100, 0.6), 2);
  win.webContents.setZoomFactor(f);
  try { f === 1 ? fs.rmSync(zoomFile(), { force: true }) : fs.writeFileSync(zoomFile(), String(f)); } catch {}
  return f;
}
function zoomBy(d) {
  setZoom(d ? Math.round((win.webContents.getZoomFactor() + d) * 10) / 10 : 1);
}

function toggleLogin() {
  const on = app.getLoginItemSettings().openAtLogin;
  app.setLoginItemSettings({ openAtLogin: !on });
  if (app.getLoginItemSettings().openAtLogin === on) tell(L("没能更改登录项", "Couldn’t change the login item"), L("请在“系统设置 → 通用 → 登录项”里更改。", "Change it in System Settings → General → Login Items."));
}

// ---------- main menu ----------

function buildMainMenu() {
  app.setAboutPanelOptions({ applicationName: L("随记", "Suiji"), applicationVersion: version, version: String(currentBuild || "") });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: L("随记", "Suiji"), submenu: [
      { role: "about", label: L("关于随记", "About Suiji") },
      { label: L("检查更新…", "Check for Updates…"), click: () => checkForUpdates(true) },
      { type: "separator" },
      { role: "hide", label: L("隐藏随记", "Hide Suiji") },
      { role: "hideOthers", label: L("隐藏其他", "Hide Others") },
      { type: "separator" },
      { role: "quit", label: L("退出随记", "Quit Suiji") },
    ] },
    { label: L("编辑", "Edit"), submenu: [
      { role: "undo", label: L("撤销", "Undo") }, { role: "redo", label: L("重做", "Redo") }, { type: "separator" },
      { role: "cut", label: L("剪切", "Cut") }, { role: "copy", label: L("拷贝", "Copy") },
      { role: "paste", label: L("粘贴", "Paste") }, { role: "selectAll", label: L("全选", "Select All") },
    ] },
    { label: L("显示", "View"), submenu: [
      { label: L("重新载入", "Reload"), accelerator: "Cmd+R", click: () => win.webContents.reload() }, { type: "separator" },
      { label: L("放大", "Zoom In"), accelerator: "Cmd+=", click: () => zoomBy(0.1) },
      { label: L("缩小", "Zoom Out"), accelerator: "Cmd+-", click: () => zoomBy(-0.1) },
      { label: L("实际大小", "Actual Size"), accelerator: "Cmd+0", click: () => zoomBy(0) }, { type: "separator" },
      { role: "togglefullscreen", label: L("进入全屏幕", "Enter Full Screen") }, { type: "separator" },
      { label: L("网页检查器", "Web Inspector"), accelerator: "Alt+Cmd+I", click: () => win.webContents.toggleDevTools() },
    ] },
    { label: L("窗口", "Window"), submenu: [
      { role: "minimize", label: L("最小化", "Minimize") }, { role: "close", label: L("关闭窗口", "Close Window") },
      { type: "separator" }, { label: L("随记", "Suiji"), accelerator: "Cmd+1", click: showWindow },
    ] },
  ]));
}
