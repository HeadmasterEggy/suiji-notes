// A failed assistant answer (agent polish round 3) shows the error in a box with a Retry button that asks the
// same question again; a long code block in an answer scrolls inside a capped height instead of filling the log.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const bad = [];
try {
  const asked = [];
  await app.page.route("**/api/agent", (r) => {
    const body = JSON.parse(r.request().postData());
    asked.push(body.messages.at(-1).content[0].text);
    if (asked.length === 1) return r.fulfill({ status: 500, contentType: "application/x-ndjson", body: JSON.stringify({ t: "error", message: "boom" }) + "\n" });
    const md = "```\n" + "line\n".repeat(60) + "```";
    return r.fulfill({ contentType: "application/x-ndjson", body: [{ t: "text", d: md }, { t: "done", reason: "stop" }].map((l) => JSON.stringify(l) + "\n").join("") });
  });
  await app.page.click("#agentBtn");
  await app.page.fill("#agInput", "what is up");
  await app.page.click("#agSend");
  await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 });
  const retry = app.page.locator(".ag-bot button", { hasText: /重试|Retry/ });
  if (!(await retry.count())) bad.push("a failed answer has no Retry button");
  else {
    await retry.first().click();
    await app.page.waitForFunction(() => document.querySelectorAll(".ag-text").length > 0 && !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 }).catch(() => {});
    if (asked.length !== 2 || asked[1] !== "what is up") bad.push(`Retry asked ${JSON.stringify(asked.slice(1))}, not the same question again`);
    const h = await app.page.$eval(".ag-text pre", (p) => p.getBoundingClientRect().height).catch(() => 0);
    if (!h || h > 500) bad.push(`a 60-line code block is ${Math.round(h)}px tall, not capped`);
  }
} finally { await app.close({ allow: [/500/] }); }
if (bad.length) { console.log("assistant retry:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("a failed assistant answer can be retried; long code blocks are capped");
