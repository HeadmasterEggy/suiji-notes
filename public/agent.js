// The notes assistant: a chat panel beside the documents (⌘J). The model runs in api/agent.js; its tools run
// here, on the notes and files this page already has. Edits are only proposed: each one shows as a diff,
// and nothing changes until the user presses 应用 (Apply).
import { t, lang } from "./i18n.js";
import { TOOLS, instructions } from "./agentspec.js";

const MAX_STEPS = 10, READ_CHUNK = 30000, SEARCH_TEXT_FILES = 400;
let app = null;            // what app.js hands over in mountAgent()
let messages = [];         // the conversation, as AI SDK model messages
let busy = null;           // AbortController of the running turn
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

// ---------- documents ----------
const docs = () => [
  ...app.notes().map((n) => ({ id: n.id, kind: "note", title: app.titleOf(n.body), path: t("随手记") + "/" + app.titleOf(n.body), updated_at: n.updated_at, tags: [], note: n })),
  ...app.files().map((f) => ({ id: f.id, kind: "file", title: f.name.split("/").pop(), path: (f.folder ? f.folder + "/" : "") + f.name, updated_at: f.updated_at, tags: f.tags || [], file: f })),
];
const find = (id) => docs().find((d) => d.id === id);
async function textOf(d) {
  if (d.kind === "note") return d.note.body;
  if (!app.isText(d.file)) throw new Error("not a text file: " + d.path);
  return app.fileText(d.file);
}
const ref = (d) => ({ id: d.id, title: d.title, path: d.path, updated: (d.updated_at || "").slice(0, 10) });

async function search({ query, limit = 10 }) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [] };
  const all = docs();
  // Text files are read for their content too (from the device cache when possible), most recent first.
  const texty = all.filter((d) => d.kind === "file" && app.isText(d.file)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, SEARCH_TEXT_FILES);
  const texts = new Map(all.filter((d) => d.kind === "note").map((d) => [d.id, d.note.body]));
  for (let i = 0; i < texty.length; i += 8) {
    await Promise.all(texty.slice(i, i + 8).map((d) => app.fileText(d.file).then((s) => texts.set(d.id, s), () => {})));
  }
  const hits = [];
  for (const d of all) {
    const head = (d.path + " " + d.tags.join(" ")).toLowerCase(), body = (texts.get(d.id) || "").toLowerCase();
    if (!terms.every((w) => head.includes(w) || body.includes(w))) continue;
    const score = terms.reduce((s, w) => s + (head.includes(w) ? 5 : 0) + Math.min(body.split(w).length - 1, 10), 0);
    const at = Math.max(0, ...terms.map((w) => body.indexOf(w)).filter((i) => i >= 0).slice(0, 1));
    const text = texts.get(d.id) || "";
    hits.push({ ...ref(d), score, snippet: text.slice(Math.max(0, at - 60), at + 160).replace(/\s+/g, " ").trim() });
  }
  hits.sort((a, b) => b.score - a.score);
  return { total: hits.length, results: hits.slice(0, Math.min(limit, 30)).map(({ score, ...h }) => h) };
}

function list({ folder } = {}) {
  const all = docs();
  const dirOf = (d) => d.path.split("/").slice(0, -1).join("/");
  if (!folder) {
    const n = new Map();
    for (const d of all) n.set(dirOf(d), (n.get(dirOf(d)) || 0) + 1);
    return { folders: [...n].sort().slice(0, 300).map(([path, files]) => ({ path, files })) };
  }
  const inside = all.filter((d) => dirOf(d) === folder || dirOf(d).startsWith(folder + "/"))
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return { total: inside.length, files: inside.slice(0, 150).map(ref) };
}

async function read({ id, offset = 0 }) {
  const d = find(id);
  if (!d) return { error: "no document with id " + id };
  const text = await textOf(d);
  const part = text.slice(offset, offset + READ_CHUNK);
  return { ...ref(d), total_chars: text.length, offset, text: part, ...(offset + READ_CHUNK < text.length ? { next_offset: offset + READ_CHUNK } : {}) };
}

// ---------- proposals ----------
async function proposeEdit({ id, summary, replacements, content }, bubble) {
  const d = find(id);
  if (!d) return { error: "no document with id " + id };
  if (d.kind === "file" && !app.isText(d.file)) return { error: "only text files can be edited" };
  const base = await textOf(d);
  let next = base;
  if (typeof content === "string") next = content;
  else if (Array.isArray(replacements) && replacements.length) {
    for (const r of replacements) {
      const n = next.split(r.find).length - 1;
      if (n !== 1) return { error: `"${r.find.slice(0, 80)}" appears ${n} times in the current text; it must appear exactly once. Read the document again and use a longer, unique find.` };
      next = next.replace(r.find, () => r.replace);
    }
  } else return { error: "give replacements or content" };
  if (next === base) return { error: "the change leaves the text the same" };
  bubble.append(diffCard(d, summary, base, next));
  return { status: "shown to the user as a diff; it is applied only if they press Apply" };
}
function proposeNote({ body, summary }, bubble) {
  const card = el("div", "ag-card");
  card.append(el("div", "ag-card-head", "＋ " + (summary || t("新建随手记"))), diffView("", body));
  const bar = el("div", "ag-card-bar"), yes = el("button", "btn-primary small", t("创建")), no = el("button", "ghost bordered small", t("不用了"));
  yes.onclick = () => { const id = app.newNote(body); settle(card, t("已创建"), () => app.open("note", id)); };
  no.onclick = () => settle(card, t("已放弃"));
  bar.append(yes, no); card.append(bar);
  bubble.append(card);
  return { status: "shown to the user; created only if they press Create" };
}
function diffCard(d, summary, base, next) {
  const card = el("div", "ag-card");
  const head = el("div", "ag-card-head");
  const name = el("a", null, d.title); name.href = "#"; name.onclick = (e) => { e.preventDefault(); app.open(d.kind, d.id); };
  head.append(el("span", null, "✎ "), name, el("span", "ag-sum", " · " + summary));
  const bar = el("div", "ag-card-bar"), yes = el("button", "btn-primary small", t("应用")), no = el("button", "ghost bordered small", t("放弃"));
  yes.onclick = async () => {
    yes.disabled = no.disabled = true;
    try {
      const now = find(d.id);
      if (!now || await textOf(now) !== base) throw new Error(t("文档在这之后改过了，请让助手重新生成修改。"));
      await app.apply(now, next);
      settle(card, t("已应用"), () => app.open(d.kind, d.id));
    } catch (e) {
      yes.disabled = no.disabled = false;
      card.querySelector(".ag-err")?.remove();
      card.append(el("p", "ag-err", e.message || String(e)));
    }
  };
  no.onclick = () => settle(card, t("已放弃"));
  bar.append(yes, no);
  card.append(head, diffView(base, next), bar);
  return card;
}
function settle(card, label, open) {
  const bar = card.querySelector(".ag-card-bar");
  bar.replaceChildren(el("span", "ag-done", label));
  if (open) { const b = el("button", "ghost bordered small", t("打开")); b.onclick = open; bar.append(b); }
}

// Line diff: common start and end trimmed, then LCS on the middle; unchanged runs fold to two lines of context.
function diffLines(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e), out = A.slice(0, s).map((x) => [" ", x]);
  if (a2.length * b2.length > 4e6) { out.push(...a2.map((x) => ["-", x]), ...b2.map((x) => ["+", x])); }
  else {
    const L = Array.from({ length: a2.length + 1 }, () => new Uint16Array(b2.length + 1));
    for (let i = a2.length - 1; i >= 0; i--) for (let j = b2.length - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < a2.length || j < b2.length) {
      if (i < a2.length && j < b2.length && a2[i] === b2[j]) { out.push([" ", a2[i]]); i++; j++; }
      else if (i < a2.length && (j === b2.length || L[i + 1][j] >= L[i][j + 1])) out.push(["-", a2[i++]]);
      else out.push(["+", b2[j++]]);
    }
  }
  out.push(...A.slice(A.length - e).map((x) => [" ", x]));
  return out;
}
function diffView(a, b) {
  const box = el("div", "ag-diff"), rows = diffLines(a, b);
  const keep = rows.map((r, i) => r[0] !== " " || rows.slice(Math.max(0, i - 2), i + 3).some((x) => x[0] !== " "));
  let gap = 0;
  const flush = () => { if (gap) box.append(el("div", "ag-gap", "⋯ " + t("{n} 行未改", { n: gap }))); gap = 0; };
  rows.forEach(([k, line], i) => {
    if (!keep[i]) { gap++; return; }
    flush();
    box.append(el("div", k === "+" ? "add" : k === "-" ? "del" : "ctx", line || " "));
  });
  flush();
  return box;
}

// ---------- the conversation ----------
// A model on this computer (Settings → Assistant → Magpie / 本机接口): the page calls it directly, since the
// server can't reach 127.0.0.1. Kept on this device only ("suiji:local-ai": {base, key, model}).
// In the Mac app, connecting 随记 on Magpie's Agents page comes first (magpie/suiji.agent.js).
export function localModel() {
  if (magpie) return magpie;
  try { const c = JSON.parse(localStorage.getItem("suiji:local-ai")); return c?.base && c?.model ? c : null; } catch { return null; }
}
export function setLocalModel(c) { try { c ? localStorage.setItem("suiji:local-ai", JSON.stringify(c)) : localStorage.removeItem("suiji:local-ai"); } catch {} }

// In the Mac app, WebKit won't let the https page call http://127.0.0.1, so the app makes those requests
// (mac/main.swift, op localHttp); the answer then comes back whole instead of streamed.
const appBridge = window.webkit?.messageHandlers?.suijiFs;

// What Magpie wrote for 随记 (~/.config/suiji/magpie.json, read by the app), re-read before each use so a
// model picked or a disconnect in Magpie applies at once. Older apps don't know the op: no Magpie link.
let magpie = null;
export async function refreshMagpie() {
  if (!appBridge) return magpie;
  try {
    const c = await appBridge.postMessage({ op: "magpieLink" });
    magpie = c?.enabled && c.url && c.model ? { preset: "magpie", base: c.url, model: c.model, key: c.key || "", magpie: true } : null;
  } catch { magpie = null; }
  return magpie;
}
const viaApp = (url) => !!appBridge && /^http:\/\//i.test(url);
export async function localHttp(url, { method = "GET", headers = {}, body } = {}) {
  if (viaApp(url)) { const r = await appBridge.postMessage({ op: "localHttp", url, method, headers, body }); return { status: r.status, text: r.body }; }
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text() };
}

// The steps of one model turn, as {t:"text"|"reasoning", d} / {t:"tool", id, name, input} / {t:"error", message, code}.
// The server answers in NDJSON, errors included; anything else (no network, a host's HTML error page, a
// timeout) is said in words rather than as a JSON parse error.
async function* serverStream(signal) {
  const res = await fetch("/api/agent", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: "Bearer " + await app.token() },
    body: JSON.stringify({ messages: messages.map(({ reasoning, ...m }) => m), context: { lang, open: app.context() } }),
  }).catch((e) => { throw e.name === "AbortError" ? e : new Error(t("连不上助手服务，检查一下网络。")); });
  const down = () => new Error(t("助手服务没有正常回应（HTTP {status}），稍后再试。", { status: res.status }));
  if (!res.body || !/ndjson/.test(res.headers.get("content-type") || "")) throw down();
  for await (const ln of lines(res.body)) {
    let m; try { m = JSON.parse(ln); } catch { throw down(); }
    yield m;
  }
}
async function* localStream(cfg, signal) {
  const url = cfg.base.replace(/\/+$/, "") + "/chat/completions", whole = viaApp(url);
  const headers = { "content-type": "application/json", ...(cfg.key ? { authorization: "Bearer " + cfg.key } : {}) };
  const body = JSON.stringify({
    model: cfg.model, stream: !whole,
    messages: [{ role: "system", content: instructions({ lang, open: app.context() }) }, ...toOpenAI(messages)],
    tools: Object.entries(TOOLS).map(([name, x]) => ({ type: "function", function: { name, description: x.description, parameters: x.parameters } })),
  });
  const unreachable = (e) => new Error(t("连不上本机的模型服务（{base}）：{msg}", { base: cfg.base, msg: e.message || e }));
  const failed = (status, text) => {
    let msg = text; try { msg = JSON.parse(text).error?.message || text; } catch {}
    return { t: "error", message: `HTTP ${status}: ${String(msg).slice(0, 300)}` };
  };
  if (whole) {
    const r = await localHttp(url, { method: "POST", headers, body }).catch((e) => { throw unreachable(e); });
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (r.status < 200 || r.status >= 300) { yield failed(r.status, r.text); return; }
    const m = JSON.parse(r.text).choices?.[0]?.message || {};
    if (m.reasoning_content || m.reasoning) yield { t: "reasoning", d: m.reasoning_content || m.reasoning };
    if (m.content) yield { t: "text", d: m.content };
    for (const c of m.tool_calls || []) {
      let input = {}; try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch {}
      yield { t: "tool", id: c.id || crypto.randomUUID(), name: c.function?.name, input };
    }
    return;
  }
  const res = await fetch(url, { method: "POST", signal, headers, body }).catch((e) => { throw unreachable(e); });
  if (!res.ok) { yield failed(res.status, await res.text()); return; }
  const calls = [];
  for await (const ln of lines(res.body)) {
    if (!ln.startsWith("data:")) continue;
    const data = ln.slice(5).trim();
    if (data === "[DONE]") break;
    const m = JSON.parse(data);
    if (m.error) { yield { t: "error", message: m.error.message || String(m.error) }; continue; }
    const d = m.choices?.[0]?.delta || {};
    if (d.reasoning_content || d.reasoning) yield { t: "reasoning", d: d.reasoning_content || d.reasoning };
    if (d.content) yield { t: "text", d: d.content };
    for (const c of d.tool_calls || []) {
      const x = calls[c.index ?? calls.length] ||= { id: "", name: "", args: "" };
      if (c.id) x.id = c.id;
      if (c.function?.name) x.name += c.function.name;
      if (c.function?.arguments) x.args += c.function.arguments;
    }
  }
  for (const c of calls.filter(Boolean)) {
    let input = {}; try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = {}; }
    yield { t: "tool", id: c.id || crypto.randomUUID(), name: c.name, input };
  }
}
async function* lines(body) {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) { const ln = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1); if (ln.trim()) yield ln; }
  }
  if (buf.trim()) yield buf;
}
// AI SDK model messages → OpenAI chat messages. Reasoning goes back as reasoning_content, which DeepSeek's
// thinking models need within a turn of tool calls.
function toOpenAI(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === "user") out.push({ role: "user", content: m.content.map((c) => c.text).join("") });
    else if (m.role === "assistant") {
      const calls = m.content.filter((c) => c.type === "tool-call");
      out.push({
        role: "assistant", content: m.content.filter((c) => c.type === "text").map((c) => c.text).join("") || null,
        ...(m.reasoning ? { reasoning_content: m.reasoning } : {}),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.toolCallId, type: "function", function: { name: c.toolName, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      });
    } else for (const r of m.content) out.push({ role: "tool", tool_call_id: r.toolCallId, content: JSON.stringify(r.output.value) });
  }
  return out;
}

async function step(bubble, signal) {
  await refreshMagpie();
  const cfg = localModel();
  let text = "", reasoning = "", calls = [], err = null, code = null;
  const textEl = el("div", "ag-text"); bubble.append(textEl);
  let paint = 0;
  const draw = () => { paint = 0; app.markdown(text).then((html) => { textEl.innerHTML = html; scroll(); }); };
  for await (const m of cfg ? localStream(cfg, signal) : serverStream(signal)) {
    if (m.t === "text") { text += m.d; if (!paint) paint = setTimeout(draw, 120); }
    else if (m.t === "reasoning") reasoning += m.d;
    else if (m.t === "tool") calls.push(m);
    else if (m.t === "error") { err = m.message; code = m.code || null; }
  }
  clearTimeout(paint);
  if (text) draw(); else textEl.remove();
  if (err && !text && !calls.length) throw Object.assign(new Error(err === "not signed in" ? t("请先登录。") : err), { code });
  messages.push({ role: "assistant", content: [...(text ? [{ type: "text", text }] : []), ...calls.map((c) => ({ type: "tool-call", toolCallId: c.id, toolName: c.name, input: c.input }))], ...(reasoning ? { reasoning } : {}) });
  return calls;
}
// Tools that act in the interface right away: they only show things, never change a document.
const UI = {
  open_document({ id, heading, beside }) {
    const d = find(id);
    return d ? app.ui.open({ kind: d.kind, id, heading, beside }) : { error: "no document with id " + id };
  },
  show_graph: ({ ids, query, tag }) => app.ui.graph({ ids, query, tag }),
  show_in_sidebar({ id, folder, filter }) {
    if (id) { const d = find(id); return d ? app.ui.sidebar({ kind: d.kind, id }) : { error: "no document with id " + id }; }
    return app.ui.sidebar({ folder, filter });
  },
};
const CHIP = {
  search: (i) => t("搜索「{q}」", { q: i.query }), list: (i) => i.folder ? t("查看「{f}」", { f: i.folder }) : t("查看所有文件夹"),
  read: (i) => t("读取「{n}」", { n: find(i.id)?.title || i.id }), propose_edit: () => t("准备修改"), propose_note: () => t("准备新建笔记"),
  open_document: (i) => t("打开「{n}」", { n: find(i.id)?.title || i.id }) + (i.heading ? " · " + i.heading : ""),
  show_graph: (i) => i.ids?.length || i.query || i.tag ? t("在图谱中聚焦") : t("打开关系图谱"),
  show_in_sidebar: (i) => i.filter != null ? t("在侧边栏筛选「{q}」", { q: i.filter }) : t("在侧边栏中定位"),
};
async function runTool(c, bubble) {
  const chip = el("div", "ag-chip", CHIP[c.name]?.(c.input || {}) || c.name);
  bubble.append(chip);
  try {
    const i = c.input || {};
    const out = c.name === "search" ? await search(i) : c.name === "list" ? list(i) : c.name === "read" ? await read(i)
      : c.name === "propose_edit" ? await proposeEdit(i, bubble) : c.name === "propose_note" ? proposeNote(i, bubble)
      : c.name in UI ? await UI[c.name](i) : { error: "unknown tool" };
    if (c.name === "search" && !out.error) chip.textContent += " · " + t("{n} 条", { n: out.total });
    if (out.error) chip.classList.add("bad");
    return out;
  } catch (e) {
    chip.classList.add("bad");
    return { error: e.message || String(e) };
  }
}
async function send(text) {
  const q = quote;
  if (busy || !text.trim() && !q) return;
  if (!text.trim()) text = t("解释一下这段内容。");
  setQuote(null);
  const log = $("agLog");
  $("agEmpty")?.remove();
  const mine = el("div", "ag-user");
  if (q) mine.append(el("blockquote", "ag-cite", q.text.length > 400 ? q.text.slice(0, 400) + "…" : q.text));
  mine.append(text);
  log.append(mine);
  // The quoted passage goes to the model in full, with where it is from.
  const said = q ? text + "\n\n" + t("引用的内容（来自「{title}」）：", { title: q.title || t("无标题") }) + "\n\"\"\"\n" + q.text + "\n\"\"\"" : text;
  messages.push({ role: "user", content: [{ type: "text", text: said }] });
  const bubble = el("div", "ag-bot"); log.append(bubble);
  busy = new AbortController(); setBusy(true); scroll();
  try {
    for (let n = 0; n < MAX_STEPS; n++) {
      const calls = await step(bubble, busy.signal);
      if (!calls.length) break;
      const results = [];
      for (const c of calls) results.push({ type: "tool-result", toolCallId: c.id, toolName: c.name, output: { type: "json", value: await runTool(c, bubble) } });
      messages.push({ role: "tool", content: results });
      scroll();
    }
  } catch (e) {
    if (e.code === "no_key") {
      // No key of their own yet: point to Settings rather than showing an error.
      const p = el("p", "ag-err", t("先在「设置 → 助手」里填上你的 API key，就可以开始用了。") + " "), b = el("button", "ghost bordered small", t("去设置"));
      b.type = "button"; b.onclick = () => app.openSettings("aiSec");
      p.append(b); bubble.append(p);
    } else if (e.name !== "AbortError") bubble.append(el("p", "ag-err", t("出错了：{msg}", { msg: e.message || e })));
    // An unanswered tool call would make the next request invalid, so the turn is dropped back to the question.
    while (messages.length && messages.at(-1).role !== "user") messages.pop();
    if (messages.at(-1)?.role === "user") messages.pop();
    // The question (and its quote) go back in the box, so trying again is one click, not retyping.
    const box = $("agInput");
    if (e.name !== "AbortError" && !box.value.trim() && !quote) {
      box.value = text; box.dispatchEvent(new Event("input"));
      if (q) setQuote(q);
    }
  }
  busy = null; setBusy(false); scroll();
}
function setBusy(on) {
  $("agSend").hidden = on; $("agStop").hidden = !on;
  $("agPanel").classList.toggle("busy", on);
}
const scroll = () => { const l = $("agLog"); l.scrollTop = l.scrollHeight; };
function reset() {
  busy?.abort(); messages = []; setQuote(null);
  $("agLog").replaceChildren(empty());
}
function empty() {
  const box = el("div", "ag-empty"); box.id = "agEmpty";
  box.append(el("p", null, t("我可以帮你检索、总结和修改笔记。改动会先给你看，你点「应用」才会生效。")));
  for (const q of [t("总结一下这篇"), t("找出所有提到“反向传播”的笔记"), t("帮我把这篇的错别字改掉")]) {
    const b = el("button", "ghost bordered small", q); b.type = "button"; b.onclick = () => send(q); box.append(b);
  }
  return box;
}

// Text selected in a document, attached to the next message (right-click → 问助手, or ⌘J with a selection).
let quote = null;
function setQuote(q) {
  quote = q;
  const box = $("agQuote");
  box.hidden = !q;
  box.querySelector("blockquote").textContent = q ? (q.text.length > 240 ? q.text.slice(0, 240) + "…" : q.text) : "";
}
export function askAgent(text, question) {
  setQuote({ text: text.trim().slice(0, 20000), title: app.context()?.title || "" });
  toggleAgent(true);
  if (question) send(question);
}

export function toggleAgent(force) {
  const p = $("agPanel"), open = force ?? p.hidden;
  p.hidden = !open;
  document.documentElement.classList.toggle("agent-open", open);
  if (open) $("agInput").focus();
}

export function mountAgent(api) {
  app = api;
  $("agLog").append(empty());
  const input = $("agInput");
  const go = () => { const v = input.value; input.value = ""; input.style.height = ""; send(v); };
  $("agForm").onsubmit = (e) => { e.preventDefault(); go(); };
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } };
  input.oninput = () => { input.style.height = ""; input.style.height = Math.min(input.scrollHeight, 160) + "px"; };
  $("agStop").onclick = () => busy?.abort();
  $("agNew").onclick = () => { reset(); $("agInput").focus(); };   // a new chat is for typing
  $("agClose").onclick = () => toggleAgent(false);
  $("agentBtn").onclick = () => toggleAgent();
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j") return;
    e.preventDefault();
    const ta = e.target.closest?.("textarea.p-ta");
    const sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : getSelection().anchorNode?.parentElement?.closest(".p-preview") ? String(getSelection()) : "";
    if (sel.trim()) askAgent(sel); else toggleAgent();
  });
  $("agQuote").querySelector("button").onclick = () => { setQuote(null); input.focus(); };
  // Links the assistant writes as [title](suiji:ID) open that document.
  $("agLog").addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#suiji:"]');
    if (!a) return;
    e.preventDefault();
    const d = find(a.getAttribute("href").slice(7));
    if (d) app.open(d.kind, d.id);
  });
}
export const resetAgent = () => app && reset();
