// The notes assistant's model calls. The page runs the tools itself (public/agent.js: search, read, propose
// edits), since it already has the notes and files; this function only streams the model's next step through
// AI Gateway, for a signed-in Suiji user. Response: one JSON object per line —
//   {t:"text", d}  {t:"tool", id, name, input}  {t:"error", message}  {t:"done", reason}
import { streamText, jsonSchema } from "ai";
import { createClient } from "@supabase/supabase-js";

// Any model id from https://ai-gateway.vercel.sh/v1/models that supports tool use; DeepSeek runs on the
// team's own key (AI Gateway → Bring Your Own Key).
const MODEL = process.env.AI_GATEWAY_MODEL || "deepseek/deepseek-v4.1-flash";
const PROVIDER = MODEL.split("/")[0];
const MAX_CHARS = 600_000;   // whole conversation, so one request can't run up a huge bill

const tool = (description, properties, required) => ({ description, inputSchema: jsonSchema({ type: "object", properties, required, additionalProperties: false }) });
const TOOLS = {
  search: tool("Search the user's notes and files by words in their title, path, tags or text. Returns matches with ids and a snippet.", {
    query: { type: "string", description: "Words to look for; several words match documents containing all of them" },
    limit: { type: "integer", minimum: 1, maximum: 30 },
  }, ["query"]),
  list: tool("List documents: every folder with its file count, or the files in one folder (most recent first).", {
    folder: { type: "string", description: "A folder name from a previous list; leave out for all folders" },
  }, []),
  read: tool("Read a note or file by id. Long documents come back in parts; ask for the next part with offset.", {
    id: { type: "string" }, offset: { type: "integer", minimum: 0 },
  }, ["id"]),
  propose_edit: tool("Propose a change to one note or text file. The user sees it as a diff and decides whether to apply it; nothing changes until they do. Use replacements for targeted changes (each `find` must appear exactly once in the current text), or content for a full rewrite.", {
    id: { type: "string" },
    summary: { type: "string", description: "One short line on what the change does, in the user's language" },
    replacements: { type: "array", items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"], additionalProperties: false } },
    content: { type: "string", description: "The complete new text" },
  }, ["id", "summary"]),
  propose_note: tool("Propose a new quick note (随手记). The user decides whether to create it.", {
    body: { type: "string", description: "Markdown; the first line is the title" },
    summary: { type: "string" },
  }, ["body", "summary"]),
};

const instructions = (ctx) => `You are the assistant inside Suiji (随记), a notes app. You help the user find, summarise, organise and edit their own notes and files (mostly Markdown, often Chinese lecture notes and blog posts).
- Use the tools to look things up; never invent what a document says. Read a document before summarising or editing it.
- Edits only ever happen through propose_edit / propose_note, which the user confirms. Keep the document's language, structure, front matter and formatting unless asked otherwise; change only what was asked.
- When you mention a document, link it as [its title](suiji:ID) so the user can open it.
- Answer in the user's language (${ctx.lang === "en" ? "English" : "简体中文"} unless they write in another), concisely, in Markdown.
- Today is ${new Date().toISOString().slice(0, 10)}.${ctx.open ? `\n- The user has this document open: "${ctx.open.title}" (id ${ctx.open.id}). "This note" / "这篇" means it.` : ""}`;

const line = (o) => JSON.stringify(o) + "\n";
const fail = (status, message) => new Response(line({ t: "error", message }), { status, headers: { "content-type": "application/x-ndjson" } });

export async function POST(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return fail(401, "not signed in");
  const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token);
  if (error || !data?.user) return fail(401, "not signed in");

  let body;
  try { body = await request.json(); } catch { return fail(400, "bad request"); }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages?.length || messages.length > 200 || JSON.stringify(messages).length > MAX_CHARS) return fail(413, "conversation too long; start a new one");
  if (messages.some((m) => !["user", "assistant", "tool"].includes(m?.role))) return fail(400, "bad message");

  const result = streamText({
    model: MODEL,
    instructions: instructions(body.context || {}),
    messages,
    tools: TOOLS,
    abortSignal: request.signal,
    providerOptions: { gateway: { only: [PROVIDER], user: data.user.id, tags: ["suiji-agent"] } },
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
