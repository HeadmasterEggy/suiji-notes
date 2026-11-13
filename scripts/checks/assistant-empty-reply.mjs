// A reply that brings nothing back says why instead of leaving an empty bubble (PR #4): a model that only
// thinks, one that stops with no answer, and a stream that is cut off before it finishes.
import { openApp } from "../harness.mjs";

const cases = [
  ["only thinking", [{ t: "reasoning", d: "Let me think…" }, { t: "done", reason: "length" }], /只返回了思考过程|only returned its reasoning/],
  ["empty answer", [{ t: "done", reason: "stop" }], /没有返回任何内容|returned nothing/],
  ["cut off", [], /回复中断了|was cut off/],
];
const bad = [];
for (const [name, lines, want] of cases) {
  const app = await openApp({});
  try {
    await app.page.route("**/api/agent", (r) => r.fulfill({ contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l) + "\n").join("") }));
    await app.page.click("#agentBtn");
    await app.page.fill("#agInput", "hello");
    await app.page.click("#agSend");
    await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden && document.querySelector("#agStop")?.hidden, null, { timeout: 8000 }).catch(() => {});
    await app.page.waitForTimeout(300);
    const log = await app.page.$eval("#agLog", (e) => e.innerText);
    if (!want.test(log)) bad.push(`${name}: the reply says nothing about why it is empty: ${JSON.stringify(log.slice(-200))}`);
  } finally { await app.close(); }
}
if (bad.length) { console.log("empty assistant replies stay blank:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("an empty assistant reply says why");
