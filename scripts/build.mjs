// Writes public/config.js from the env vars the Vercel Supabase integration provides.
// Only the public URL and anon key go to the browser; row-level security protects the data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
if (!url || !key) console.warn("build: Supabase URL or anon key missing; the app will show a setup notice.");

writeFileSync(
  "public/config.js",
  `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(key)};\n`
);
console.log("build: wrote public/config.js");

// On Vercel, every deploy gets its own cache name in sw.js: open windows compare it to offer the reload, and
// the browser installs the new service worker. Locally sw.js stays as committed ("suiji-dev").
if (process.env.VERCEL) {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  if (!sha) try { sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  const version = "suiji-" + (sha ? sha.slice(0, 7) : Date.now().toString(36));
  const sw = readFileSync("public/sw.js", "utf8");
  const next = sw.replace(/const CACHE = "[^"]*";/, `const CACHE = "${version}";`);
  if (next === sw) throw new Error("build: no CACHE line found in public/sw.js");
  writeFileSync("public/sw.js", next);
  console.log("build: sw.js cache " + version);
}
