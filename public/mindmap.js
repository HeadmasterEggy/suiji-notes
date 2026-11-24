// A document shown as a mind map: its headings and list items as a tree, the title in the middle.
// Documents made with Obsidian's Enhancing Mindmap plugin (front matter "mindmap-plugin: basic", Joey's
// 思维导图 folder) open as a map; any other document with an outline can switch to one with the 导图 button.
// The tree is read from the rendered document, so links, [[wiki links]], formulas and highlights in a node
// work exactly as they do in the text.
import { t } from "./i18n.js";

const GAP_X = 52, GAP_Y = 12, PAD = 28, BRANCHES = 7;
// How the reader left each map, by file id, kept on this device: map or text, zoom, where it was scrolled to,
// and which branches they folded or unfolded. Opening the document again (or a redraw after an edit) puts it
// back that way. Branches are known by their text and the text above them, so an edit elsewhere keeps them.
const KEY = "suiji:mindmap", KEEP = 150;
let saved = null;
const states = () => {
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { saved = {}; } }
  return saved;
};
const storeState = (id, st) => {
  const all = states();
  all[id] = { ...st, t: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > KEEP) ids.sort((a, b) => all[a].t - all[b].t).slice(0, ids.length - KEEP).forEach((k) => delete all[k]);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
};
// A short, stable name for a branch (its path of texts from the title).
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

// Headings nest by level; a list belongs to the heading above it, and a nested list to its item.
export function outlineTree(content, rootHtml) {
  const root = { html: rootHtml, kids: [], level: 0 };
  const stack = [root];
  const under = () => stack[stack.length - 1];
  const fromList = (list, parent) => {
    for (const li of list.children) {
      if (li.tagName !== "LI") continue;
      const label = li.cloneNode(true), sub = [];
      for (const c of [...label.children]) if (c.tagName === "UL" || c.tagName === "OL") c.remove();
      for (const c of li.children) if (c.tagName === "UL" || c.tagName === "OL") sub.push(c);
      // A loose list wraps each item in <p>: the node shows the text, not the paragraph margins.
      const ps = [...label.children].filter((c) => c.tagName === "P");
      const html = ps.length ? ps.map((p) => p.innerHTML).join("<br>") : label.innerHTML;
      const node = { html: html.trim(), kids: [] };
      if (!node.html && !sub.length) continue;
      parent.kids.push(node);
      for (const s of sub) fromList(s, node);
    }
  };
  const walk = (nodes) => {
    for (const c of nodes) {
      const h = /^H([1-6])$/.exec(c.tagName);
      if (h) {
        const level = +h[1];
        while (stack.length > 1 && under().level >= level) stack.pop();
        const node = { html: c.innerHTML, kids: [], level };
        under().kids.push(node); stack.push(node);
      } else if (c.tagName === "UL" || c.tagName === "OL") fromList(c, under());
      else if (c.tagName === "SECTION" || c.tagName === "DIV" && !c.className) walk(c.children);
    }
  };
  walk(content.children);
  return root;
}
const count = (n) => n.kids.reduce((s, k) => s + 1 + count(k), 0);

// Adds the map and its switch to a rendered document (art: the .md-body article, content: its text).
export function addMindmap(art, content, { id, mindmap }) {
  if (!content) return;
  const title = art.querySelector(".md-head .md-title");
  const root = outlineTree(content, title ? title.innerHTML : "");
  const total = count(root);
  if (!mindmap && total < 3) return;   // nothing that reads as a tree
  const last = id != null ? states()[id] : null;
  const opened = new Set(last?.open || []), shut = new Set(last?.shut || []);

  const view = el("div", "mm-view"), stage = el("div", "mm-stage"), canvas = el("div", "mm-canvas");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mm-links"); svg.setAttribute("aria-hidden", "true");
  canvas.append(svg); stage.append(canvas); view.append(stage);
  const bar = el("div", "mm-bar");
  const btn = (cls, label, text) => { const b = el("button", "mm-btn " + cls, text); b.type = "button"; b.title = label; b.setAttribute("aria-label", label); bar.append(b); return b; };
  const out = btn("mm-out", t("缩小"), "−"), pct = el("span", "mm-pct", "100%"); bar.append(pct);
  const inn = btn("mm-in", t("放大"), "+"), fit = btn("mm-fit", t("适应宽度"), t("适应"));
  const all = btn("mm-all", t("全部展开"), t("展开")), fold = btn("mm-fold-all", t("收起到第一层"), t("折叠"));
  const full = btn("mm-full", t("全屏查看"), "");
  full.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>';
  const box = el("section", "mm");
  box.append(bar, view);
  content.before(box);

  // Every node of the tree gets its element now; positions come when the map is on screen and can be measured.
  const nodes = [];
  const make = (n, depth, branch, parent) => {
    n.depth = depth; n.branch = branch; n.parent = parent;
    n.el = el("div", "mm-node");
    n.el.dataset.depth = Math.min(depth, 3);
    n.el.tabIndex = 0;
    if (depth) n.el.style.setProperty("--c", `var(--mm-c${branch % BRANCHES})`);
    const text = el("div", "mm-text"); text.innerHTML = n.html || "&nbsp;";
    n.el.append(text);
    n.key = hash((parent ? parent.key + "\n" : "") + text.textContent.trim());
    if (n.kids.length && depth) { n.fold = el("span", "mm-fold"); n.el.append(n.fold); n.el.classList.add("has-kids"); }
    // A big map opens two levels deep; the rest unfolds a branch at a time.
    n.open = opened.has(n.key) ? true : shut.has(n.key) ? false : depth < 2 || total <= 120;
    n.el.hidden = true;
    n.path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    n.path.setAttribute("class", "mm-link"); n.path.dataset.depth = Math.min(depth, 3);
    if (depth) { n.path.style.stroke = `var(--mm-c${branch % BRANCHES})`; svg.append(n.path); }
    canvas.append(n.el); nodes.push(n);
    n.kids.forEach((k, i) => make(k, depth + 1, depth ? branch : i, n));
  };
  make(root, 0, 0, null);
  const byEl = new Map(nodes.map((n) => [n.el, n]));

  let narrow = false;
  // What scrolls the map up and down: the document, or the map itself when it fills the screen.
  const scroller = () => box.classList.contains("full") ? view : view.closest(".preview") || document.scrollingElement;
  let zoom = 1, laid = false, origin = { x: 0, y: 0 }, anim = 0, focus = null;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const setZoom = (z, keep) => {
    const before = zoom;
    zoom = Math.min(2, Math.max(.3, Math.round(z * 100) / 100));
    pct.textContent = Math.round(zoom * 100) + "%";
    canvas.style.transform = `scale(${zoom})`;
    stage.style.width = canvas.offsetWidth * zoom + "px"; stage.style.height = canvas.offsetHeight * zoom + "px";
    if (keep) view.scrollLeft = (view.scrollLeft + keep) * zoom / before - keep;
    remember();
  };
  // On a phone the text stays readable (never under 75%) and the rest scrolls sideways.
  const fitWidth = () => setZoom(Math.min(1, Math.max(view.clientWidth < 560 ? .75 : .5, (view.clientWidth - 2) / canvas.offsetWidth)));
  const shown = (n) => n.open || !n.depth ? n.kids : [];
  // Boxes (the title and the first two levels) join at their middle; deeper nodes sit on a line and join at it.
  const anchor = (n, x, y, outward, dir) => [outward ? (dir > 0 ? x + n.w : x) : (dir > 0 ? x : x + n.w), n.depth >= 3 ? y + n.h : y + n.h / 2];
  const ease = (p) => 1 - Math.pow(1 - p, 3);

  // Moves every node from where it is to where the new layout puts it: new branches grow out of their parent,
  // folded ones shrink back into it, and the lines follow each frame.
  function layout(first) {
    const visit = (n, vis) => {
      n.vis = vis;
      if (vis) n.el.hidden = false;
      for (const k of n.kids) visit(k, vis && (n.open || !n.depth));
      if (!vis) return;
      n.w = n.el.offsetWidth; n.h = n.el.offsetHeight;
      if (n.fold) {
        n.fold.textContent = n.open ? "−" : String(count(n));
        n.el.classList.toggle("closed", !n.open);
        n.el.setAttribute("aria-expanded", String(n.open));
        n.el.title = n.open ? t("点击折叠") : t("点击展开");
      }
    };
    visit(root, true);
    const span = (n) => {
      const ks = shown(n);
      n.kh = ks.length ? ks.reduce((s, k) => s + span(k), 0) + GAP_Y * (ks.length - 1) : 0;
      return n.sh = Math.max(n.h, n.kh);
    };
    const place = (n, x, top, dir) => {
      n.dir = dir; n.tx = dir > 0 ? x : x - n.w; n.ty = top + (n.sh - n.h) / 2;
      let y = top + (n.sh - n.kh) / 2;
      for (const k of shown(n)) { place(k, dir > 0 ? n.tx + n.w + GAP_X : n.tx - GAP_X, y, dir); y += k.sh + GAP_Y; }
    };
    // The first level splits between the right and left of the title, about half the height each side.
    const ks = root.kids;
    ks.forEach(span);
    const totalH = ks.reduce((s, k) => s + k.sh, 0);
    // A narrow screen (a phone held upright) keeps every branch on the right: tall and narrow fits it better.
    narrow = view.clientWidth < 560;
    let cut = ks.length;
    if (ks.length >= 4 && !narrow) { let acc = 0; cut = 0; while (cut < ks.length && acc + ks[cut].sh / 2 < totalH / 2) acc += ks[cut++].sh; cut = Math.max(1, cut); }
    const right = ks.slice(0, cut), left = ks.slice(cut);
    const height = (g) => g.reduce((s, k) => s + k.sh, 0) + GAP_Y * Math.max(0, g.length - 1);
    root.tx = 0; root.ty = -root.h / 2; root.dir = 1;
    let y = -height(right) / 2;
    for (const k of right) { place(k, root.w + GAP_X, y, 1); y += k.sh + GAP_Y; }
    y = -height(left) / 2;
    for (const k of left) { place(k, -GAP_X, y, -1); y += k.sh + GAP_Y; }

    const vis = nodes.filter((n) => n.vis);
    const old = origin;
    origin = { x: Math.min(...vis.map((n) => n.tx)) - PAD, y: Math.min(...vis.map((n) => n.ty)) - PAD };
    const W = Math.max(...vis.map((n) => n.tx + n.w)) - origin.x + PAD, H = Math.max(...vis.map((n) => n.ty + n.h)) - origin.y + PAD;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Where each node starts and ends. A node that appears starts at its parent; one that goes ends at the
    // nearest ancestor that stays.
    const shownAt = (n) => { let a = n.parent; while (a && a.cx == null) a = a.parent; return a || root; };
    const stays = (n) => { let a = n.parent; while (a && !a.vis) a = a.parent; return a || root; };
    const moving = [];
    for (const n of nodes) {
      if (!n.vis && n.cx == null) continue;
      n.dir ??= n.parent?.dir ?? 1;
      if (n.cx == null || first) {
        const a = first ? root : shownAt(n), ax = first ? root.tx : a.cx ?? a.tx, ay = first ? root.ty : a.cy ?? a.ty;
        n.from = { x: ax + (n === root ? 0 : (a.w - n.w) / 2), y: ay + ((a.h || 0) - n.h) / 2, o: n === root ? 0 : 0 };
      } else n.from = { x: n.cx, y: n.cy, o: n.co };
      if (n.vis) n.to = { x: n.tx, y: n.ty, o: 1 };
      else { const a = stays(n); n.to = { x: a.tx + (a.w - n.w) / 2, y: a.ty + (a.h - n.h) / 2, o: 0 }; }
      n.delay = first && !still ? Math.min(n.depth, 4) * 70 : 0;
      moving.push(n);
    }
    if (!first) setZoom(zoom);
    // The map keeps still on screen while it grows or shrinks around what is there.
    const page = scroller();
    view.scrollLeft += (old.x - origin.x) * zoom;
    if (page && !first) page.scrollTop += (old.y - origin.y) * zoom;

    const DUR = still ? 0 : first ? 520 : 380, t0 = performance.now(), run = ++anim;
    box.dataset.moving = "";
    const frame = (now) => {
      if (run !== anim) return;
      let busy = false;
      for (const n of moving) {
        const p = DUR ? Math.min(1, Math.max(0, (now - t0 - n.delay) / DUR)) : 1, e = ease(p);
        if (p < 1) busy = true;
        n.cx = n.from.x + (n.to.x - n.from.x) * e; n.cy = n.from.y + (n.to.y - n.from.y) * e; n.co = n.from.o + (n.to.o - n.from.o) * e;
        n.el.style.transform = `translate(${n.cx - origin.x}px, ${n.cy - origin.y}px)`;
        n.el.style.opacity = n.co;
        n.el.dataset.dir = n.dir;
      }
      for (const n of moving) {
        if (!n.parent) continue;
        const a = n.parent, dir = n.dir;
        const [x1, y1] = a.depth ? anchor(a, a.cx - origin.x, a.cy - origin.y, true, dir) : [dir > 0 ? a.cx - origin.x + a.w : a.cx - origin.x, a.cy - origin.y + a.h / 2];
        const [x2, y2] = anchor(n, n.cx - origin.x, n.cy - origin.y, false, dir), mx = (x1 + x2) / 2;
        n.path.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        n.path.style.opacity = n.co;
      }
      if (busy) return requestAnimationFrame(frame);
      for (const n of moving) if (!n.vis) { n.el.hidden = true; n.path.removeAttribute("d"); n.cx = n.cy = null; }
      delete box.dataset.moving;
    };
    if (DUR) requestAnimationFrame(frame); else frame(t0);
    if (first && last?.z) {   // back where the reader left it
      setZoom(last.z);
      view.scrollLeft = ((last.x || 0) - origin.x) * zoom;   // x is in map units from the title, so a relayout keeps it
      if (page && last.y != null) page.scrollTop = last.y;
    } else if (first) { fitWidth(); view.scrollLeft = Math.max(0, (root.tx - origin.x + root.w / 2) * zoom - view.clientWidth / 2); }
    if (first) watchPage(page);
    remember();
  }

  // Saved a moment after the reader stops changing it. Only while this map is the one on screen, in the
  // document (full screen has its own scrolling, and is left where it was).
  let saveSoon = 0, pageY = last?.y ?? null;
  function remember() {
    if (id == null || !art.isConnected && !box.isConnected) return;   // replaced by another document
    // Read now (a document that has been replaced no longer knows where it was scrolled), written a moment later.
    const mapOn = art.classList.contains("mm-on");
    if (mapOn && laid && !box.classList.contains("full")) { const page = scroller(); if (page) pageY = Math.round(page.scrollTop); }
    const st = { on: mapOn };
    if (laid) {
      st.z = zoom; st.x = Math.round(view.scrollLeft / zoom + origin.x); if (pageY != null) st.y = pageY;
      const def = (n) => n.depth < 2 || total <= 120;
      st.open = nodes.filter((n) => n.fold && n.open && !def(n)).map((n) => n.key);
      st.shut = nodes.filter((n) => n.fold && !n.open && def(n)).map((n) => n.key);
    } else if (last) Object.assign(st, { z: last.z, x: last.x, y: last.y, open: last.open, shut: last.shut });
    clearTimeout(saveSoon);
    saveSoon = setTimeout(() => storeState(id, st), 250);
  }
  // The page scrolling up and down moves the map too: kept with it, until this document is replaced.
  function watchPage(page) {
    if (!page || page === document.scrollingElement) { if (page) addEventListener("scroll", onPage, { passive: true }); return; }
    page.addEventListener("scroll", onPage, { passive: true });
    function onPage() {
      if (!art.isConnected) { (page === document.scrollingElement ? window : page).removeEventListener("scroll", onPage); return; }
      if (art.classList.contains("mm-on") && !box.classList.contains("full")) remember();
    }
  }

  // Clicking a node lights up its branch (the way from the title, and everything under it) and dims the rest;
  // a node with children also folds or unfolds. Links inside a node still open as links.
  const lit = (n) => {
    focus = n;
    const on = new Set();
    if (n && n.depth) { for (let a = n; a; a = a.parent) on.add(a); const down = (x) => { on.add(x); x.kids.forEach(down); }; down(n); }
    box.classList.toggle("focus", on.size > 0);
    for (const x of nodes) { const yes = on.has(x); x.el.classList.toggle("lit", yes); x.el.classList.toggle("sel", x === n && on.size > 0); x.path.classList.toggle("lit", yes); }
  };
  // After a branch unfolds, the view slides so its new children are in sight.
  const reveal = (n) => setTimeout(() => {
    const far = n.kids.filter((k) => k.vis).reduce((m, k) => n.dir > 0 ? Math.max(m, k.tx + k.w) : Math.min(m, k.tx), n.dir > 0 ? n.tx + n.w : n.tx);
    const lo = (Math.min(n.tx, far) - origin.x) * zoom - 24, hi = (Math.max(n.tx + n.w, far) - origin.x) * zoom + 24;
    const left = view.scrollLeft, w = view.clientWidth;
    const to = hi - lo > w ? lo : hi > left + w ? hi - w : lo < left ? lo : left;
    if (to !== left) view.scrollTo({ left: to, behavior: still ? "auto" : "smooth" });
  }, still ? 0 : 200);
  const press = (n) => {
    if (n.fold) { n.open = !n.open; layout(); if (n.open) reveal(n); remember(); }
    lit(n === root || focus === n && !n.fold ? null : n);
  };
  canvas.addEventListener("click", (e) => {
    const node = e.target.closest(".mm-node");
    if (!node) { lit(null); return; }
    // A link to another note, clicked full screen: back into the document first, where the pane opens it.
    const link = e.target.closest("a[data-open]");
    if (link && box.classList.contains("full")) { e.preventDefault(); e.stopPropagation(); setFull(false); link.click(); return; }
    if (e.target.closest("a, input")) return;
    press(byEl.get(node));
  });
  canvas.addEventListener("keydown", (e) => {
    const node = e.target.closest?.(".mm-node");
    if (!node || e.target !== node || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); press(byEl.get(node));
  });
  view.addEventListener("click", (e) => { if (e.target === view || e.target === stage) lit(null); });
  view.addEventListener("scroll", () => { if (!box.classList.contains("full")) remember(); }, { passive: true });

  // Formula fonts (KaTeX) arrive after the first layout; once they are in, nodes are measured again so a
  // formula never spills over its neighbour.
  const settleFonts = () => document.fonts?.ready.then(() => { if (art.isConnected) layout(); });
  const on = (yes) => {
    art.classList.toggle("mm-on", yes);
    toggle.setAttribute("aria-pressed", String(yes));
    if (yes && !laid && view.clientWidth) { laid = true; layout(true); settleFonts(); }
    remember();
  };
  // Laid out once the map has a width (it is built off screen, and a cached document may be shown again later).
  new ResizeObserver(() => {
    if (!art.classList.contains("mm-on") || !view.clientWidth) return;
    if (!laid) { laid = true; layout(true); settleFonts(); }
    else if ((view.clientWidth < 560) !== narrow) { layout(); fitWidth(); }   // turned the phone, or resized the window
  }).observe(view);

  const smooth = (fn) => { canvas.classList.add("zooming"); fn(); setTimeout(() => canvas.classList.remove("zooming"), 260); };
  out.onclick = () => smooth(() => setZoom(zoom / 1.2, view.clientWidth / 2));
  inn.onclick = () => smooth(() => setZoom(zoom * 1.2, view.clientWidth / 2));
  fit.onclick = () => smooth(fitWidth);
  all.onclick = () => { nodes.forEach((n) => { n.open = true; }); layout(); };
  fold.onclick = () => { nodes.forEach((n) => { n.open = n.depth < 1; }); lit(null); layout(); };
  // ⌘/Ctrl + wheel (and a trackpad pinch) zooms around the pointer; a plain wheel scrolls the page as usual.
  view.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY / 300), e.clientX - view.getBoundingClientRect().left);
  }, { passive: false });
  // Dragging the empty space moves the map: sideways inside it, up and down with the page.
  view.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.pointerType === "touch" || e.target.closest(".mm-node, a, button")) return;
    const page = scroller();
    let x = e.clientX, y = e.clientY;
    view.setPointerCapture(e.pointerId); view.classList.add("dragging");
    const move = (ev) => { view.scrollLeft -= ev.clientX - x; page.scrollTop -= ev.clientY - y; x = ev.clientX; y = ev.clientY; };
    const up = () => { view.classList.remove("dragging"); view.removeEventListener("pointermove", move); };
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up, { once: true }); view.addEventListener("pointercancel", up, { once: true });
  });

  // Two fingers pinch to zoom around the point between them; one finger scrolls as usual (the browser's own
  // scrolling, with its momentum).
  const zoomAt = (z, cx, cy) => {
    const page = scroller(), r = stage.getBoundingClientRect(), before = zoom;
    const y = cy - r.top;
    setZoom(z, cx - view.getBoundingClientRect().left);
    page.scrollTop += y * (zoom / before - 1);
  };
  let pinch = null;
  const gap = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  view.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) pinch = { d: gap(e.touches), z: zoom };
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    zoomAt(pinch.z * gap(e.touches) / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  }, { passive: false });
  view.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
  // Double-tap (or double-click) the empty space: zoom in there, or back to fit when already close.
  view.addEventListener("dblclick", (e) => {
    if (e.target.closest(".mm-node")) return;
    smooth(() => zoomAt(zoom < .95 ? Math.min(1.2, zoom * 1.6) : (view.clientWidth - 2) / canvas.offsetWidth, e.clientX, e.clientY));
  });

  // Full screen: the map alone over the app, scrolling both ways, for a big map or a small screen.
  // It moves to <body> while full screen: inside the glass pane, position: fixed would fill only the pane.
  const spot = document.createComment("mind map");
  const setFull = (yes) => {
    if (yes && !spot.parentNode) { box.before(spot); document.body.append(box); }
    if (!yes && spot.parentNode) { spot.replaceWith(box); }
    box.classList.toggle("full", yes);
    full.title = yes ? t("退出全屏") : t("全屏查看"); full.setAttribute("aria-label", full.title);
    full.setAttribute("aria-pressed", String(yes));
    document.documentElement.classList.toggle("mm-locked", yes);
    requestAnimationFrame(() => { fitWidth(); view.scrollLeft = Math.max(0, (root.tx - origin.x + root.w / 2) * zoom - view.clientWidth / 2);
      if (yes) view.scrollTop = Math.max(0, (root.ty - origin.y + root.h / 2) * zoom - view.clientHeight / 2); });
  };
  full.onclick = () => { setFull(!box.classList.contains("full")); full.focus(); };
  box.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("full")) { e.stopPropagation(); setFull(false); } });

  const toggle = el("button", "md-mm-toggle");
  toggle.type = "button";
  toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2"/><path d="M10 8h2.5M3.5 8H6M9.4 6.6l2-2M6.6 9.4l-2 2M9.4 9.4l2 2M6.6 6.6l-2-2"/></svg>';
  toggle.append(el("span", null, t("思维导图")));
  toggle.title = t("以思维导图显示");
  toggle.onclick = () => on(!art.classList.contains("mm-on"));
  const head = art.querySelector(".md-head");
  const props = head.querySelector(".md-props");
  if (props) props.before(toggle); else head.append(toggle);
  on(last && typeof last.on === "boolean" ? last.on : !!mindmap);
}
