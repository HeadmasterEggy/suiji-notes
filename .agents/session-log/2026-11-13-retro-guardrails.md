# Retro and repo guardrails

- Asked: a retrospective on the week's threads (assistant streaming, 3D graph, UI and Mac bug hunts, terminal Markdown, thinking effort), then whether skills need updating. Joey approved four repo changes and the session-log folder.
- Done: the build stamps the commit into `sw.js` CACHE (no more hand bumps colliding across parallel PRs: #9 jumped to v95, #14's body said v82 but merged as v96); `scripts/harness.mjs` + `scripts/smoke.mjs` replace the Playwright stub setup each thread rebuilt by hand; `scripts/redgreen.mjs` and `scripts/checks/` for locking fixed bugs; CI; `AGENTS.md` (with `CLAUDE.md` linking to it); this folder.
- Checked: smoke passes for all 13 styles in light and dark plus phone (27 runs). The first check, `inline-code-visible.mjs`, is red on the style.css from before #14 and green now. The build stamp was run with and without `VERCEL_GIT_COMMIT_SHA`. CI itself is not yet seen running on GitHub.
- Open: PRs #4 (2026-11-07) and #8 (2026-11-09) are still open while their threads are closed; #14 redid part of #8. Joey to decide whether the graph loop may merge by itself like the bug-hunt loop.
- Learned: the harness needs an https origin, a signed URL with a `?` query (the app appends `&t=`), and Google Fonts stubbed (Blocks style). Vercel reports to PRs as a commit status, not a check run.
