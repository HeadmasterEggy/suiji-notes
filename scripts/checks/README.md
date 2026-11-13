# Bug checks

One file per fixed bug, named after what it guards (`graph-wheel-zooms.mjs`). Each one opens the app with
`openApp()` from `../harness.mjs`, does the thing that used to break, and exits non-zero if it breaks again.
CI runs every `*.mjs` here.

Before committing a check, prove it catches the bug:

    node scripts/redgreen.mjs public/graph.js -- node scripts/checks/graph-wheel-zooms.mjs

It must be red on the old code and green on the fix. Paste that output into the PR. When no check can catch a
bug (how a drag feels, what a model writes), say why in the PR instead.
