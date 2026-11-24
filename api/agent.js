// The notes assistant's model calls. The page runs the tools itself (public/agent.js: search, read, propose
// edits), since it already has the notes and files; this function only streams the model's next step, for a
// signed-in Suiji user, through the OpenAI-compatible API and key they set in Settings (see _ai.js). Response:
// one JSON object per line —
//   {t:"text", d}  {t:"reasoning", d}  {t:"tool", id, name, input}  {t:"error", message, code?}  {t:"done", reason}
import { streamText, jsonSchema } from "ai";
import { userOf, modelFor, line, fail } from "./_ai.js";
import { TOOLS as SPEC_TOOLS, instructions, effortBody } from "../public/agentspec.js";

const MAX_CHARS = 600_000;
// Room for a long answer. Without max_tokens many services stop at their default (often 4K tokens, which a
// thinking model can spend mostly on thinking), and the answer ends mid-sentence. A service that refuses this
// many is asked again with the most it says it allows ("valid range … [1, 8192]"), or else its own default.
const MAX_OUTPUT = 32_000;
const allowed = (msg) => {
  const n = Number(/\[\s*1\s*,\s*(\d{3,7})\s*\]|(?:at most|<=|less than or equal to|maximum(?: value)?(?: is)?)\s*(\d{3,7})/i.exec(msg)?.slice(1).find(Boolean));
  return n > 0 && n < MAX_OUTPUT ? n : 0;
};
const tooMany = (msg) => /max_(completion_)?tokens|max.?output|maximum.{0,40}tokens|tokens?.{0,40}(range|limit|exceed|too (large|many|big))/i.test(msg);   // whole conversation, so one request can't run up a huge bill

// Model-side shapes for the shared tool list.
const TOOLS = Object.fromEntries(Object.entries(SPEC_TOOLS).map(([name, t]) => [name, { description: t.description, inputSchema: jsonSchema(t.parameters) }]));

export async function POST(request) {
  const user = await userOf(request);
  if (!user) return fail(401, "not signed in");
  let picked;
  try { picked = await modelFor(user); } catch (e) { return fail(500, String(e?.message || e)); }
  if (!picked) return fail(402, "no API key", { code: "no_key" });

  let body;
  try { body = await request.json(); } catch { return fail(400, "bad request"); }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages?.length || messages.length > 200 || JSON.stringify(messages).length > MAX_CHARS) return fail(413, "conversation too long; start a new one");
  if (messages.some((m) => !["user", "assistant", "tool"].includes(m?.role))) return fail(400, "bad message");

  const run = (maxOutputTokens) => streamText({
    model: picked.model,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    instructions: instructions(body.context || {}),
    messages,
    tools: TOOLS,
    // The page's last step of a turn: answer now with what the tools found, no more tool calls.
    ...(body.final === true ? { toolChoice: "none" } : {}),
    // Thinking effort from Settings, as the request fields this service understands ("suiji" is the
    // provider's name in _ai.js, so these pass straight into the request body).
    providerOptions: { suiji: effortBody(picked.base, typeof body.effort === "string" ? body.effort : "") },
    abortSignal: request.signal,
  });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o) => c.enqueue(enc.encode(line(o)));
      let max = MAX_OUTPUT, sent = false, retry = false;
      do {
        retry = false;
        try {
          for await (const part of run(max).stream) {
            if (part.type === "error") {
              const message = String(part.error?.message || part.error);
              // The service won't give this many tokens: once, before anything was sent, ask with its default.
              if (max && !sent && tooMany(message)) { max = max === MAX_OUTPUT ? allowed(message) : 0; retry = true; break; }
              send({ t: "error", message });
            }
            else if (part.type === "text-delta") { sent = true; send({ t: "text", d: part.text }); }
            else if (part.type === "reasoning-delta") { if (part.text) { sent = true; send({ t: "reasoning", d: part.text }); } }
            else if (part.type === "tool-call") { sent = true; send({ t: "tool", id: part.toolCallId, name: part.toolName, input: part.input }); }
            // raw is the service's own word for why it stopped (DeepSeek's insufficient_system_resource is "other").
            else if (part.type === "finish") send({ t: "done", reason: part.finishReason, raw: part.rawFinishReason });
          }
        } catch (e) {
          if (max && !sent && tooMany(String(e?.message || e))) { max = max === MAX_OUTPUT ? allowed(String(e?.message || e)) : 0; retry = true; continue; }
          send({ t: "error", message: String(e?.message || e) });
        }
      } while (retry);
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
