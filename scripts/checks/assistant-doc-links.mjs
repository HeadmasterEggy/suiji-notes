// A link the assistant writes to one of the user's documents ([title](suiji:ID)) shows as a document chip
// (agent polish round 4), so it reads differently from a link to the web; clicking it still opens the document.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const bad = [];
try {
  await app.page.route("**/api/agent", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: [{ t: "text", d: "See [Week02](suiji:f2) and [the web](https://example.com)." }, { t: "done", reason: "stop" }].map((l) => JSON.stringify(l) + "\n").join("") }));
  await app.page.click("#agentBtn");
  await app.page.fill("#agInput", "hello");
  await app.page.click("#agSend");
  await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 });
  const [doc, web] = await app.page.$$eval(".ag-text a", (as) => as.map((a) => { const s = getComputedStyle(a), b = getComputedStyle(a, "::before");
    return { bg: s.backgroundColor, icon: b.content !== "none" && b.content !== "normal" }; }));
  if (!doc || doc.bg === web.bg || !doc.icon) bad.push(`a document link looks like a web link: ${JSON.stringify({ doc, web })}`);
  await app.page.click(".ag-text a[href^='#suiji:']");
  await app.page.waitForFunction(() => /Week02/.test(document.querySelector(".md-body h1")?.textContent || ""), null, { timeout: 5000 })
    .catch(() => bad.push("clicking the document link did not open Week02"));
} finally { await app.close(); }
if (bad.length) { console.log("assistant document links:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("assistant document links show as document chips and open the document");
