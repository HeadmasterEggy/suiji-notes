// The right-click menu in a document: in the editor, formatting, paragraph styles and inserts on top of
// cut / copy / paste; in a rendered file, copy and links. With text selected, it can also hand the selection
// to the assistant. Shift + right-click (and anywhere outside a document) keeps the system menu, which in the
// Mac app includes 检查元素 (Inspect Element). Edits go through execCommand("insertText") so ⌘Z undoes them.
import { t } from "./i18n.js";

let menu = null, api = null, origin = null;   // origin: what had focus before the menu opened

const sep = { sep: true };
const today = () => new Date().toLocaleDateString("sv");   // 2026-11-05

// ---------- editing a textarea ----------
function put(ta, text, selStart, selEnd) {
  ta.focus();
  if (!document.execCommand("insertText", false, text)) {   // execCommand refused: no undo, but the edit lands
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (selStart != null) ta.setSelectionRange(selStart, selEnd ?? selStart);
}
// **bold** and the like: wrap the selection, or unwrap it when it is already wrapped.
function wrap(ta, l, r = l, hint = t("文字")) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e);
  if (sel.startsWith(l) && sel.endsWith(r) && sel.length >= l.length + r.length) {
    put(ta, sel.slice(l.length, sel.length - r.length)); ta.setSelectionRange(s, e - l.length - r.length); return;
  }
  if (v.slice(s - l.length, s) === l && v.slice(e, e + r.length) === r) {
    ta.setSelectionRange(s - l.length, e + r.length); put(ta, sel); ta.setSelectionRange(s - l.length, e - l.length); return;
  }
  const body = sel || hint;
  put(ta, l + body + r); ta.setSelectionRange(s + l.length, s + l.length + body.length);
}
// Headings, quotes and lists: the same prefix on every selected line, or off again when all have it.
function lines(ta, prefix, re) {
  const v = ta.value, s = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let e = v.indexOf("\n", Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === "\n" ? 1 : 0), s));
  if (e < 0) e = v.length;
  const rows = v.slice(s, e).split("\n"), pre = typeof prefix === "function" ? prefix : () => prefix;
  const off = rows.every((x, i) => !x.trim() || x.startsWith(pre(i)));
  const out = rows.map((x, i) => !x.trim() && rows.length > 1 ? x : off ? x.replace(re, "") : pre(i) + x.replace(re, "")).join("\n");
  ta.setSelectionRange(s, e); put(ta, out, s, s + out.length);
}
const BLOCK = /^(#{1,6}\s|>\s?|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+\.\s)/;
function block(ta, text, caret) {
  const s = ta.selectionStart, v = ta.value;
  const before = s && v[s - 1] !== "\n" ? "\n\n" : s > 1 && v[s - 2] !== "\n" ? "\n" : "";
  put(ta, before + text + "\n");
  const at = s + before.length + (caret ?? text.length);
  ta.setSelectionRange(at, at);
}

function editorItems(ta, sel) {
  const f = (label, fn, key) => ({ label, key, run: () => fn(ta) });
  return [
    ...(sel ? [{ label: t("问助手…"), run: () => api.ask(sel, ta) }, { label: t("让助手解释"), run: () => api.ask(sel, ta, t("解释一下这段内容。")) }, sep] : []),
    { label: t("文本格式"), sub: [
      f(t("加粗"), (x) => wrap(x, "**"), "⌘B"),
      f(t("斜体"), (x) => wrap(x, "*"), "⌘I"),
      f(t("删除线"), (x) => wrap(x, "~~")),
      f(t("高亮"), (x) => wrap(x, "==")),
      f(t("行内代码"), (x) => wrap(x, "`", "`", "code")),
      f(t("行内公式"), (x) => wrap(x, "$", "$", "x^2")),
    ] },
    { label: t("段落设置"), sub: [
      f(t("正文"), (x) => lines(x, "", BLOCK)),
      ...[1, 2, 3, 4].map((n) => f(t("{n} 级标题", { n }), (x) => lines(x, "#".repeat(n) + " ", BLOCK))),
      sep,
      f(t("引用"), (x) => lines(x, "> ", BLOCK)),
      f(t("无序列表"), (x) => lines(x, "- ", BLOCK)),
      f(t("有序列表"), (x) => lines(x, (i) => i + 1 + ". ", BLOCK)),
      f(t("待办事项"), (x) => lines(x, "- [ ] ", BLOCK)),
    ] },
    { label: t("插入"), sub: [
      f(t("链接"), (x) => { const s = x.selectionStart, txt = x.value.slice(s, x.selectionEnd) || t("链接文字"); put(x, `[${txt}](https://)`); x.setSelectionRange(s + txt.length + 3, s + txt.length + 11); }, "⌘K"),
      f(t("表格"), (x) => block(x, `| ${t("列 1")} | ${t("列 2")} |\n| --- | --- |\n|  |  |`, 2)),
      f(t("代码块"), (x) => block(x, "```\n\n```", 4)),
      f(t("公式块"), (x) => block(x, "$$\n\n$$", 3)),
      f(t("Mermaid 图"), (x) => block(x, "```mermaid\ngraph TD\n  A --> B\n```", 25)),
      f(t("分隔线"), (x) => block(x, "---")),
      f(t("今天的日期"), (x) => put(x, today())),
    ] },
    sep,
    { label: t("剪切"), key: "⌘X", off: !sel, run: () => { navigator.clipboard.writeText(sel).then(() => put(ta, "")); } },
    { label: t("复制"), key: "⌘C", off: !sel, run: () => navigator.clipboard.writeText(sel) },
    { label: t("粘贴"), key: "⌘V", run: () => navigator.clipboard.readText().then((x) => x && put(ta, x)).catch(() => api.toast?.(t("没有读取剪贴板的权限，请按 ⌘V 粘贴"))) },
    { label: t("全选"), key: "⌘A", run: () => { ta.focus(); ta.select(); } },
  ];
}

function viewItems(target, sel) {
  const a = target.closest("a[href]"), href = a && (a.dataset.open ? null : a.href);
  return [
    ...(sel ? [{ label: t("问助手…"), run: () => api.ask(sel, target) }, { label: t("让助手解释"), run: () => api.ask(sel, target, t("解释一下这段内容。")) }, sep] : []),
    ...(href ? [{ label: t("在新窗口打开链接"), run: () => window.open(href, "_blank", "noopener") }, { label: t("复制链接"), run: () => navigator.clipboard.writeText(href) }, sep] : []),
    { label: t("复制"), key: "⌘C", off: !sel, run: () => navigator.clipboard.writeText(sel) },
    { label: t("全选"), key: "⌘A", run: () => { const r = document.createRange(); r.selectNodeContents(target.closest(".p-preview")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } },
  ];
}

// ---------- the menu itself ----------
function close(refocus) {
  document.querySelectorAll(".cm").forEach((m) => m.remove()); menu = null;
  if (refocus && origin?.isConnected) origin.focus({ preventScroll: true });
  origin = null;
}
function build(items, x, y, parent) {
  const box = document.createElement("div");
  box.className = "cm glass"; box.setAttribute("role", "menu");
  for (const it of items) {
    if (it.sep) { box.append(Object.assign(document.createElement("div"), { className: "cm-sep" })); continue; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "cm-item" + (it.sub ? " has-sub" : ""); b.setAttribute("role", "menuitem"); b.disabled = !!it.off;
    b.append(Object.assign(document.createElement("span"), { textContent: it.label }));
    if (it.key || it.sub) b.append(Object.assign(document.createElement("small"), { textContent: it.sub ? "›" : it.key }));
    if (it.sub) {
      // A submenu goes on the page itself: the menu's backdrop blur would make it the submenu's frame for "fixed".
      const open = () => {
        if (box.sub?.isConnected && box.sub.from === b) return;
        box.sub?.remove();
        const r = b.getBoundingClientRect(), sub = build(it.sub, 0, 0, box);
        sub.from = b; box.sub = sub;
        document.body.append(sub); place(sub, r.right - 4, r.top - 5, r.left + 4);
      };
      b.onmouseenter = open; b.onclick = open;
    } else {
      b.onmouseenter = () => box.sub?.remove();
      b.onclick = () => { close(); it.run(); };
    }
    box.append(b);
  }
  if (!parent) { document.body.append(box); place(box, x, y); menu = box; }
  return box;
}
// Keep it on screen: flip left of the parent item (or the pointer) when there is no room on the right.
// x, y and the window size are screen pixels; under the browser's CSS zoom (app.js) the page's own are bigger.
function place(box, x, y, flipX = x) {
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  x /= z; y /= z; flipX /= z;
  box.style.left = "0"; box.style.top = "0";
  const w = box.offsetWidth, h = box.offsetHeight, W = innerWidth / z, H = innerHeight / z;
  const left = x + w > W - 8 ? Math.max(8, flipX - w) : x, top = Math.min(y, H - h - 8);
  box.style.position = "fixed"; box.style.left = left + "px"; box.style.top = Math.max(8, top) + "px";
}

export function mountMenu(a) {
  api = a;
  document.addEventListener("contextmenu", (e) => {
    close();
    if (e.shiftKey || matchMedia("(hover: none)").matches) return;   // the system menu (Inspect Element), and phones' own
    const ta = e.target.closest?.("textarea.p-ta"), view = e.target.closest?.(".p-preview");
    if (!ta && !view) return;
    e.preventDefault();
    const sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : String(getSelection()).trim();
    origin = document.activeElement;
    build(ta ? editorItems(ta, sel) : viewItems(e.target, sel), e.clientX, e.clientY);
  });
  addEventListener("pointerdown", (e) => { if (menu && !e.target.closest(".cm")) close(); }, true);
  // From the keyboard: ↑ / ↓ (and Home / End) move through the items, → opens a submenu, ← goes back out,
  // Enter picks, Escape closes and returns to where the focus was. Keys don't reach the text underneath.
  addEventListener("keydown", (e) => {
    if (!menu) return;
    const k = e.key;
    if (!["Escape", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(k)) return;
    e.preventDefault(); e.stopPropagation();
    if (k === "Escape") return close(true);
    const box = document.activeElement.closest?.(".cm") || menu;
    const items = [...box.querySelectorAll(".cm-item:not(:disabled)")], i = items.indexOf(document.activeElement);
    if (k === "ArrowRight") {
      if (items[i]?.classList.contains("has-sub")) { items[i].click(); items[i].closest(".cm").sub?.querySelector(".cm-item:not(:disabled)")?.focus(); }
      return;
    }
    if (k === "ArrowLeft") { if (box !== menu) { box.remove(); box.from.focus(); } return; }
    const n = k === "Home" ? 0 : k === "End" ? items.length - 1 : i < 0 ? (k === "ArrowDown" ? 0 : items.length - 1)
      : (i + (k === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[n]?.focus();
  }, true);
  addEventListener("blur", close);
  addEventListener("resize", close);
  document.addEventListener("scroll", close, true);
  // ⌘B / ⌘I / ⌘K in the editor.
  document.addEventListener("keydown", (e) => {
    const ta = e.target.closest?.("textarea.p-ta");
    if (!ta || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === "b") wrap(ta, "**");
    else if (k === "i") wrap(ta, "*");
    else if (k === "k") { const s = ta.selectionStart, txt = ta.value.slice(s, ta.selectionEnd) || t("链接文字"); put(ta, `[${txt}](https://)`); ta.setSelectionRange(s + txt.length + 3, s + txt.length + 11); }
    else return;
    e.preventDefault();
  });
}
