# Suiji Notes: notes for coding agents

## Where things are
- `public/`: the web app, plain ES modules with no bundler (`app.js` is the core, `graph.js` the graph, `agent.js` the assistant panel, `themes.css` the 13 styles). Vercel serves it as is.
- `api/`: Vercel functions for the assistant (`agent.js`, `ai-key.js`, `_ai.js`).
- `desktop/`: the Mac app (Electron). It loads the live site, so a web change needs no Mac release. `mac/` is the retired Swift app.
- `scripts/build.mjs`: Vercel's build step; writes `public/config.js` and stamps the deploy's commit into `public/sw.js`.

## Shipping
- A push to `main` deploys production. Leave `CACHE` in `public/sw.js` as `"suiji-dev"`: the build replaces it on every deploy.
- `npm run check` parses every script; `npm run smoke` opens every style, light and dark, plus a phone layout, with Supabase and the CDN stubbed (`scripts/harness.mjs`). CI runs both, and every check in `scripts/checks/`.
- A fixed bug gets a check in `scripts/checks/`, proven with `scripts/redgreen.mjs` (see `scripts/checks/README.md`).

## Session log
Before ending a session that changed this repo, add `.agents/session-log/YYYY-MM-DD-<topic>.md`, format in `.agents/session-log/README.md`.
