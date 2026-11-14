// Inline code must have its own background, not the page colour (PR #14: it used --bg, so in Glass, Swiss
// and other styles `code` looked like plain text).
import { openApp } from "../harness.mjs";

let bad = [];
for (const style of ["", "swiss"]) for (const mode of ["light", "dark"]) {
  const app = await openApp({ style, mode });
  try {
    await app.openDoc("COMP5318/Week01.md");
    const [code, page] = await app.page.evaluate(() => {
      const c = document.querySelector(".md-body p code");
      const probe = document.body.appendChild(Object.assign(document.createElement("div"), { style: "background: var(--bg)" }));
      const out = [getComputedStyle(c).backgroundColor, getComputedStyle(probe).backgroundColor];
      probe.remove();
      return out;
    });
    if (code === page || code === "rgba(0, 0, 0, 0)") bad.push(`${style || "glass"} ${mode}: code background ${code} = page ${page}`);
  } finally { await app.close(); }
}
if (bad.length) { console.log("inline code has no background of its own:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("inline code has its own background");
