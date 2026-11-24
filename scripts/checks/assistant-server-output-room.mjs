// The assistant's server (api/agent.js) leaves room for a long answer: it asks for a large max_tokens rather
// than the service's default (often 4K, and a thinking model spends much of that thinking), asks again with
// the default when a service refuses that many, and passes on the service's own reason for stopping, so the
// page can tell a reply that was cut short (DeepSeek's insufficient_system_resource) from one that finished.
// Runs api/agent.js in Node against a fake OpenAI-compatible service; no browser, no Supabase.
import http from "node:http";
import { register } from "node:module";

// Stand-in for api/_ai.js: a signed-in user whose model is the fake service below. A data: URL can't resolve
// a bare package name, so the SDK is imported by its file in node_modules.
const sdk = new URL("../../node_modules/@ai-sdk/openai-compatible/dist/index.js", import.meta.url).href;
const stub = `
import { createOpenAICompatible } from "${sdk}";
export const line = (o) => JSON.stringify(o) + "\\n";
export const fail = (status, message) => new Response(line({ t: "error", message }), { status });
export const userOf = async () => ({ id: "u" });
export const modelFor = async () => ({ model: createOpenAICompatible({ name: "suiji", baseURL: process.env.FAKE_BASE, apiKey: "k" }).chatModel("m"), base: process.env.FAKE_BASE });
`;
const stubUrl = "data:text/javascript," + encodeURIComponent(stub);
const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === "./_ai.js" && String(ctx.parentURL || "").endsWith("/api/agent.js")) return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
  return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hooks), import.meta.url);

let finish = "stop", limit = Infinity;
const seen = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const body = JSON.parse(b);
    seen.push(body.max_tokens ?? body.max_completion_tokens ?? null);
    const asked = body.max_tokens ?? body.max_completion_tokens;
    if (asked > limit) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `Invalid max_tokens value, the valid range of max_tokens is [1, ${limit}]`, type: "invalid_request_error" } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "Hello there." } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.FAKE_BASE = `http://127.0.0.1:${srv.address().port}`;

const { POST } = await import("../../api/agent.js");

const ask = async () => {
  const res = await POST(new Request("https://app.test/api/agent", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }) }));
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
};
const bad = [];
try {
  seen.length = 0; limit = Infinity; finish = "stop";
  let out = await ask();
  if (!(seen[0] >= 16000)) bad.push(`the request leaves the answer to the service's default length (max_tokens ${seen[0]})`);
  if (!out.some((m) => m.t === "text")) bad.push("no answer came back: " + JSON.stringify(out));

  seen.length = 0; limit = 8192;
  out = await ask();
  if (out.some((m) => m.t === "error") || !out.some((m) => m.t === "text")) bad.push(`a service that allows only ${limit} tokens gets an error instead of an answer: ${JSON.stringify(out)}`);
  if (seen.at(-1) !== limit) bad.push(`asked again for ${seen.at(-1)} tokens, not the ${limit} the service said it allows`);

  seen.length = 0; limit = Infinity; finish = "insufficient_system_resource";
  out = await ask();
  const done = out.find((m) => m.t === "done");
  if (done?.raw !== "insufficient_system_resource") bad.push(`the service's own stop reason is lost: ${JSON.stringify(done)}`);
} finally { srv.close(); }
if (bad.length) { console.log("the assistant's server cuts long answers short:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("the assistant's server leaves room for long answers and passes on why they stopped");
