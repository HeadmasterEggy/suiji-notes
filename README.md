<div align="center">

<img src="public/icon-512.png" width="128" alt="Suiji icon">

# Suiji 随记

**Notes that sync between iPhone and Mac, with your Markdown folder on both**

[![English](https://img.shields.io/badge/Language-English-0A84FF?style=for-the-badge)](README.md)
[![简体中文](https://img.shields.io/badge/语言-简体中文-E5484D?style=for-the-badge)](README.zh-CN.md)

[![Live](https://img.shields.io/badge/live-suiji--notes.vercel.app-000?style=flat-square&logo=vercel)](https://suiji-notes.vercel.app)
![iPhone](https://img.shields.io/badge/iPhone-PWA-555?style=flat-square&logo=apple)
![macOS](https://img.shields.io/badge/macOS-native%20app-black?style=flat-square&logo=apple)
![Android](https://img.shields.io/badge/Android-app-3DDC84?style=flat-square&logo=android&logoColor=white)
![Supabase](https://img.shields.io/badge/data-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)

<img src="docs/style-glass-light.jpg" width="820" alt="A document with its outline">

<img src="docs/style-glass-light.jpg" width="200" alt="Glass · light">&nbsp;<img src="docs/style-paper-light.jpg" width="200" alt="Paper · light">&nbsp;<img src="docs/style-terminal-light.jpg" width="200" alt="Terminal · light">&nbsp;<img src="docs/style-blocks-light.jpg" width="200" alt="Blocks · light">

<img src="docs/style-glass-dark.jpg" width="200" alt="Glass · dark">&nbsp;<img src="docs/style-paper-dark.jpg" width="200" alt="Paper · dark">&nbsp;<img src="docs/style-terminal-dark.jpg" width="200" alt="Terminal · dark">&nbsp;<img src="docs/style-blocks-dark.jpg" width="200" alt="Blocks · dark">

<sub>Glass, Paper, Terminal and Blocks, each in light (top) and dark (bottom)</sub>

<img src="docs/graph-glass.jpg" width="200" alt="Graph · Glass">&nbsp;<img src="docs/graph-paper.jpg" width="200" alt="Graph · Paper">&nbsp;<img src="docs/graph-terminal.jpg" width="200" alt="Graph · Terminal">&nbsp;<img src="docs/graph-blocks.jpg" width="200" alt="Graph · Blocks">

<sub>The relationship graph in each style</sub>

<img src="docs/phone-list.jpg" width="200" alt="Folder tree on a phone">&nbsp;&nbsp;<img src="docs/phone-doc.jpg" width="200" alt="A document on a phone">&nbsp;&nbsp;<img src="docs/phone-terminal.jpg" width="200" alt="Terminal style on a phone">

</div>

## Features

- **One tree.** Quick notes written in the app sit in a 「随手记」 folder at the top, and the synced folders sit below it. The ⇅ button sorts it by name or by last change.
- **Local folders on the Mac.** Like an Obsidian vault: the Mac app reads and writes your folders on disk, so documents open instantly, even offline. Changes made in the app or in any other editor sync to the cloud, and edits made on the phone are written back to disk within a few seconds.
- **Outline.** Every document has its own outline beside it: click a heading to jump, and the current section stays marked as you scroll. Drag its edge to resize it.
- **Split panes.** Split up, down, left or right, by dragging a file onto a pane's edge or with ⌘-click. The layout is remembered.
- **Styles.** Thirteen looks, picked in 设置 (Settings), each in light and dark (follow the system, or pick one):
  - 玻璃 *Glass*: frosted, see-through panels
  - 纸张 *Paper*: warm paper and serif text; dark is paper by lamplight
  - 终端 *Terminal*: green on black, monospace; light is dark green on pale paper
  - 方块 *Blocks*: a pixel-art world of sky, grass and stone panels; dark is night, with a moon
  - 水墨 *Ink*: rice paper, layered ink and a red seal
  - 墨水屏 *E-ink*: black, white and greys, with no motion or translucency
  - 手帐 *Notebook*: dot-grid paper, washi tape and highlighter
  - 瑞士 *Swiss*: a strict grid, bold sans-serif and one red
  - 霓虹 *Neon*: glowing magenta and cyan signs at night; light is daytime
  - 蓝图 *Blueprint*: white lines on drafting blue, with a coordinate grid
  - 粘土 *Clay*: soft pastels and puffy rounded cards
  - 日落 *Sunset*: an orange-to-violet sky; dark is the starry sky after dusk
  - 护眼 *Eye care*: the soft bean green of eye-care screens, with gentle contrast; dark is warm and low in blue light

  The tab icon, the Mac app's Dock icon, the Android launcher icon and the graph change with the style.
- **Settings.** 设置 at the bottom of the sidebar holds the style, light / dark, text size, the interface language (中文 / English), whether new documents show their outline, widths, sync, the local cache, the account and update checks.
- **Assistant.** The ✦ button (or ⌘J) opens a chat panel on the right, a sheet from the bottom on phones. Ask it to find, summarise or edit your notes: it searches and reads them in the app, and every change it suggests appears as a diff. Nothing changes until you press 应用 (Apply). It runs on your own API key for any OpenAI-compatible service (DeepSeek, OpenRouter, Kimi, GLM, Qwen, OpenAI, or a custom address), set in 设置 → 助手 (Settings → Assistant). The key is stored encrypted in your account, so it works on every device. It can also use a model running on this computer (Magpie, Ollama, LM Studio): pick it under 这台电脑上 (On this computer). That setting stays on this device, and the page talks to the model directly. A browser must be allowed to reach it (in Magpie: Settings → Network and sharing → Web pages); the Mac app doesn't need this. To have Magpie list 随记 on its Agents page, install the plugin in `magpie/` once (`magpie plugin add ./magpie`) and open the Mac app; then connect 随记 there and pick a model, and the Mac app's assistant uses it with nothing to fill in.
- **Relationship graph.** Like Obsidian's graph, built from `[[wikilinks]]`, relative `.md` links and front-matter tags.
- **Markdown.** Math (KaTeX), Mermaid diagrams, and Obsidian's `[[wikilinks]]` (shown by their alias, opening the linked note) and `==highlights==`.
- **Blog links.** Every published post links to its page on the blog (`https://qiao1.top/posts/<abbrlink>.html`).
- **Fast and offline-first.** Documents are cached on the device and prefetched. Notes save on the device first and upload once online.
- **Always current.** Open windows pick up a new deploy by themselves, and the Mac app updates itself.

## Install

- **iPhone:** open <https://suiji-notes.vercel.app> in Safari, tap Share, then 添加到主屏幕 (Add to Home Screen).
- **Android:** download [`Suiji.apk`](https://suiji-notes.vercel.app/android/Suiji.apk) on the phone and open it (allow installing from your browser when asked).
- **Mac app:** build it with `./mac/build.sh --install` (see [Build from source](#build-from-source)). Without the app, Safari's File → Add to Dock works too.
- **Sync a folder from the Mac:** in the Mac app, open 设置 (Settings) → 本地文件夹 (Local folders) → 添加文件夹… (Add Folder…). The app syncs while it runs, including when only its menu bar item is left; its menu has 登录时打开 (Open at Login).

  Without the app, the Node agent does the same from a terminal:

  ```sh
  npm run sync login       # sign in to your Suiji account
  npm run sync add         # choose a folder; it uploads right away
  npm run sync install     # run in the background whenever you log in
  ```

  `npm run sync status` shows the account, folders and file counts. `npm run sync remove ~/some/folder` stops syncing a folder; the cloud copies stay. `npm run sync uninstall` stops the background job. Both use the same folder list and state in `~/.suiji/`, so the app takes over the agent's folders as they are; when it starts, it stops the agent's background job so the two don't sync the same folders.

## Build from source

### Web app

```sh
npx vercel link --yes --project suiji-notes
npx vercel integration add supabase --yes --no-claim
npx vercel env pull .env.local --yes
npm install
npm run db:setup        # creates the tables, policies and storage bucket from schema.sql
npm run dev             # serves the app on port 5173
npx vercel deploy --prod
```

The assistant needs `AI_KEY_SECRET` (any long random string), which encrypts the keys users save. Optionally, `DEEPSEEK_API_KEY` plus `AGENT_OWNER_EMAILS` (comma-separated) let those accounts use the server's DeepSeek key when they haven't added their own. `DEEPSEEK_MODEL` picks its model (default `deepseek-flash`). Changing `AI_KEY_SECRET` makes saved keys unreadable, and users then have to enter them again.

### Mac app

Requires the Xcode Command Line Tools.

```sh
./mac/build.sh             # builds mac/build/随记.app (universal, ad-hoc signed)
./mac/build.sh --install   # also copies it to /Applications
./mac/build.sh --publish   # writes public/mac/Suiji.zip and version.json for the next deploy
```

To release a new build: raise `BUILD` in `mac/build.sh`, run it with `--publish`, then deploy.

### Android app

Requires JDK 17+ and the Android SDK (platform 35, build tools), e.g. `brew install --cask android-commandlinetools`.

```sh
./android/build.sh             # builds the signed android/build/Suiji.apk
./android/build.sh --publish   # also copies it to public/android/Suiji.apk for the next deploy
```

The first run makes the signing key `android/suiji-release.keystore`, with its passwords in `android/keystore.properties`. Both stay out of git; keep a copy, because later builds only install over earlier ones when signed with the same key. Raise `versionCode` in `android/app/build.gradle.kts` for each published build. A debug build (`./gradlew assembleDebug`) opens `http://localhost:5174/` instead, through `adb reverse tcp:5174 tcp:5174`.

## How it works

| Part | Where | What it does |
|---|---|---|
| Web app | `public/` | Plain HTML/JS, no framework, hosted on Vercel |
| Data | Supabase | Postgres tables `notes` and `files`, a private storage bucket, and Realtime. Row-level security means each user sees only their own data. |
| Assistant | `public/agent.js`, `api/agent.js`, `api/ai-key.js` | The page runs the tools (search, read, propose an edit) on the notes it already has. The Vercel function checks the Supabase session and streams the model's next step from the user's own OpenAI-compatible API. Keys live encrypted in the `ai_keys` table, which only the server can read. |
| Folder sync | `public/syncengine.js` | Syncs local folders with the cloud. The Mac app runs it in its page (`public/localsync.js`), through a file bridge limited to the chosen folders (`mac/LocalFiles.swift`); the Node agent `agent/suiji-sync.mjs` runs it without the app. |
| Mac app | `mac/` | Native AppKit window around the web app, with access to the local folders and a menu bar item for the sync |
| Android app | `android/` | WebView around the web app, with the back button, file picking, downloads and a launcher icon per style |

**Notes** are saved on the device, then upserted to `notes`. Other devices receive changes through Realtime. If two devices edit the same note, the last save wins.

**Folder files** sync in both directions:

- **Mac → cloud:** the Mac app (or the agent) watches the folder. New and changed files are uploaded, and deleted files are removed from the cloud. A full rescan every 5 minutes catches anything a watch event missed.
- **Phone → Mac:** an edit saved on another device updates the file's row. The Mac hears about it through Realtime and writes the new version to disk. In the Mac app, an edit is saved to disk first and uploaded from there.
- **Conflicts:** if both sides changed a file since the last sync, the local file is kept and uploaded. The cloud version is saved beside it as 「（随记副本）」.

## Notes

- The Mac window loads the live site, so web changes arrive with every deploy. An open window checks for a new deploy every 10 minutes and when it comes to the front. It reloads by itself when nothing is being edited, and otherwise shows a 「有新版本」 button.
- The Mac app checks `mac/version.json` on the site at launch and every 6 hours. A newer build downloads in the background, is verified, then installs on restart or on quit.
- The menu bar item shows the sync state, and has 立即同步 (sync now), the synced folders, the sync log and 登录时打开 (Open at Login). Closing the window keeps the sync running; quit from the menu bar item or ⌘Q. Links to other sites open in your default browser, and downloads go to `~/Downloads`.
- The folder sync skips hidden files, symlinks, `node_modules` and `.git`, and does not upload files over 50 MB. Settings, state and the log live in `~/.suiji/`; the log is `~/.suiji/sync.log`.
- Storage can serve the previous copy of a file for a while after an upload, through a URL signed earlier. So reads use freshly signed URLs and must match the size in the row.
- The interface is in Chinese or English (设置 → 语言; by default it follows the system), and the Mac app's menus follow it.
- Styles, light / dark and the sort order are saved per device. 方块 loads two pixel fonts from Google Fonts, and only when it is picked.
