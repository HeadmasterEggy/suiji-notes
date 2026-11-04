# Suiji 随记

**English** · [简体中文](README.zh-CN.md)

A notes app that syncs between iPhone and Mac. It runs as a web app you can add to the home screen (PWA), and as a native Mac app. A small agent on the Mac keeps a local folder, such as a Hexo blog's `source/_posts`, in sync with the app, so you can read and edit your Markdown files on the phone.

Live: <https://suiji-notes.vercel.app>

## Features

- **One tree.** Quick notes written in the app sit in a 「随手记」 folder at the top, and the synced folders sit below it.
- **Edit anywhere.** Edit a file on the phone, and the Mac agent writes it back to disk within a few seconds.
- **Outline.** A panel beside each Markdown file lists its headings; click one to jump, and the current section stays marked as you scroll.
- **Split panes.** Split up, down, left or right, by dragging a file onto a pane's edge or with ⌘-click. The layout is remembered.
- **Relationship graph.** Like Obsidian's graph, built from `[[wikilinks]]`, relative `.md` links and front-matter tags.
- **Markdown.** Math (KaTeX) and Mermaid diagrams.
- **Blog links.** Every published post links to its page on the blog (`https://qiao1.top/posts/<abbrlink>.html`).
- **Fast.** Documents are cached on the device and prefetched, so they open instantly.
- **Offline-first.** Notes save on the device first and upload once online.

## How it works

| Part | Where | What it does |
|---|---|---|
| Web app | `public/` | Plain HTML/JS, no framework, hosted on Vercel |
| Data | Supabase | Postgres tables `notes` and `files`, a private storage bucket, and Realtime. Row-level security means each user sees only their own data. |
| Folder agent | `agent/suiji-sync.mjs` | Node script run by launchd on the Mac. It watches the synced folders. |
| Mac app | `mac/` | Native AppKit window around the web app, plus a menu bar item for the agent |

**Notes** are saved on the device, then upserted to `notes`. Other devices receive changes through Realtime. If two devices edit the same note, the last save wins.

**Folder files** sync in both directions:

- **Mac → cloud:** the agent watches the folder. New and changed files are uploaded, and deleted files are removed from the cloud. A full rescan every 5 minutes catches anything a watch event missed.
- **Phone → Mac:** an edit saved in the app updates the file's row. The agent hears about it through Realtime and writes the new version to disk.
- **Conflicts:** if both sides changed a file since the last sync, the local file is kept and uploaded. The cloud version is saved beside it as 「（随记副本）」.
- **Stale reads:** storage can serve the previous copy for a while after an upload, through a URL signed earlier. Reads use freshly signed URLs and must match the size in the row.

## Mac app

```bash
./mac/build.sh             # builds mac/build/随记.app (universal, ad-hoc signed)
./mac/build.sh --install   # also copies it to /Applications
./mac/build.sh --publish   # writes public/mac/Suiji.zip and version.json for the next deploy
```

**Updates.** The window loads the live site, so web changes arrive with every deploy. An open window checks for a new deploy every 10 minutes and when it comes to the front. It reloads by itself when nothing is being edited, and otherwise shows a 「有新版本」 button. The app itself checks `mac/version.json` on the site at launch and every 6 hours. A newer build downloads in the background, is verified, then installs on restart or on quit. To release one, raise `BUILD` in `mac/build.sh`, run it with `--publish`, and deploy.

It needs Xcode's command line tools. The app keeps you signed in between launches. Links to other sites open in your default browser, and downloads go to `~/Downloads`. The menu bar item shows whether the folder agent is running, and has 立即同步 (sync now), the synced folder and the sync log.

## Folder agent

```bash
npm run sync login       # sign in to your Suiji account
npm run sync add         # choose a folder; it uploads right away
npm run sync install     # run in the background whenever you log in
npm run sync status      # show account, folders and file counts
npm run sync remove ~/some/folder   # stop syncing a folder (cloud copies stay)
npm run sync uninstall   # stop running in the background
```

Hidden files, `node_modules` and `.git` are skipped, and files over 50 MB are not uploaded. Settings, state and the log live in `~/.suiji/`; the log is `~/.suiji/sync.log`.

## Deploy

```bash
npx vercel link --yes --project suiji-notes
npx vercel integration add supabase --yes --no-claim
npx vercel env pull .env.local --yes
npm install
npm run db:setup        # creates the tables, policies and storage bucket from schema.sql
npx vercel deploy --prod
```

`npm run dev` serves the app locally on port 5173.

## Install on a phone or Mac without the app

- **iPhone:** open the site in Safari, tap Share, then 添加到主屏幕 (Add to Home Screen).
- **Mac:** in Safari choose File → Add to Dock, or in Chrome click the install icon in the address bar.
