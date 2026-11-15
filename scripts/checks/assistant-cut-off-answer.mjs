// An answer that stops partway carries on instead of ending mid-sentence: the model hit its output limit
// ("length"), the server's stream ended with no "done" (the connection or the function's time ran out), or
// the tool steps ran out before the model answered.
import { openApp } from "../harness.mjs";

const nd = (lines) => lines.map((l) => JSON.stringify(l) + "\n").join("");
const cases = [
  ["length limit", [[{ t: "text", d: "The first half, " }, { t: "done", reason: "length" }], [{ t: "text", d: "and the second half." }, { t: "done", reason: "stop" }]]],
  ["stream cut off", [[{ t: "text", d: "The first half, " }], [{ t: "text", d: "and the second half." }, { t: "done", reason: "stop" }]]],
];
const bad = [];
for (const [name, replies] of cases) {
  const app = await openApp({});
  try {
    let n = 0;
    await app.page.route("**/api/agent", (r) => r.fulfill({ contentType: "application/x-ndjson", body: nd(replies[Math.min(n++, replies.length - 1)]) }));
    await app.page.click("#agentBtn");
    await app.page.fill("#agInput", "hello");
    await app.page.click("#agSend");
    await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 }).catch(() => {});
    await app.page.waitForTimeout(300);
    const texts = await app.page.$$eval(".ag-bot .ag-text", (els) => els.map((e) => e.innerText.trim()));
    if (texts.join(" ") !== "The first half, and the second half.") bad.push(`${name}: the answer reads ${JSON.stringify(texts)}, not carried on to the end`);
    else if (texts.length !== 1) bad.push(`${name}: the carried-on answer is split into ${texts.length} pieces`);
  } finally { await app.close(); }
}
// Tool steps that never end: the last step asks for an answer with no tools, and that answer shows.
{
  const app = await openApp({});
  try {
    await app.page.route("**/api/agent", (r) => {
      const final = r.request().postDataJSON()?.final === true;
      r.fulfill({ contentType: "application/x-ndjson", body: nd(final ? [{ t: "text", d: "Here is what I found." }, { t: "done", reason: "stop" }]
        : [{ t: "tool", id: crypto.randomUUID(), name: "list", input: {} }, { t: "done", reason: "tool-calls" }]) });
    });
    await app.page.click("#agentBtn");
    await app.page.fill("#agInput", "hello");
    await app.page.click("#agSend");
    await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 15000 }).catch(() => {});
    await app.page.waitForTimeout(300);
    const log = await app.page.$eval("#agLog", (e) => e.innerText);
    if (!log.includes("Here is what I found.")) bad.push("tool steps ran out and the turn ended with no answer");
  } finally { await app.close(); }
}
if (bad.length) { console.log("cut-off assistant answers stay cut off:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("a cut-off assistant answer carries on to the end");
