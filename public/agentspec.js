// The assistant's tools and instructions, shared by the server (api/agent.js) and the page, which calls a
// model on this computer (Magpie and other local OpenAI-compatible servers) itself. The tools run in the page.
const tool = (description, properties, required) => ({ description, parameters: { type: "object", properties, required, additionalProperties: false } });
export const TOOLS = {
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
  open_document: tool("Open a note or file in the app for the user, optionally scrolled to a heading. Use it whenever the user wants to see, open or go to something, instead of only linking it.", {
    id: { type: "string" },
    heading: { type: "string", description: "Text of a heading to scroll to and highlight" },
    beside: { type: "boolean", description: "Open in a new pane beside the current document instead of replacing it" },
  }, ["id"]),
  show_graph: tool("Open the relationship graph and focus it: the matching documents are highlighted with their direct links and the view zooms to them. Give ids, a query (matched against titles and paths, e.g. a course code or folder name), or a tag; with none, shows the whole graph.", {
    ids: { type: "array", items: { type: "string" } },
    query: { type: "string" },
    tag: { type: "string", description: "A front-matter tag; turns tags on in the graph" },
  }, []),
  show_in_sidebar: tool("Show something in the sidebar file tree: reveal a document (id) or a folder (path from list) by opening the folders above it, or filter the tree with a search (filter; \"\" clears it).", {
    id: { type: "string" }, folder: { type: "string" }, filter: { type: "string" },
  }, []),
  propose_note: tool("Propose a new quick note (随手记). The user decides whether to create it.", {
    body: { type: "string", description: "Markdown; the first line is the title" },
    summary: { type: "string" },
  }, ["body", "summary"]),
};

export const instructions = (ctx) => `You are the assistant inside Suiji (随记), a notes app. You help the user find, summarise, organise and edit their own notes and files (mostly Markdown, often Chinese lecture notes and blog posts).
- Use the tools to look things up; never invent what a document says. Read a document before summarising or editing it.
- Edits only ever happen through propose_edit / propose_note, which the user confirms. Keep the document's language, structure, front matter and formatting unless asked otherwise; change only what was asked.
- You can act in the app: open_document opens a document (at a heading), show_graph opens the relationship graph focused on what matters, show_in_sidebar reveals or filters the file tree. When the user asks to see, open, find or go to something, do it with these tools — don't just hand them a link. They only show things; changing a document still goes through propose_edit.
- When you mention a document, link it as [its title](suiji:ID) so the user can open it.
- Answer in the user's language (${ctx.lang === "en" ? "English" : "简体中文"} unless they write in another), concisely, in Markdown.
- Today is ${new Date().toISOString().slice(0, 10)}.${ctx.open ? `\n- The user has this document open: "${ctx.open.title}" (id ${ctx.open.id}). "This note" / "这篇" means it.` : ""}`;

// Thinking effort (Settings → Assistant → 思考强度), kept on each device ("suiji:ai-effort") and sent with
// every request. Each service turns thinking up or down with its own request fields, so the levels on offer
// and what they send depend on the API's address. "" sends nothing: the model's own default.
const FAMILIES = [
  // DeepSeek: thinking on/off; with it on, reasoning_effort "high" or "max" (lower levels count as high).
  { id: "deepseek", test: /(^|\.)deepseek\.com$/, levels: ["off", "high", "max"],
    body: (e) => e === "off" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: e } },
  // Zhipu GLM and Kimi: thinking only switches on or off.
  { id: "toggle", test: /(^|\.)(bigmodel\.cn|z\.ai|moonshot\.cn|moonshot\.ai)$/, levels: ["off", "on"],
    body: (e) => ({ thinking: { type: e === "off" ? "disabled" : "enabled" } }) },
  // Qwen on DashScope: enable_thinking, with a token budget for how long it may think.
  { id: "qwen", test: /(^|\.)aliyuncs\.com$/, levels: ["off", "low", "medium", "high"],
    body: (e) => e === "off" ? { enable_thinking: false } : { enable_thinking: true, thinking_budget: { low: 2048, medium: 8192, high: 32768 }[e] } },
  // OpenRouter passes one reasoning setting on to whichever model it routes to.
  { id: "openrouter", test: /(^|\.)openrouter\.ai$/, levels: ["off", "low", "medium", "high"],
    body: (e) => ({ reasoning: e === "off" ? { enabled: false } : { effort: e } }) },
  // OpenAI and everything else that follows it (Ollama, LM Studio, Magpie): reasoning_effort.
  { id: "openai", test: /./, levels: ["off", "low", "medium", "high"],
    body: (e) => ({ reasoning_effort: e === "off" ? "none" : e }) },
];
const hostOf = (base) => { try { return new URL(base).hostname.toLowerCase(); } catch { return ""; } };
export const effortFamily = (base) => FAMILIES.find((f) => f.test.test(hostOf(base))) || FAMILIES.at(-1);
// The saved level as this service offers it, so switching services keeps roughly the same intent:
// "high" on a service that only switches thinking on becomes "on", "max" elsewhere becomes "high".
export function effortFor(base, effort) {
  const { levels } = effortFamily(base);
  if (!effort || levels.includes(effort)) return effort || "";
  if (effort === "off") return "";
  if (levels.includes("on")) return "on";
  if (levels.includes("max")) return "high";
  return effort === "max" ? "high" : effort === "on" ? "medium" : "";
}
// The extra request fields for this address and saved level.
export function effortBody(base, effort) {
  const e = effortFor(base, effort);
  return e ? effortFamily(base).body(e) : {};
}
