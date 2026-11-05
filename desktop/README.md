# 随记 for Mac (Electron)

An Electron build of the Mac app, meant to replace the Swift app in [`../mac`](../mac). It loads https://suiji-notes.vercel.app and gives the page the same bridge as the Swift app. `preload.js` exposes `window.webkit.messageHandlers.suijiFs` and `.suiji` with the same shape, so nothing in `public/` changes. `mac/` stays as it is until you decide to switch.

```sh
sh desktop/build.sh             # dist/mac-arm64/随记.app, ad-hoc signed, Apple silicon only
sh desktop/build.sh --install   # also copies it to /Applications, replacing the Swift app
sh desktop/build.sh --publish   # dist/Suiji-2.0.zip for the GitHub release v2.0, and public/mac/version.json pointing at it
```

To release: raise `BUILD` (and `VERSION`) in `build.sh`, run it with `--publish`, upload the zip to the release `v<VERSION>` (`gh release upload` or `gh release create`), then deploy so `version.json` goes live. Upload first: once the feed is live, installed apps fetch the zip from the release.

Versions are pinned exactly: Electron 44.9.3 and electron-builder 26.18.0. `npm start` in this folder runs it unpackaged.

| File | What it does |
|---|---|
| `main.js` | Window, menus, menu bar item, Dock icons, login item, downloads, links, self-update, and the bridge ops `addFolder`, `status`, `magpieLink` and `localHttp` |
| `localfiles.js` | Port of `mac/LocalFiles.swift`: the folder ops (`folders`, `removeFolder`, `walk`, `stat`, `read`, `readText`, `write`, `loadState`, `saveState`, `log`) with the same path checks, plus the folder watcher |
| `preload.js` | The `window.webkit.messageHandlers` bridge, the `mac-app` class and the title-bar drag strip |

## Compared with the Swift app

| | Swift (mac/, 1.9) | Electron (desktop/, 2.0.0) |
|---|---|---|
| App size | 2.2 MB (universal) | 262 MB (Apple silicon only) |
| Update download (zip) | 1.7 MB | 113 MB |
| Memory, page loaded and idle (RSS, all processes) | ≈155 MB: 78 MB app + 77 MB in 3 WebKit processes | ≈185 MB in 4 processes |
| Right-click → Inspect Element | Only with ⇧ + right-click → 检查元素, or a private WebKit call | Always in the system menu (spelling, Look Up, links, images, cut/copy/paste, Inspect Element); ⌥⌘I opens DevTools |
| Engine | WebKit, same as Safari | Chromium, bundled and updated with the app |
| `localHttp` | Needed, because WebKit blocks https → http://127.0.0.1 | Kept so `public/agent.js` works unchanged; requests go through Chromium's network stack in the main process |

Memory was measured on the hidden test copies against a local server (macOS 27, M-series). The numbers are approximate.

Both apps have the same features:
- the folder sync bridge;
- `localHttp`, loopback only, sending `User-Agent: Suiji/<version>`;
- `magpieLink`, and creating `~/.config/suiji/magpie.json` (0600) on launch;
- per-style Dock icons from `mac/AppIcon-*.png`, and the interface language reported by the page;
- the menu bar item, whose status line is rebuilt each time it opens;
- the app menus;
- keep running with the window closed;
- open at login (SMAppService, through `app.setLoginItemSettings`);
- retiring the Node agent's launchd job;
- downloads saved to ~/Downloads;
- external links opened in the default browser;
- remembering the window position.

## Switching from the Swift app

- **Same bundle ID, `app.suiji.mac`.** The Electron app reads the Swift app's settings (`lang`, `iconStyle`, `updateFeed`) from the same defaults domain. Its login item and folder state (`~/.suiji`) carry over too.
- **Sign in again once.** Web storage is not shared: WKWebView's data store is not Chromium's profile (`~/Library/Application Support/随记`).
- **Updates.** These replace `mac/version.json` with the same feed format and the same mechanism. electron-updater/Squirrel needs a Developer ID signature, so it can't update an ad-hoc-signed app. Instead, `main.js` ports the Swift updater:
  - it reads `https://suiji-notes.vercel.app/mac/version.json`, or the `updateFeed` default;
  - it downloads the zip, then checks the bundle ID, the build number and `codesign --verify --deep`;
  - it swaps the bundle on restart or on quit.

  The Electron build is build 10; the Swift app is at 9. So publishing it moves installed Swift apps to Electron on their next update check.
- **Where the zip lives.** The 113 MB zip is too big for git, so it is a GitHub release asset (`Suiji-<VERSION>.zip`, as with earlier releases). `version.json` stays on the site and points at it; both updaters follow the redirect to GitHub's download host.
- **Apple silicon only.** The Swift app is universal and its updater does not check the architecture, so an Intel Mac running it would install this build and fail to open it. Leave Intel users on the Swift app (or build a universal one) before publishing if that matters.
- **Hardening.** The build turns off the `RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses and loads the app only from its asar. Ad-hoc signing does not protect against these, so they are off. Chromium's `--remote-debugging-port` still works for testing.

## Testing

As with the Swift app: `SUIJI_HOME` makes a hidden test copy with no window, Dock icon, menu bar item or updates. It keeps its folder state, sign-in and settings under that folder and leaves the Node agent alone. `SUIJI_URL` points it at a local server, and `SUIJI_MAGPIE` moves the Magpie file.

```sh
SUIJI_HOME=/tmp/t/home SUIJI_URL=http://127.0.0.1:5199/ SUIJI_MAGPIE=/tmp/t/magpie.json \
  "desktop/dist/mac-arm64/随记.app/Contents/MacOS/Suiji" --remote-debugging-port=9333
```

Then drive the page over the DevTools protocol, for example `Runtime.evaluate` of `window.webkit.messageHandlers.suijiFs.postMessage({op: "walk", path})`.

This was checked against `python3 -m http.server` serving `public/`:
- every op, including its errors;
- a symlink or `..` out of a synced folder is refused;
- a Hexo `_config.yml` can be read but not written;
- the watcher calls `suijiLocal.changed()`;
- `localHttp` sends the method, headers and body and returns the status;
- non-loopback hosts are refused;
- the Magpie file is created and read.

The normal startup was smoke-tested under a throwaway `HOME`: menus, menu bar item, Dock icon, window, with no errors.

Not yet tested end to end:
- self-update between two builds, which needs a local feed set with `defaults write app.suiji.mac updateFeed`;
- the Swift app updating to this build;
- the open-at-login toggle.
