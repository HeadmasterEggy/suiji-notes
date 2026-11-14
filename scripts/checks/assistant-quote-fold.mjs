// A long passage quoted into a question (agent polish round 5) shows its first few lines in the question
// bubble, not the whole passage; a click shows the rest.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const bad = [];
try {
  await app.page.route("**/api/agent", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: [{ t: "text", d: "ok" }, { t: "done", reason: "stop" }].map((l) => JSON.stringify(l) + "\n").join("") }));
  await app.page.evaluate(() => import("/agent.js").then((m) => m.askAgent(Array.from({ length: 20 }, (_, i) => "line " + i).join("\n"), "explain")));
  await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden && document.querySelector(".ag-cite"), null, { timeout: 8000 });
  const folded = await app.page.$eval(".ag-cite", (c) => c.getBoundingClientRect().height);
  if (folded > 120) bad.push(`a 20-line quote takes ${Math.round(folded)}px in the question bubble`);
  await app.page.click(".ag-cite");
  const open = await app.page.$eval(".ag-cite", (c) => c.getBoundingClientRect().height);
  if (open < folded * 2) bad.push(`clicking the quote did not show the rest (${Math.round(folded)}px → ${Math.round(open)}px)`);
} finally { await app.close(); }
if (bad.length) { console.log("assistant quote fold:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("a long quoted passage folds to a few lines and opens on click");
