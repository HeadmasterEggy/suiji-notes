// 随记 for Mac: the web app in a native window, plus a menu bar item for the folder sync agent
// (agent/suiji-sync.mjs, run by launchd as app.suiji.sync). Build with mac/build.sh.
import AppKit
import WebKit

let appURL = URL(string: "https://suiji-notes.vercel.app/")!
let agentLabel = "app.suiji.sync"
let suijiHome = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".suiji")
// Published by `mac/build.sh --publish`; `defaults write app.suiji.mac updateFeed <url>` points it elsewhere for testing.
let updateFeed = URL(string: UserDefaults.standard.string(forKey: "updateFeed") ?? "https://suiji-notes.vercel.app/mac/version.json")!
let currentBuild = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0

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

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, NSMenuDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var status: NSStatusItem!
  let agentLine = NSMenuItem(title: "同步：检查中…", action: nil, keyEquivalent: "")

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMainMenu()
    buildWindow()
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
          if manual { self.tell("检查更新失败", err?.localizedDescription ?? "没有读到版本信息。") }
          return
        }
        guard r.build > currentBuild else {
          self.checking = false
          if manual { self.tell("已是最新版本", "随记 \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "") 是最新的。") }
          return
        }
        self.download(zip, release: r, manual: manual)
      }
    }.resume()
  }

  func download(_ zip: URL, release r: Release, manual: Bool) {
    URLSession.shared.downloadTask(with: zip) { file, _, err in
      var staged: URL? = nil, problem = err?.localizedDescription ?? "下载失败。"
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
        } else { problem = "下载的安装包不完整或签名不对，已丢弃。" }
      }
      DispatchQueue.main.async {
        self.checking = false
        if let staged { self.stagedUpdate = staged; self.offerRestart(staged, release: r) }
        else if manual { self.tell("更新失败", problem) }
      }
    }.resume()
  }

  func offerRestart(_ next: URL, release r: Release? = nil) {
    let a = NSAlert()
    a.messageText = r.map { "随记 \($0.version) 已下载" } ?? "新版本已下载"
    a.informativeText = (r?.notes.map { $0 + "\n\n" } ?? "") + "重启随记就能用上新版本；也可以等下次退出时再更新。"
    a.addButton(withTitle: "立即重启"); a.addButton(withTitle: "退出时更新")
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

  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard m.frameInfo.isMainFrame, m.frameInfo.securityOrigin.host == appURL.host,
          let body = m.body as? [String: Any], let style = body["style"] as? String,
          ["", "paper", "terminal", "blocks"].contains(style) else { return }
    if style != UserDefaults.standard.string(forKey: "iconStyle") ?? "" { setDockIcon(style) }
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
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self; web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = false
    web.allowsMagnification = true
    web.load(URLRequest(url: appURL))

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                      backing: .buffered, defer: false)
    window.title = "随记"
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
    window.makeKeyAndOrderFront(nil)
  }

  @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
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
    let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "好"); a.addButton(withTitle: "取消")
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

  // MARK: menu bar item for the sync agent

  func buildStatusItem() {
    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status.button?.image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "随记同步")
    let m = NSMenu(); m.delegate = self
    agentLine.isEnabled = false
    m.addItem(agentLine)
    m.addItem(.separator())
    m.addItem(withTitle: "立即同步", action: #selector(syncNow), keyEquivalent: "")
    m.addItem(withTitle: "打开同步的文件夹", action: #selector(openFolder), keyEquivalent: "")
    m.addItem(withTitle: "查看同步日志", action: #selector(openLog), keyEquivalent: "")
    m.addItem(withTitle: "检查更新…", action: #selector(checkNow), keyEquivalent: "")
    m.addItem(.separator())
    m.addItem(withTitle: "打开随记", action: #selector(showWindow), keyEquivalent: "")
    m.addItem(withTitle: "退出随记", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    status.menu = m
  }

  func menuWillOpen(_ m: NSMenu) { agentLine.title = agentState() }

  func agentState() -> String {
    let r = run("/bin/launchctl", ["print", "gui/\(getuid())/\(agentLabel)"])
    if r.status != 0 { return "同步：未安装（运行 npm run sync install）" }
    let running = r.out.contains("state = running")
    let last = (try? String(contentsOf: suijiHome.appendingPathComponent("sync.log"), encoding: .utf8))?
      .split(separator: "\n").last.map { String($0.prefix(48)) } ?? ""
    return (running ? "同步：运行中" : "同步：已停止") + (last.isEmpty ? "" : " · " + last)
  }

  @objc func syncNow() { run("/bin/launchctl", ["kickstart", "-k", "gui/\(getuid())/\(agentLabel)"]) }
  @objc func openLog() { NSWorkspace.shared.open(suijiHome.appendingPathComponent("sync.log")) }
  @objc func openFolder() {
    struct Config: Decodable { let folders: [String] }
    let data = try? Data(contentsOf: suijiHome.appendingPathComponent("config.json"))
    for f in (data.flatMap { try? JSONDecoder().decode(Config.self, from: $0) }?.folders ?? []) {
      NSWorkspace.shared.open(URL(fileURLWithPath: f))
    }
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
    sub("随记", [mi("关于随记", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), mi("检查更新…", #selector(checkNow), ""), .separator(),
               mi("隐藏随记", #selector(NSApplication.hide(_:)), "h"),
               mi("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
               mi("退出随记", #selector(NSApplication.terminate(_:)), "q")])
    sub("编辑", [mi("撤销", Selector(("undo:")), "z"), mi("重做", Selector(("redo:")), "z", [.command, .shift]), .separator(),
               mi("剪切", #selector(NSText.cut(_:)), "x"), mi("拷贝", #selector(NSText.copy(_:)), "c"),
               mi("粘贴", #selector(NSText.paste(_:)), "v"), mi("全选", #selector(NSText.selectAll(_:)), "a")])
    sub("显示", [mi("重新载入", #selector(reload), "r"), .separator(),
               mi("放大", #selector(zoomIn), "="), mi("缩小", #selector(zoomOut), "-"), mi("实际大小", #selector(zoomReset), "0"), .separator(),
               mi("进入全屏幕", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
    sub("窗口", [mi("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"), mi("关闭窗口", #selector(NSWindow.performClose(_:)), "w"),
               .separator(), mi("随记", #selector(showWindow), "1")])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
