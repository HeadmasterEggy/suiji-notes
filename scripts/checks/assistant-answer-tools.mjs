// Assistant answers (agent polish round 1): a table's :---: column stays centred, a finished code block has a
// bar with its language and a copy button, and a finished answer can be copied as the Markdown the model wrote.
import { openApp } from "../harness.mjs";

const MD = "| a | b |\n| --- | :---: |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\nDone.";
const app = await openApp({});
const bad = [];
try {
  await app.page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://app.test" });
  await app.page.route("**/api/agent", (r) => r.fulfill({ contentType: "application/x-ndjson",
    body: [{ t: "text", d: MD }, { t: "done", reason: "stop" }].map((l) => JSON.stringify(l) + "\n").join("") }));
  await app.page.click("#agentBtn");
  await app.page.fill("#agInput", "hello");
  await app.page.click("#agSend");
  await app.page.waitForFunction(() => !document.querySelector("#agSend")?.hidden, null, { timeout: 8000 });
  await app.page.waitForTimeout(300);
  const r = await app.page.evaluate(() => {
    const td = document.querySelectorAll(".ag-text td")[1];
    return { align: td && getComputedStyle(td).textAlign, bar: document.querySelector(".ag-code-bar")?.textContent || "",
      copy: !!document.querySelector(".ag-actions .ag-copy") };
  });
  if (!/center/.test(r.align)) bad.push(`a :---: column is aligned ${r.align}, not centre`);
  if (!/js/.test(r.bar)) bad.push(`the code block has no bar with its language: ${JSON.stringify(r.bar)}`);
  if (!r.copy) bad.push("the finished answer has no copy button");
  else {
    await app.page.click(".ag-actions .ag-copy");
    const got = await app.page.evaluate(() => navigator.clipboard.readText());
    if (got !== MD) bad.push(`copying the answer gave ${JSON.stringify(got.slice(0, 80))}, not the Markdown`);
    await app.page.click(".ag-code-bar .ag-copy");
    const code = await app.page.evaluate(() => navigator.clipboard.readText());
    if (code !== "const x = 1;") bad.push(`copying the code gave ${JSON.stringify(code)}`);
  }
} finally { await app.close(); }
if (bad.length) { console.log("assistant answer tools:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("assistant answers keep table alignment and can be copied, code blocks too");
