// Assistant tool calls (agent polish round 2): calls in a row share one line of chips, and each chip ends
// showing it finished (✓) or failed (✕ with the reason on hover) instead of staying a plain label.
import { openApp } from "../harness.mjs";

const steps = [
  [{ t: "tool", id: "c1", name: "search", input: { query: "Week01" } }, { t: "tool", id: "c2", name: "read", input: { id: "nope" } }, { t: "done", reason: "tool-calls" }],
  [{ t: "text", d: "Done." }, { t: "done", reason: "stop" }],
];
const app = await openApp({});
const bad = [];
try {
  let n = 0;
  await app.page.route("**/api/agent", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: steps[Math.min(n++, steps.length - 1)].map((l) => JSON.stringify(l) + "\n").join("") }));
  await app.page.click("#agentBtn");
  await app.page.fill("#agInput", "hello");
  await app.page.click("#agSend");
  await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 });
  const r = await app.page.evaluate(() => ({
    rows: [...document.querySelectorAll(".ag-steps")].map((x) => x.querySelectorAll(".ag-chip").length),
    states: [...document.querySelectorAll(".ag-chip")].map((c) => [c.classList.contains("ok") ? "ok" : c.classList.contains("bad") ? "bad" : c.classList.contains("run") ? "run" : "none", c.title]),
  }));
  if (JSON.stringify(r.rows) !== "[2]") bad.push(`two calls in a row should share one line of chips, got rows ${JSON.stringify(r.rows)}`);
  if (r.states[0]?.[0] !== "ok") bad.push(`the search chip ends as ${r.states[0]?.[0]}, not done`);
  if (r.states[1]?.[0] !== "bad" || !/no document/.test(r.states[1]?.[1] || "")) bad.push(`the failed read chip ends as ${JSON.stringify(r.states[1])}, not failed with its reason`);
} finally { await app.close(); }
if (bad.length) { console.log("assistant tool chips:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("assistant tool calls share a line of chips that end done or failed");
