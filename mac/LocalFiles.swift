// The page's access to local folders (public/localsync.js). The page can only reach the folders the user
// picked in an open panel (~/.suiji/config.json, shared with the Node agent), plus a Hexo `_posts` folder's
// _config.yml, and the sync's own state and log in ~/.suiji.
import Foundation

let suijiHome = ProcessInfo.processInfo.environment["SUIJI_HOME"].map { URL(fileURLWithPath: $0) }
  ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".suiji")

final class LocalFiles {
  struct Failure: Error, LocalizedError { let errorDescription: String? }
  static let skip: Set<String> = ["node_modules", ".git", ".DS_Store", "Thumbs.db"]
  let fm = FileManager.default
  var configURL: URL { suijiHome.appendingPathComponent("config.json") }

  // MARK: config

  var folders: [String] {
    get {
      guard let data = try? Data(contentsOf: configURL),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
      return obj["folders"] as? [String] ?? []
    }
    set {
      var obj = (try? Data(contentsOf: configURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
      obj["folders"] = newValue
      try? save(JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .withoutEscapingSlashes]), to: configURL)
    }
  }

  func add(_ url: URL) -> [String] {
    let root = url.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    if !folders.contains(root) { folders.append(root) }
    return folders
  }
  func remove(_ root: String) -> [String] {
    folders.removeAll { $0 == root }
    return folders
  }

  // The real location of a path, symlinks resolved, including the part that does not exist yet.
  func real(_ path: String) -> String {
    var head = URL(fileURLWithPath: path).standardizedFileURL, tail: [String] = []
    while !fm.fileExists(atPath: head.path), head.path != "/" { tail.insert(head.lastPathComponent, at: 0); head.deleteLastPathComponent() }
    return tail.reduce(head.resolvingSymlinksInPath()) { $0.appendingPathComponent($1) }.path
  }

  // A path the page may use: inside a synced folder once symlinks are resolved, or a `_posts` folder's _config.yml.
  func allowed(_ path: String, write: Bool = false) throws -> String {
    let p = real(path)
    for root in folders {
      let r = real(root)
      if p == r || p.hasPrefix(r + "/") { return path }
      if !write, (root as NSString).lastPathComponent == "_posts",
         p == real(((root as NSString).deletingLastPathComponent as NSString).deletingLastPathComponent + "/_config.yml") { return path }
    }
    throw Failure(errorDescription: "not in a synced folder: \(path)")
  }

  // MARK: files

  func stat(_ path: String) -> [String: Any]? {
    var st = Darwin.stat()
    guard lstat(path, &st) == 0 else { return nil }
    // Same rounding as Node's Math.round(stat.mtimeMs), so the state file means the same to both.
    let ms = (Double(st.st_mtimespec.tv_sec) * 1000 + Double(st.st_mtimespec.tv_nsec) / 1e6).rounded()
    return ["size": Int(st.st_size), "mtimeMs": ms]
  }

  func walk(_ root: String) -> [[String: Any]] {
    var out: [[String: Any]] = []
    func visit(_ dir: String) {
      guard let names = try? fm.contentsOfDirectory(atPath: dir) else { return }
      for name in names.sorted() {
        if name.hasPrefix(".") || LocalFiles.skip.contains(name) || name.hasSuffix("~") { continue }
        let abs = dir + "/" + name
        var st = Darwin.stat()
        guard lstat(abs, &st) == 0 else { continue }
        switch st.st_mode & S_IFMT {
        case S_IFDIR: visit(abs)
        case S_IFREG:
          var f = stat(abs)!; f["rel"] = String(abs.dropFirst(root.count + 1)); out.append(f)
        default: break   // symlinks and the rest, as the Node agent does
        }
      }
    }
    visit(root)
    return out
  }

  func save(_ data: Data, to url: URL) throws {
    try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
  }

  func appendLog(_ line: String) {
    let url = suijiHome.appendingPathComponent("sync.log")
    try? fm.createDirectory(at: suijiHome, withIntermediateDirectories: true)
    if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
    guard let h = try? FileHandle(forWritingTo: url) else { return }
    h.seekToEndOfFile(); h.write((line + "\n").data(using: .utf8)!); try? h.close()
  }

  // One request from the page; returns what the promise resolves to, or throws to reject it.
  // addFolder needs an open panel, so the app handles it before calling this.
  func handle(_ body: [String: Any]) throws -> Any? {
    let path = body["path"] as? String ?? ""
    switch body["op"] as? String {
    case "folders": return folders
    case "removeFolder": return remove(path)
    case "walk":
      guard folders.contains(path) else { throw Failure(errorDescription: "not a synced folder: \(path)") }
      return walk(path)
    case "stat": return stat(try allowed(path)) ?? NSNull()
    case "read":
      return try Data(contentsOf: URL(fileURLWithPath: try allowed(path))).base64EncodedString()
    case "readText":
      return (try? String(contentsOfFile: try allowed(path), encoding: .utf8)) ?? NSNull()
    case "write":
      guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { throw Failure(errorDescription: "bad data") }
      try save(data, to: URL(fileURLWithPath: try allowed(path, write: true)))
      return nil
    case "loadState":
      return (try? String(contentsOf: suijiHome.appendingPathComponent("state.json"), encoding: .utf8)) ?? NSNull()
    case "saveState":
      guard let s = body["state"] as? String, let data = s.data(using: .utf8),
            (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw Failure(errorDescription: "bad state") }
      try save(data, to: suijiHome.appendingPathComponent("state.json"))
      return nil
    case "log": appendLog(body["line"] as? String ?? ""); return nil
    default: throw Failure(errorDescription: "unknown op")
    }
  }
}

// Calls back (on the main queue, at most every half second) when anything under the folders changes.
final class FolderWatcher {
  private var stream: FSEventStreamRef?
  private let onChange: () -> Void
  init(onChange: @escaping () -> Void) { self.onChange = onChange }

  func watch(_ folders: [String]) {
    if let s = stream { FSEventStreamStop(s); FSEventStreamInvalidate(s); FSEventStreamRelease(s); stream = nil }
    guard !folders.isEmpty else { return }
    var ctx = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
    let cb: FSEventStreamCallback = { _, info, _, _, _, _ in
      Unmanaged<FolderWatcher>.fromOpaque(info!).takeUnretainedValue().onChange()
    }
    stream = FSEventStreamCreate(nil, cb, &ctx, folders as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.5,
                                 FSEventStreamCreateFlags(kFSEventStreamCreateFlagNoDefer))
    guard let s = stream else { return }
    FSEventStreamSetDispatchQueue(s, .main)
    FSEventStreamStart(s)
  }
}
