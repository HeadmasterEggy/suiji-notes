// Loads public/ in headless Chromium with Supabase and the CDN stubbed, so the app runs with no network.
// Used by scripts/smoke.mjs and by bug checks under scripts/checks/. Run `npm i` first: marked, DOMPurify
// and KaTeX are served from node_modules in place of cdn.jsdelivr.net.
//
//   const app = await openApp({ style: "terminal", mode: "dark" });
//   await app.openDoc("COMP5318/Week01.md");   // ... assertions on app.page ...
//   await app.close();                          // throws if the page logged an error
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { join, extname } from "node:path";
import { fixture } from "./fixtures/vault.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const ORIGIN = "https://app.test";

// Playwright: the project's own copy if installed, else the global one (cloud containers ship it there).
function loadPlaywright() {
  for (const base of [ROOT, (() => { try { return execSync("npm root -g").toString().trim() + "/"; } catch { return null; } })()]) {
    if (!base) continue;
    try { return createRequire(join(base, "noop.js"))("playwright"); } catch {}
  }
  throw new Error("Playwright not found: run `npm i --no-save playwright && npx playwright install chromium`.");
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".md": "text/markdown" };
const type = (p) => TYPES[extname(p)] || "application/octet-stream";

// cdn.jsdelivr.net/npm/<pkg@ver>/<path> → node_modules/<pkg>/<path>
function cdnFile(url) {
  const m = /^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/.exec(new URL(url).pathname);
  if (!m) return null;
  const p = join(ROOT, "node_modules", m[1], m[2]);
  return existsSync(p) ? p : null;
}

// A stand-in for @supabase/supabase-js: one signed-in user, tables and storage from window.__suiji.
const FAKE_SUPABASE = `
const fx = () => window.__suiji;
const session = { access_token: "test-token", user: { id: "u1", email: "test@suiji.test", user_metadata: {} } };
class Query {
  constructor(table) { this.table = table; this.write = false; }
  select() { return this; } order() { return this; } limit() { return this; } eq() { return this; } in() { return this; }
  match() { return this; } neq() { return this; } gt() { return this; } lt() { return this; } is() { return this; }
  insert() { this.write = true; return this; } upsert() { this.write = true; return this; }
  update() { this.write = true; return this; } delete() { this.write = true; return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  then(ok, bad) {
    const rows = this.write ? null : (fx().tables[this.table] || []);
    return Promise.resolve({ data: this.one ? (rows && rows[0]) || null : rows, error: null }).then(ok, bad);
  }
}
const bucket = {
  upload: async () => ({ data: {}, error: null }), remove: async () => ({ data: [], error: null }),
  createSignedUrl: async (p) => ({ data: { signedUrl: "${ORIGIN}/__blob/" + p + "?token=t" }, error: null }),
  createSignedUrls: async (ps) => ({ data: ps.map((p) => ({ path: p, signedUrl: "${ORIGIN}/__blob/" + p + "?token=t" })), error: null }),
  download: async (p) => ({ data: new Blob([fx().blobs[p] || ""]), error: null }),
};
const channel = { on() { return channel; }, subscribe() { return channel; }, send() {}, unsubscribe() {} };
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }), signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }), updateUser: async () => ({ data: { user: session.user }, error: null }),
    },
    from: (t) => new Query(t), storage: { from: () => bucket },
    channel: () => channel, removeChannel() {}, rpc: async () => ({ data: null, error: null }),
  };
}`;

export async function openApp({ style = "", mode = "light", width = 1280, height = 800, vault = fixture(), storage = {}, headless = true } = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  const errors = [], aborted = [];
  await context.addInitScript(({ vault, storage, style, mode }) => {
    window.__suiji = vault;
    try {
      if (style) localStorage.setItem("suiji:style", style);
      localStorage.setItem("suiji:mode", mode);
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    } catch {}
  }, { vault, storage, style, mode });

  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === ORIGIN) {
      if (url.pathname === "/config.js")
        return route.fulfill({ contentType: "text/javascript", body: `export const SUPABASE_URL = "https://db.test";\nexport const SUPABASE_ANON_KEY = "anon";\n` });
      if (url.pathname.startsWith("/__blob/")) {
        const p = decodeURIComponent(url.pathname.slice(8));
        const body = vault.blobs[p];
        return body == null ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: type(p), body });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      const p = join(ROOT, "public", url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
      return existsSync(p) ? route.fulfill({ contentType: type(p), body: readFileSync(p) }) : route.fulfill({ status: 404, body: "" });
    }
    if (url.hostname === "cdn.jsdelivr.net") {
      if (url.pathname.includes("@supabase/supabase-js")) return route.fulfill({ contentType: "text/javascript", body: FAKE_SUPABASE });
      const p = cdnFile(req.url());
      if (p) return route.fulfill({ contentType: type(p), body: readFileSync(p) });
    }
    // Web fonts (the Blocks style uses Google Fonts): empty, so text falls back to local fonts.
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ contentType: "text/css", body: "" });
    aborted.push(req.url());
    return route.abort();   // anything else would need the network; the app must cope without it
  });

  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(ORIGIN + "/");
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForSelector(".tree-row", { timeout: 10000 });

  return {
    browser, page, errors, aborted,
    // Opens a document by its full path ("Folder/Sub/Name.md"), unfolding folders on the way.
    async openDoc(path) {
      const segs = path.split("/");
      for (const seg of segs.slice(0, -1)) {
        const folder = page.locator(".tree-folder", { has: page.locator(".tree-name", { hasText: seg }) }).first();
        if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
      }
      const f = vault.tables.files.find((x) => [x.folder, x.name].filter(Boolean).join("/") === path);
      if (!f) throw new Error("no such file in the vault: " + path);
      await page.locator(`.tree-file[data-id="${f.id}"]`).first().click();
      await page.waitForFunction(() => document.querySelector(".md-body h1, .md-body h2, .md-body p"), null, { timeout: 10000 });
    },
    // Closes the browser; throws when the page logged errors (pass allow to skip known, expected ones).
    async close({ allow = [] } = {}) {
      await browser.close();
      const bad = errors.filter((e) => !allow.some((a) => (a instanceof RegExp ? a.test(e) : e.includes(a))));
      if (bad.length) throw new Error("page errors:\n  " + bad.join("\n  "));
    },
  };
}
