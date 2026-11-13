// Smoke test for public/: every style in light and dark, plus a phone layout, opens a Markdown document
// and the graph without a single page error. Exits 1 on any error.
//
//   node scripts/smoke.mjs                 # all styles
//   node scripts/smoke.mjs --style terminal --shots /tmp/shots
import { readFileSync, mkdirSync } from "node:fs";
import { openApp } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const shots = opt("--shots");
if (shots) mkdirSync(shots, { recursive: true });

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const all = [...new Set([...html.matchAll(/data-style="([^"]*)"/g)].map((m) => m[1]))];
const styles = opt("--style") != null ? [opt("--style")] : all;

const runs = [];
for (const style of styles) for (const mode of ["light", "dark"]) runs.push({ style, mode, width: 1280, height: 800 });
runs.push({ style: "", mode: "light", width: 390, height: 844, phone: true });

let failed = 0;
for (const r of runs) {
  const name = `${r.style || "glass"}-${r.mode}${r.phone ? "-phone" : ""}`;
  try {
    const app = await openApp(r);
    try {
      await app.openDoc("COMP5318/Week01.md");
      const p = app.page;
      if (!(await p.locator(".md-body h1").first().isVisible())) throw new Error("the document's heading is not visible");
      if (await p.locator(".md-body .katex").count() < 1) throw new Error("formulas did not render");
      if (shots) await p.screenshot({ path: `${shots}/${name}.png` });
      if (!r.phone) {
        await p.click("#graphBtn");
        await p.waitForSelector("canvas", { timeout: 5000 });
        await p.waitForTimeout(300);
      }
    } finally {
      await app.close();
    }
    console.log("ok  ", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "\n     " + String(e.message).split("\n").join("\n     "));
  }
}
console.log(failed ? `\n${failed} of ${runs.length} failed` : `\nall ${runs.length} passed`);
process.exit(failed ? 1 : 0);
