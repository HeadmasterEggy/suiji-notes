// The terminal style shows Markdown blocks (PR #8): code, quotes and table headers stand out from the page,
// list numbers up to "10." stay inside the column, and #### headings get their prefix like the others.
// In the notebook style, a heading that wraps gets its highlighter stroke on every line, not just the last.
import { openApp } from "../harness.mjs";

const bad = [];
for (const mode of ["light", "dark"]) {
  const app = await openApp({ style: "terminal", mode });
  try {
    await app.openDoc("COMP5318/Week01.md");
    const r = await app.page.evaluate(() => {
      const css = (sel, pseudo) => { const e = document.querySelector(sel); return e && getComputedStyle(e, pseudo); };
      const page = getComputedStyle(document.querySelector(".md-body")).backgroundColor;
      const clear = (c) => !c || c === "rgba(0, 0, 0, 0)" || c === "transparent";
      const ol = document.querySelector(".md-body ol"), li = ol && [...ol.children].pop();
      return {
        pre: clear(css(".md-body pre").backgroundColor) || css(".md-body pre").backgroundColor === page ? "" : "ok",
        quote: clear(css(".md-body blockquote").backgroundColor) ? "" : "ok",
        h4: css(".md-body h4", "::before")?.content || "",
        olPad: ol ? parseFloat(getComputedStyle(ol).paddingLeft) / parseFloat(getComputedStyle(ol).fontSize) : 0,
        last: li?.textContent.trim().slice(0, 10),
      };
    });
    if (!r.pre) bad.push(`terminal ${mode}: code blocks have the page's own background`);
    if (!r.quote) bad.push(`terminal ${mode}: quotes have no background`);
    if (!r.h4.includes("####")) bad.push(`terminal ${mode}: #### headings have no prefix (${r.h4})`);
    if (r.olPad < 2.2) bad.push(`terminal ${mode}: numbered lists leave ${r.olPad.toFixed(2)}em for "10." (monospace needs about 4ch)`);
  } finally { await app.close(); }
}
const nb = await openApp({ style: "notebook", width: 420, height: 800 });
try {
  await nb.openDoc("COMP5318/Week01.md");
  const size = await nb.page.$eval(".md-body h1", (h) => getComputedStyle(h).backgroundSize);
  if (!/\dpx|em/.test(size.split(" ")[1] || "")) bad.push(`notebook: the heading stroke stretches over the whole heading (background-size ${size}), so a wrapped heading is marked only on its last line`);
} finally { await nb.close(); }
if (bad.length) { console.log("Markdown looks wrong in the terminal / notebook styles:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("terminal and notebook styles show Markdown blocks properly");
