// Find in the open document: a bar under a pane's toolbar (⌘F / Ctrl+F, or the magnifier button) that marks
// every match, counts them, and steps through them with Enter / ⇧Enter (or ⌘G / ⇧⌘G).
//
// In the reading view the matches are CSS highlights over the rendered text, so the document's DOM is never
// touched. A note or a file being edited is a <textarea>, which can't paint inside itself; a mirror laid over
// it, with the same font, padding and wrapping and transparent text, paints the marks in the same places.

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption, summary, div, section, table, tr, details";
const SKIP = "script, style, svg, .katex-mathml, .toc";
const MAX = 2000;   // past this the count says "2000+" and the rest go unmarked
const canPaint = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";

export const findRe = (q) => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");

// Every match in the text a reader sees under root, as Ranges. Text runs on across inline elements (a word half
// in bold still matches) but not from one block into the next.
export function rangesIn(root, q) {
  const re = findRe(q), out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let nodes = [], starts = [], text = "", block;
  const flush = () => {
    let k = 0;
    for (const m of text.matchAll(re)) {
      if (out.length >= MAX) break;
      const s = m.index, e = s + m[0].length;
      while (k < nodes.length - 1 && starts[k + 1] <= s) k++;
      let j = k;
      while (j < nodes.length - 1 && starts[j + 1] < e) j++;
      const r = document.createRange();
      r.setStart(nodes[k], s - starts[k]); r.setEnd(nodes[j], e - starts[j]);
      out.push(r);
    }
    nodes = []; starts = []; text = "";
  };
  for (let n; (n = walker.nextNode());) {
    const b = n.parentElement.closest(BLOCKS);
    if (b !== block) { flush(); block = b; }
    starts.push(text.length); nodes.push(n); text += n.data;
  }
  flush();
  return out;
}

// Offsets [start, end] of every match in a plain string.
export function spansIn(text, q) {
  const out = [];
  for (const m of text.matchAll(findRe(q))) { out.push([m.index, m.index + m[0].length]); if (out.length >= MAX) break; }
  return out;
}

// All open finders share the page's two highlight layers.
const finders = new Set();
function paint() {
  if (!canPaint) return;
  const all = [], cur = [];
  for (const f of finders) if (f.isOpen() && !f.inText()) f.ranges.forEach((r, i) => (i === f.i ? cur : all).push(r));
  CSS.highlights.set("suiji-find", new Highlight(...all));
  CSS.highlights.set("suiji-find-cur", new Highlight(...cur));
}

const MIRROR_CSS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontFeatureSettings", "fontVariant", "lineHeight",
  "letterSpacing", "wordSpacing", "tabSize", "textIndent", "textTransform", "textAlign", "direction", "wordBreak", "overflowWrap",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];

// One pane's finder. ctx: el (the pane), ta (its textarea), preview, inText() (whether the textarea is what shows),
// canFind() (a document is open), ready() (what shows is that document, not the one before it), zoom() (the page's zoom), t (i18n).
export function makeFind(ctx) {
  const { el, ta, preview, t } = ctx;
  const bar = el.querySelector(".p-find"), input = bar.querySelector(".p-find-q"), count = bar.querySelector(".p-find-n");
  const mirror = document.createElement("div");
  mirror.className = "find-mirror"; mirror.hidden = true; mirror.setAttribute("aria-hidden", "true");
  ta.after(mirror);
  const f = { ranges: [], spans: [], i: -1, isOpen: () => !bar.hidden, inText: ctx.inText, open, close, refresh, step, retarget, query: () => input.value };
  let pending = false;   // go to the first match once the document has arrived
  finders.add(f);

  function open(q, { focus = true, jump = true } = {}) {
    if (!ctx.canFind()) return false;
    bar.hidden = false; el.classList.add("finding"); el.querySelector(".p-findbtn")?.setAttribute("aria-pressed", "true");
    if (q != null) input.value = q;
    if (focus) { input.focus(); input.select(); }
    f.i = -1; pending = jump; refresh(jump);
    return true;
  }
  function close({ toText = true } = {}) {
    if (bar.hidden) return;
    bar.hidden = true; el.classList.remove("finding"); el.querySelector(".p-findbtn")?.setAttribute("aria-pressed", "false");
    const span = ctx.inText() && f.spans[f.i];
    f.ranges = []; f.spans = []; f.i = -1;
    mirror.hidden = true; mirror.replaceChildren(); paint();
    // Back in the editor with the match it stopped on selected, ready to type over.
    if (toText && span && !ta.hidden) { ta.focus({ preventScroll: true }); ta.setSelectionRange(span[0], span[1]); }
  }
  // The pane shows another document, or the same one in the other view (reading / editing).
  function retarget() { if (!bar.hidden) { f.i = -1; pending = true; refresh(true); } }
  // Finds again (the text or the query changed). jump: go to the first match at or after the reading place.
  function refresh(jump) {
    if (bar.hidden) return;
    if (!ctx.ready()) { f.ranges = []; f.spans = []; f.i = -1; draw(); count.textContent = ""; return; }
    jump = jump || pending;
    const q = input.value, text = ctx.inText();
    const before = f.i;
    f.ranges = []; f.spans = [];
    if (q && ctx.canFind()) {
      if (text) f.spans = spansIn(ta.value, q);
      else f.ranges = rangesIn(preview.querySelector(".md-body") || preview, q);
    }
    const n = text ? f.spans.length : f.ranges.length;
    f.i = !n ? -1 : jump ? firstInView() : Math.min(Math.max(before, 0), n - 1);
    draw(); show();
    if (jump && n) { pending = false; reveal(); }
  }
  // The first match whose top is at or below the top of the view, else the first.
  function firstInView() {
    const sc = ctx.inText() ? ta : preview;
    if (ctx.inText()) { buildMirror(); const ms = [...mirror.querySelectorAll("mark")]; const k = ms.findIndex((m) => m.offsetTop >= ta.scrollTop); return Math.max(0, k); }
    const top = sc.getBoundingClientRect().top;
    const k = f.ranges.findIndex((r) => r.getBoundingClientRect().top >= top);
    return Math.max(0, k);
  }
  function step(d) {
    if (bar.hidden) return;
    const n = ctx.inText() ? f.spans.length : f.ranges.length;
    if (!n) return;
    f.i = (f.i + d + n) % n;
    draw(); show(); reveal();
  }
  function show() {
    const n = ctx.inText() ? f.spans.length : f.ranges.length;
    count.textContent = !input.value ? "" : n ? `${f.i + 1}/${n >= MAX ? MAX + "+" : n}` : t("无结果");
    bar.classList.toggle("none", !!input.value && !n);
    for (const b of bar.querySelectorAll(".p-find-prev, .p-find-next")) b.disabled = !n;
  }
  function draw() {
    if (ctx.inText()) buildMirror(); else { mirror.hidden = true; mirror.replaceChildren(); }
    paint();
  }
  // The mirror: the textarea's text with each match in a <mark>, laid exactly over the textarea.
  function buildMirror() {
    if (!f.spans.length || ta.hidden) { mirror.hidden = true; mirror.replaceChildren(); return; }
    const cs = getComputedStyle(ta), v = ta.value, parts = [];
    for (const k of MIRROR_CSS) mirror.style[k] = cs[k];
    let at = 0;
    f.spans.forEach(([s, e], i) => {
      parts.push(document.createTextNode(v.slice(at, s)));
      const m = document.createElement("mark");
      if (i === f.i) m.className = "cur";
      m.textContent = v.slice(s, e); parts.push(m); at = e;
    });
    parts.push(document.createTextNode(v.slice(at) + "​"));
    mirror.replaceChildren(...parts);
    place(); mirror.hidden = false;
  }
  function place() {
    Object.assign(mirror.style, {
      left: ta.offsetLeft + ta.clientLeft + "px", top: ta.offsetTop + ta.clientTop + "px",
      width: ta.clientWidth + "px", height: ta.clientHeight + "px",
    });
    mirror.scrollTop = ta.scrollTop; mirror.scrollLeft = ta.scrollLeft;
  }
  // Scrolls the current match into view, a third of the way down, unless it is already comfortably in view.
  function reveal() {
    if (f.i < 0) return;
    if (ctx.inText()) {
      const m = mirror.querySelector("mark.cur");
      if (!m) return;
      if (m.offsetTop < ta.scrollTop + 8 || m.offsetTop + m.offsetHeight > ta.scrollTop + ta.clientHeight - 8) {
        ta.scrollTop = Math.max(0, m.offsetTop - ta.clientHeight / 3); mirror.scrollTop = ta.scrollTop;
      }
      // Selected quietly, so leaving the bar (Esc) lands on it; not while the user is typing in the note.
      if (document.activeElement !== ta) ta.setSelectionRange(...f.spans[f.i]);
      return;
    }
    const r = f.ranges[f.i];
    // A match inside a folded <details> opens it.
    for (let d = r.startContainer.parentElement?.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])")) d.open = true;
    const box = r.getBoundingClientRect(), sc = preview.getBoundingClientRect(), z = ctx.zoom();
    const clear = Math.max(sc.top, bar.getBoundingClientRect().bottom);   // on phones the bar floats over the text
    if (box.top < clear + 8 || box.bottom > sc.bottom - 8) preview.scrollTop += (box.top - clear - (sc.bottom - clear) / 3) / z;
    // Wide code blocks and tables scroll sideways on their own.
    const wide = r.startContainer.parentElement?.closest("pre, .table-wrap, table");
    if (wide && wide.scrollWidth > wide.clientWidth) {
      const w = wide.getBoundingClientRect(), b = r.getBoundingClientRect();
      if (b.left < w.left || b.right > w.right) wide.scrollLeft += (b.left - w.left - w.width / 3) / z;
    }
  }

  let typing = 0;
  input.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => refresh(true), 90); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(typing); if (f.i < 0) refresh(true); else step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  });
  bar.querySelector(".p-find-next").onclick = () => step(1);
  bar.querySelector(".p-find-prev").onclick = () => step(-1);
  bar.querySelector(".p-find-x").onclick = () => close();
  // The text under the bar changed: a note being typed in, or the preview rendering (diagrams and formulas
  // arrive after the text) or showing another document.
  let later = 0;
  const soon = () => { if (bar.hidden) return; clearTimeout(later); later = setTimeout(() => refresh(false), 150); };
  ta.addEventListener("input", () => { mirror.hidden = true; soon(); });
  ta.addEventListener("scroll", () => { if (!mirror.hidden) { mirror.scrollTop = ta.scrollTop; mirror.scrollLeft = ta.scrollLeft; } }, { passive: true });
  new MutationObserver(soon).observe(preview, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(() => { if (!mirror.hidden) buildMirror(); }).observe(ta);
  return f;
}

// A line of a document around the first match of q, for a search result: [before, match, after].
export function snippet(text, q, room = 48) {
  const low = text.toLowerCase(), at = low.indexOf(q);
  if (at < 0) return null;
  const ls = text.lastIndexOf("\n", at) + 1, le = (text.indexOf("\n", at) + 1 || text.length + 1) - 1;
  const from = Math.max(ls, at - 16), to = Math.min(le, at + q.length + room);
  const clean = (s) => s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, "").replace(/[*`]+/g, "");
  const before = (from > ls ? "…" : "") + (from > ls ? text.slice(from, at) : clean(text.slice(ls, at)));
  return [before, text.slice(at, at + q.length), text.slice(at + q.length, to).replace(/[*`]+/g, "") + (to < le ? "…" : "")];
}
