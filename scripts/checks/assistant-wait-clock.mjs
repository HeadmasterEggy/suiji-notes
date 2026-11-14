// A slow model (agent polish round 6): while nothing has come back yet, 思考中 counts the seconds, so a long
// wait reads as working rather than stuck.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const bad = [];
try {
  await app.page.route("**/api/agent", async (r) => {
    await new Promise((ok) => setTimeout(ok, 3600));
    await r.fulfill({ contentType: "application/x-ndjson", body: [{ t: "text", d: "ok" }, { t: "done", reason: "stop" }].map((l) => JSON.stringify(l) + "\n").join("") });
  });
  await app.page.click("#agentBtn");
  await app.page.fill("#agInput", "hello");
  await app.page.click("#agSend");
  await app.page.waitForTimeout(3200);
  const label = await app.page.$eval(".ag-wait", (w) => w.textContent).catch(() => "");
  if (!/[23]\s*(秒|s)/.test(label)) bad.push(`after 3 s of waiting the indicator says ${JSON.stringify(label)}, with no seconds`);
  await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 });
} finally { await app.close(); }
if (bad.length) { console.log("assistant wait clock:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("a slow assistant answer counts the seconds while waiting");
