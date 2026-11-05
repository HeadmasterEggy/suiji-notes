// 随记 for Mac: the web app in a native window. It also syncs local folders: the page runs the sync
// (public/localsync.js) through the file bridge in LocalFiles.swift, and keeps running while the window is
// closed, with a menu bar item. Build with mac/build.sh.
import AppKit
import ServiceManagement
import WebKit

// SUIJI_URL and SUIJI_HOME (see LocalFiles.swift) point a test copy elsewhere.
let appURL = URL(string: ProcessInfo.processInfo.environment["SUIJI_URL"] ?? "https://suiji-notes.vercel.app/")!
let testing = ProcessInfo.processInfo.environment["SUIJI_HOME"] != nil
let agentPlist = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/app.suiji.sync.plist")
// Where Magpie writes the gateway and model it picked for 随记 (magpie/suiji.agent.js); SUIJI_MAGPIE moves it for a test copy.
let magpieLink = ProcessInfo.processInfo.environment["SUIJI_MAGPIE"].map { URL(fileURLWithPath: $0) }
  ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/suiji/magpie.json")
// Published by `mac/build.sh --publish`; `defaults write app.suiji.mac updateFeed <url>` points it elsewhere for testing.
let updateFeed = URL(string: UserDefaults.standard.string(forKey: "updateFeed") ?? "https://suiji-notes.vercel.app/mac/version.json")!
let currentBuild = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
// Interface language: the one the page reports (its 设置 → 语言), before that the system's.
var appLang = UserDefaults.standard.string(forKey: "lang") ?? (Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "zh" : "en")
func L(_ zh: String, _ en: String) -> String { appLang == "zh" ? zh : en }

struct Release: Decodable { let version: String; let build: Int; let url: String; let notes: String? }

@discardableResult
func run(_ path: String, _ args: [String]) -> (status: Int32, out: String) {
  let p = Process(), pipe = Pipe()
  p.executableURL = URL(fileURLWithPath: path); p.arguments = args
  p.standardOutput = pipe; p.standardError = pipe
  do { try p.run() } catch { return (-1, "") }
  let data = pipe.fileHandleForReading.readDataToEndOfFile()
  p.waitUntilExit()
  return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
}

// The page fills the window under a transparent title bar, so this strip over the gap the page leaves at
// the top (see macCSS) does what a title bar does: drag to move, double-click to zoom.
final class DragStrip: NSView {
  override func mouseDown(with e: NSEvent) {
    if e.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: e) }
  }
}
let titleBarHeight: CGFloat = 28
let macCSS = """
html.mac-app:not(.fullscreen) body { padding-top: \(Int(titleBarHeight) + 4)px !important; }
"""

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, NSMenuDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var status: NSStatusItem!
  let agentLine = NSMenuItem(title: L("同步：等待登录", "Sync: waiting for sign-in"), action: nil, keyEquivalent: "")
  var syncState = ""
  let local = LocalFiles()
  lazy var watcher = FolderWatcher { [weak self] in self?.web.evaluateJavaScript("window.suijiLocal?.changed()") }

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMainMenu()
    buildWindow()
    watcher.watch(local.folders)
    if !testing || ProcessInfo.processInfo.environment["SUIJI_MAGPIE"] != nil { makeMagpieLink() }
    if testing { return }   // a test copy runs unseen: no window, menu bar item or updates, and leaves the agent alone
    retireAgent()
    window.makeKeyAndOrderFront(nil)
    buildStatusItem()
    setDockIcon(UserDefaults.standard.string(forKey: "iconStyle") ?? "")
    NSApp.activate(ignoringOtherApps: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.checkForUpdates(manual: false) }
    Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in self.checkForUpdates(manual: false) }
  }

  func applicationWillTerminate(_ n: Notification) {
    if let next = stagedUpdate { install(next, relaunch: false) }   // 「退出时更新」
  }

  // MARK: self-update
  // The web content updates itself on every deploy; this replaces the app bundle when a newer build is published.
  // A newer build is downloaded in the background, checked, then installed on restart or on quit.

  var stagedUpdate: URL?
  var checking = false

  @objc func checkNow() { checkForUpdates(manual: true) }

  func checkForUpdates(manual: Bool) {
    if checking { return }
    if let next = stagedUpdate { if manual { offerRestart(next) }; return }
    checking = true
    var req = URLRequest(url: updateFeed); req.cachePolicy = .reloadIgnoringLocalCacheData
    URLSession.shared.dataTask(with: req) { data, _, err in
      let release = data.flatMap { try? JSONDecoder().decode(Release.self, from: $0) }
      DispatchQueue.main.async {
        guard let r = release, let zip = URL(string: r.url, relativeTo: updateFeed)?.absoluteURL else {
          self.checking = false
          if manual { self.tell(L("检查更新失败", "Couldn’t check for updates"), err?.localizedDescription ?? L("没有读到版本信息。", "No version information was found.")) }
          return
        }
        guard r.build > currentBuild else {
          self.checking = false
          if manual { self.tell(L("已是最新版本", "You’re up to date"), L("随记 \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "") 是最新的。", "Suiji \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "") is the latest version.")) }
          return
        }
        self.download(zip, release: r, manual: manual)
      }
    }.resume()
  }

  func download(_ zip: URL, release r: Release, manual: Bool) {
    URLSession.shared.downloadTask(with: zip) { file, _, err in
      var staged: URL? = nil, problem = err?.localizedDescription ?? L("下载失败。", "The download failed.")
      if let file {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("suiji-update-\(r.build)")
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if run("/usr/bin/ditto", ["-x", "-k", file.path, dir.path]).status == 0,
           let app = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?.first(where: { $0.pathExtension == "app" }),
           let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")),
           info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
           Int(info["CFBundleVersion"] as? String ?? "") == r.build,
           run("/usr/bin/codesign", ["--verify", "--deep", app.path]).status == 0 {
          staged = app
        } else { problem = L("下载的安装包不完整或签名不对，已丢弃。", "The download was incomplete or wrongly signed, so it was discarded.") }
      }
      DispatchQueue.main.async {
        self.checking = false
        if let staged { self.stagedUpdate = staged; self.offerRestart(staged, release: r) }
        else if manual { self.tell(L("更新失败", "Update failed"), problem) }
      }
    }.resume()
  }

  func offerRestart(_ next: URL, release r: Release? = nil) {
    let a = NSAlert()
    a.messageText = r.map { L("随记 \($0.version) 已下载", "Suiji \($0.version) is ready") } ?? L("新版本已下载", "A new version is ready")
    a.informativeText = (r?.notes.map { $0 + "\n\n" } ?? "") + L("重启随记就能用上新版本；也可以等下次退出时再更新。", "Restart Suiji to use it, or let it update the next time you quit.")
    a.addButton(withTitle: L("立即重启", "Restart Now")); a.addButton(withTitle: L("退出时更新", "Update on Quit"))
    if a.runModal() == .alertFirstButtonReturn { install(next, relaunch: true); NSApp.terminate(nil) }
  }

  // Swaps the bundle once this process has exited (a running app cannot replace itself), then optionally reopens it.
  func install(_ next: URL, relaunch: Bool) {
    stagedUpdate = nil
    let script = """
    while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
    old="$2"; new="$3"
    rm -rf "$old.previous" && mv "$old" "$old.previous" && mv "$new" "$old" && rm -rf "$old.previous" || { [ -d "$old" ] || mv "$old.previous" "$old"; }
    xattr -dr com.apple.quarantine "$old" 2>/dev/null
    [ "$4" = 1 ] && open "$old"
    exit 0
    """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", script, "sh", String(getpid()), Bundle.main.bundlePath, next.path, relaunch ? "1" : "0"]
    try? p.run()
  }

  func tell(_ title: String, _ text: String) {
    let a = NSAlert(); a.messageText = title; a.informativeText = text; a.runModal()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showWindow(); return true
  }

  // MARK: style icon
  // The page reports its style (玻璃 / 纸张 / 终端 / 方块) and the Dock icon follows it while the app runs.
  // The bundle's own icon, which Finder and Launchpad show, stays the glass one.

  func setDockIcon(_ style: String) {
    UserDefaults.standard.set(style, forKey: "iconStyle")
    let url = style.isEmpty ? nil : Bundle.main.url(forResource: "AppIcon-" + style, withExtension: "png")
    NSApp.applicationIconImage = url.flatMap { NSImage(contentsOf: $0) }   // nil restores the bundle icon
  }

  func fromApp(_ m: WKScriptMessage) -> Bool {
    m.frameInfo.isMainFrame && m.frameInfo.securityOrigin.host == appURL.host && m.frameInfo.securityOrigin.port == (appURL.port ?? 0)
  }

  // The page reports its style and language: {style, lang}.
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard fromApp(m), let body = m.body as? [String: Any] else { return }
    if let style = body["style"] as? String, ["", "paper", "terminal", "blocks", "ink", "eink", "notebook", "swiss", "neon", "blueprint", "clay", "sunset", "eyecare"].contains(style),
       style != UserDefaults.standard.string(forKey: "iconStyle") ?? "" { setDockIcon(style) }
    if let lang = body["lang"] as? String, ["zh", "en"].contains(lang), lang != appLang {
      appLang = lang; UserDefaults.standard.set(lang, forKey: "lang")
      buildMainMenu(); buildStatusItem(); window.title = L("随记", "Suiji")
    }
  }

  // MARK: local folders
  // The file bridge for public/localsync.js. File work runs off the main thread; replies come back on it.

  let io = DispatchQueue(label: "app.suiji.local-files")
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard fromApp(m), let body = m.body as? [String: Any] else { return replyHandler(nil, "not allowed") }
    switch body["op"] as? String {
    case "addFolder":
      let panel = NSOpenPanel()
      panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
      panel.prompt = L("同步这个文件夹", "Sync This Folder")
      panel.message = L("选一个文件夹，随记会直接读写它，并和云端同步。", "Choose a folder. Suiji reads and writes it directly and syncs it with the cloud.")
      panel.beginSheetModal(for: window) { r in
        guard r == .OK, let url = panel.url else { return replyHandler(NSNull(), nil) }
        let folders = self.local.add(url)
        self.watcher.watch(folders)
        replyHandler(folders, nil)
      }
    case "status":
      syncState = body["text"] as? String ?? ""
      replyHandler(nil, nil)
    case "magpieLink":
      // {enabled, model, url, key} once 随记 is connected on Magpie's Agents page, else enabled is false.
      guard let d = try? Data(contentsOf: magpieLink), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return replyHandler(nil, nil) }
      let g = j["gateway"] as? [String: Any] ?? [:]
      replyHandler(["enabled": j["enabled"] as? Bool ?? false, "model": j["model"] as? String ?? "", "url": g["url"] as? String ?? "", "key": g["key"] as? String ?? ""], nil)
    case "localHttp":
      // The assistant's model on this computer (Magpie, Ollama…): WebKit won't let the https page call
      // http://127.0.0.1, so the app makes the request. Only loopback addresses; the answer comes back whole.
      guard let s = body["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? ""),
            ["127.0.0.1", "localhost", "::1"].contains(u.host?.lowercased() ?? "") else { return replyHandler(nil, "only addresses on this computer") }
      var req = URLRequest(url: u, timeoutInterval: 600)
      req.httpMethod = body["method"] as? String ?? "GET"
      req.setValue("Suiji/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")", forHTTPHeaderField: "User-Agent")   // how Magpie tells 随记's requests apart
      for (k, v) in body["headers"] as? [String: String] ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
      if let b = body["body"] as? String { req.httpBody = Data(b.utf8) }
      URLSession.shared.dataTask(with: req) { data, res, err in
        let reply: [String: Any] = ["status": (res as? HTTPURLResponse)?.statusCode ?? 0, "body": data.flatMap { String(data: $0, encoding: .utf8) } ?? ""]
        DispatchQueue.main.async { err != nil && res == nil ? replyHandler(nil, err!.localizedDescription) : replyHandler(reply, nil) }
      }.resume()
    default:
      io.async {
        let result: Result<Any?, Error> = Result { try self.local.handle(body) }
        DispatchQueue.main.async {
          switch result {
          case .success(let v): replyHandler(v, nil)
          case .failure(let e): replyHandler(nil, e.localizedDescription)
          }
          if body["op"] as? String == "removeFolder" { self.watcher.watch(self.local.folders) }
        }
      }
    }
  }

  // Magpie lists 随记 on its Agents page once this file exists; it fills it in when 随记 is connected there.
  func makeMagpieLink() {
    let fm = FileManager.default
    guard !fm.fileExists(atPath: magpieLink.path) else { return }
    try? fm.createDirectory(at: magpieLink.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let empty = #"{"schemaVersion":1,"enabled":false,"model":"","gateway":{"url":"","key":""}}"# + "\n"
    fm.createFile(atPath: magpieLink.path, contents: Data(empty.utf8), attributes: [.posixPermissions: 0o600])
  }

  // The Node agent (npm run sync install) syncs the same folders from the same state; the app does that
  // now, so its launchd job is stopped and its plist set aside (the agent itself still works by hand).
  func retireAgent() {
    guard FileManager.default.fileExists(atPath: agentPlist.path) else { return }
    run("/bin/launchctl", ["bootout", "gui/\(getuid())", agentPlist.path])
    let aside = agentPlist.appendingPathExtension("disabled")
    try? FileManager.default.removeItem(at: aside)
    try? FileManager.default.moveItem(at: agentPlist, to: aside)
    local.appendLog(Date().description + " 随记 App 接管了文件夹同步，已停用后台的 Node 同步程序")
  }

  // MARK: window

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()   // keeps the sign-in and the document cache between launches
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    let js = "document.documentElement.classList.add('mac-app');" +
      "const s=document.createElement('style');s.textContent=\(String(reflecting: macCSS));document.head.append(s);"
    config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    config.userContentController.add(self, name: "suiji")
    config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "suijiFs")
    // Keep the page (and so the sync) running at full speed while the window is closed or hidden.
    if #available(macOS 14.0, *) { config.preferences.inactiveSchedulingPolicy = .none }
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")   // 检查元素 in the system menu (⇧ + right-click)
    web = WKWebView(frame: .zero, configuration: config)
    if #available(macOS 13.3, *) { web.isInspectable = true }
    web.navigationDelegate = self; web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = false
    web.allowsMagnification = true
    web.load(URLRequest(url: appURL))

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                      backing: .buffered, defer: false)
    window.title = L("随记", "Suiji")
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.minSize = NSSize(width: 380, height: 480)
    let root = NSView(frame: window.contentLayoutRect)
    web.frame = root.bounds; web.autoresizingMask = [.width, .height]
    let strip = DragStrip(frame: NSRect(x: 0, y: root.bounds.height - titleBarHeight, width: root.bounds.width, height: titleBarHeight))
    strip.autoresizingMask = [.width, .minYMargin]
    root.addSubview(web); root.addSubview(strip)
    window.contentView = root
    for (name, on) in [(NSWindow.didEnterFullScreenNotification, true), (NSWindow.didExitFullScreenNotification, false)] {
      NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
        strip.isHidden = on
        self?.web.evaluateJavaScript("document.documentElement.classList.toggle('fullscreen', \(on))")
      }
    }
    window.isReleasedWhenClosed = false
    window.center()
    window.setFrameAutosaveName("SuijiMain")
  }

  @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
  // WebKit's inspector, like a browser's developer tools. WebKit only opens it from its own menu, so this
  // reaches its private inspector object; if a later macOS drops that, ⇧ + right-click → 检查元素 still works.
  @objc func showInspector() {
    guard let i = web.value(forKey: "_inspector") as? NSObject, i.responds(to: Selector(("show"))) else { NSSound.beep(); return }
    i.perform(Selector(("show")))
  }

  @objc func reload() { web.reload() }
  @objc func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 2) }
  @objc func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.6) }
  @objc func zoomReset() { web.pageZoom = 1 }

  // Pages of the app stay in the window; storage links download; everything else (the blog, any link
  // in a note) opens in the default browser.
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = a.request.url else { return decisionHandler(.cancel) }
    if a.shouldPerformDownload || isStorage(url) && a.targetFrame?.isMainFrame != false && a.navigationType == .linkActivated {
      return decisionHandler(.download)
    }
    if url.host == appURL.host || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" || a.targetFrame?.isMainFrame == false {
      return decisionHandler(.allow)
    }
    if a.navigationType == .linkActivated { NSWorkspace.shared.open(url); return decisionHandler(.cancel) }
    decisionHandler(.allow)
  }

  func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (r.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    decisionHandler(r.canShowMIMEType && !disposition.lowercased().hasPrefix("attachment") ? .allow : .download)
  }

  func isStorage(_ url: URL) -> Bool { url.path.contains("/storage/v1/object/") }

  // target="_blank" links and window.open
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if let url = a.request.url {
      if isStorage(url) && url.query?.contains("download") == true { w.load(URLRequest(url: url)) }   // goes to the download path above
      else { NSWorkspace.shared.open(url) }
    }
    return nil
  }

  // <input type=file>, including folder pickers (webkitdirectory)
  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = p.allowsMultipleSelection
    panel.canChooseDirectories = p.allowsDirectories
    panel.canChooseFiles = !p.allowsDirectories
    panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = m; a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = m; a.addButton(withTitle: L("好", "OK")); a.addButton(withTitle: L("取消", "Cancel"))
    a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  // MARK: downloads, saved to ~/Downloads without asking (like Safari)

  func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
  func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }

  func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let ext = (name as NSString).pathExtension, stem = (name as NSString).deletingPathExtension
    var dest = dir.appendingPathComponent(name), i = 2
    while FileManager.default.fileExists(atPath: dest.path) {
      dest = dir.appendingPathComponent(ext.isEmpty ? "\(stem) \(i)" : "\(stem) \(i).\(ext)"); i += 1
    }
    completionHandler(dest)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSWorkspace.shared.activateFileViewerSelecting([dest]) }
  }

  // MARK: menu bar item for the folder sync

  func buildStatusItem() {
    if status != nil { NSStatusBar.system.removeStatusItem(status) }   // rebuilt when the language changes
    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status.button?.image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: L("随记同步", "Suiji sync"))
    let m = NSMenu(); m.delegate = self
    agentLine.isEnabled = false
    m.addItem(agentLine)
    m.addItem(.separator())
    m.addItem(withTitle: L("立即同步", "Sync Now"), action: #selector(syncNow), keyEquivalent: "")
    m.addItem(withTitle: L("打开同步的文件夹", "Open Synced Folder"), action: #selector(openFolder), keyEquivalent: "")
    m.addItem(withTitle: L("查看同步日志", "Show Sync Log"), action: #selector(openLog), keyEquivalent: "")
    m.addItem(withTitle: L("检查更新…", "Check for Updates…"), action: #selector(checkNow), keyEquivalent: "")
    let login = m.addItem(withTitle: L("登录时打开", "Open at Login"), action: #selector(toggleLogin), keyEquivalent: "")
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    m.addItem(.separator())
    m.addItem(withTitle: L("打开随记", "Open Suiji"), action: #selector(showWindow), keyEquivalent: "")
    m.addItem(withTitle: L("退出随记", "Quit Suiji"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    status.menu = m
  }

  func menuWillOpen(_ m: NSMenu) {
    let n = local.folders.count
    let state = ["syncing": L("同步中…", "syncing…"), "ok": L("已同步", "up to date"), "offline": L("离线", "offline"), "error": L("出错，稍后重试", "error, retrying soon")][syncState]
    agentLine.title = n == 0 ? L("同步：还没有本地文件夹（设置 → 本地文件夹）", "Sync: no local folders yet (Settings → Local folders)")
      : L("同步：\(n) 个文件夹 · ", "Sync: \(n) folder\(n == 1 ? "" : "s") · ") + (state ?? L("等待登录", "waiting for sign-in"))
  }

  @objc func syncNow() { web.evaluateJavaScript("window.suijiLocal?.kick(0)") }
  @objc func openLog() { NSWorkspace.shared.open(suijiHome.appendingPathComponent("sync.log")) }
  @objc func openFolder() { local.folders.forEach { NSWorkspace.shared.open(URL(fileURLWithPath: $0)) } }
  @objc func toggleLogin(_ item: NSMenuItem) {
    do {
      if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
    } catch { tell(L("没能更改登录项", "Couldn’t change the login item"), error.localizedDescription) }
    item.state = SMAppService.mainApp.status == .enabled ? .on : .off
  }

  // MARK: main menu (the Edit menu is what makes ⌘C/⌘V/⌘Z work inside the web view)

  func buildMainMenu() {
    let main = NSMenu()
    func sub(_ title: String, _ items: [NSMenuItem]) {
      let item = NSMenuItem(), menu = NSMenu(title: title)
      items.forEach(menu.addItem); item.submenu = menu; main.addItem(item)
    }
    func mi(_ t: String, _ a: Selector?, _ k: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i
    }
    sub(L("随记", "Suiji"), [mi(L("关于随记", "About Suiji"), #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), mi(L("检查更新…", "Check for Updates…"), #selector(checkNow), ""), .separator(),
               mi(L("隐藏随记", "Hide Suiji"), #selector(NSApplication.hide(_:)), "h"),
               mi(L("隐藏其他", "Hide Others"), #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
               mi(L("退出随记", "Quit Suiji"), #selector(NSApplication.terminate(_:)), "q")])
    sub(L("编辑", "Edit"), [mi(L("撤销", "Undo"), Selector(("undo:")), "z"), mi(L("重做", "Redo"), Selector(("redo:")), "z", [.command, .shift]), .separator(),
               mi(L("剪切", "Cut"), #selector(NSText.cut(_:)), "x"), mi(L("拷贝", "Copy"), #selector(NSText.copy(_:)), "c"),
               mi(L("粘贴", "Paste"), #selector(NSText.paste(_:)), "v"), mi(L("全选", "Select All"), #selector(NSText.selectAll(_:)), "a")])
    sub(L("显示", "View"), [mi(L("重新载入", "Reload"), #selector(reload), "r"), .separator(),
               mi(L("放大", "Zoom In"), #selector(zoomIn), "="), mi(L("缩小", "Zoom Out"), #selector(zoomOut), "-"), mi(L("实际大小", "Actual Size"), #selector(zoomReset), "0"), .separator(),
               mi(L("进入全屏幕", "Enter Full Screen"), #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]), .separator(),
               mi(L("网页检查器", "Web Inspector"), #selector(showInspector), "i", [.command, .option])])
    sub(L("窗口", "Window"), [mi(L("最小化", "Minimize"), #selector(NSWindow.performMiniaturize(_:)), "m"), mi(L("关闭窗口", "Close Window"), #selector(NSWindow.performClose(_:)), "w"),
               .separator(), mi(L("随记", "Suiji"), #selector(showWindow), "1")])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(testing ? .prohibited : .regular)
app.run()
