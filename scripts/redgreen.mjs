// Proves a check catches a bug: puts the given source files back to their base version and runs the check
// (it must fail), then restores your fix and runs it again (it must pass). Files are always restored.
//
//   node scripts/redgreen.mjs [--base origin/main] public/app.js [more files] -- node scripts/checks/foo.mjs
//
// Name only the files that hold the fix, not the check itself. Paste the output into the PR.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const usage = (msg) => { console.error(`redgreen: ${msg}\nusage: node scripts/redgreen.mjs [--base <ref>] <file>... -- <check command>`); process.exit(2); };
if (sep < 0 || sep === args.length - 1) usage("give the check command after --");
let pre = args.slice(0, sep), base = "origin/main";
const bi = pre.indexOf("--base");
if (bi >= 0) { base = pre[bi + 1]; pre.splice(bi, 2); }
if (!pre.length) usage("name the files that hold the fix");
const cmd = args.slice(sep + 1);

const baseText = (f) => { try { return execFileSync("git", ["show", `${base}:${f}`], { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const saved = new Map();
for (const f of pre) {
  const now = existsSync(f) ? readFileSync(f) : null, old = baseText(f);
  if (now && old && now.equals(old)) usage(`${f} is the same as on ${base}; name the file that holds the fix`);
  saved.set(f, { now, old });
}
const restore = () => { for (const [f, { now }] of saved) now ? writeFileSync(f, now) : existsSync(f) && unlinkSync(f); };
process.on("SIGINT", () => { restore(); process.exit(130); });

const run = (label) => {
  console.log(`\n── ${label}: ${cmd.join(" ")}`);
  return spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" }).status;
};
let red, green;
try {
  for (const [f, { old }] of saved) old ? writeFileSync(f, old) : existsSync(f) && unlinkSync(f);
  red = run(`base (${base})`);
} finally { restore(); }
green = run("fix");

console.log(`\nbase exit ${red}, fix exit ${green}`);
if (red === 0) { console.log("redgreen: the check passes on the old code too, so it does not expose the bug"); process.exit(1); }
if (green !== 0) { console.log("redgreen: the check fails on the fix"); process.exit(1); }
console.log("redgreen: red on the old code, green on the fix");
