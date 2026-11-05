// The notes assistant's model calls. The page runs the tools itself (public/agent.js: search, read, propose
// edits), since it already has the notes and files; this function only streams the model's next step, for a
// signed-in Suiji user, through the OpenAI-compatible API and key they set in Settings (see _ai.js). Response:
// one JSON object per line —
//   {t:"text", d}  {t:"tool", id, name, input}  {t:"error", message, code?}  {t:"done", reason}
import { streamText, jsonSchema } from "ai";
import { userOf, modelFor, line, fail } from "./_ai.js";
import { TOOLS as SPEC_TOOLS, instructions } from "../public/agentspec.js";

const MAX_CHARS = 600_000;   // whole conversation, so one request can't run up a huge bill

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

  const result = streamText({
    model: picked.model,
    instructions: instructions(body.context || {}),
    messages,
    tools: TOOLS,
    abortSignal: request.signal,
  });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o) => c.enqueue(enc.encode(line(o)));
      try {
        for await (const part of result.stream) {
          if (part.type === "text-delta") send({ t: "text", d: part.text });
          else if (part.type === "tool-call") send({ t: "tool", id: part.toolCallId, name: part.toolName, input: part.input });
          else if (part.type === "error") send({ t: "error", message: String(part.error?.message || part.error) });
          else if (part.type === "finish") send({ t: "done", reason: part.finishReason });
        }
      } catch (e) {
        send({ t: "error", message: String(e?.message || e) });
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
