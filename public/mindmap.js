// A document shown as a mind map: its headings and list items as a tree, the title in the middle.
// Documents made with Obsidian's Enhancing Mindmap plugin (front matter "mindmap-plugin: basic", Joey's
// 思维导图 folder) open as a map; any other document with an outline can switch to one with the 导图 button.
// The tree is read from the rendered document, so links, [[wiki links]], formulas and highlights in a node
// work exactly as they do in the text.
import { t } from "./i18n.js";

const GAP_X = 46, GAP_Y = 10, PAD = 28, BRANCHES = 7;
// Which documents the reader switched, by file id: a redraw after an edit keeps the view they chose.
const chosen = new Map();
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

  const view = el("div", "mm-view"), stage = el("div", "mm-stage"), canvas = el("div", "mm-canvas");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mm-links"); svg.setAttribute("aria-hidden", "true");
  canvas.append(svg); stage.append(canvas); view.append(stage);
  const bar = el("div", "mm-bar");
  const btn = (cls, label, text) => { const b = el("button", "mm-btn " + cls, text); b.type = "button"; b.title = label; b.setAttribute("aria-label", label); bar.append(b); return b; };
  const out = btn("mm-out", t("缩小"), "−"), pct = el("span", "mm-pct", "100%"); bar.append(pct);
  const inn = btn("mm-in", t("放大"), "+"), fit = btn("mm-fit", t("适应宽度"), t("适应"));
  const all = btn("mm-all", t("全部展开"), t("展开")), fold = btn("mm-fold-all", t("收起到第一层"), t("折叠"));
  const box = el("section", "mm");
  box.append(bar, view);
  content.before(box);

  // Every node of the tree gets its element now; positions come when the map is on screen and can be measured.
  const nodes = [];
  const make = (n, depth, branch) => {
    n.depth = depth; n.branch = branch;
    n.el = el("div", "mm-node");
    n.el.dataset.depth = Math.min(depth, 3);
    if (depth) n.el.style.setProperty("--c", `var(--mm-c${branch % BRANCHES})`);
    const text = el("div", "mm-text"); text.innerHTML = n.html || "&nbsp;";
    n.el.append(text);
    if (n.kids.length && depth) {
      n.fold = el("button", "mm-fold"); n.fold.type = "button";
      n.fold.addEventListener("click", (e) => { e.stopPropagation(); n.open = !n.open; layout(); });
      n.el.append(n.fold);
    }
    // A big map opens two levels deep; the rest unfolds a branch at a time.
    n.open = depth < 2 || total <= 120;
    canvas.append(n.el); nodes.push(n);
    n.kids.forEach((k, i) => make(k, depth + 1, depth ? branch : i));
  };
  make(root, 0, 0);

  let zoom = 1, laid = false;
  const setZoom = (z, keep) => {
    const before = zoom;
    zoom = Math.min(2, Math.max(.3, Math.round(z * 100) / 100));
    pct.textContent = Math.round(zoom * 100) + "%";
    canvas.style.transform = `scale(${zoom})`;
    stage.style.width = canvas.offsetWidth * zoom + "px"; stage.style.height = canvas.offsetHeight * zoom + "px";
    if (keep) view.scrollLeft = (view.scrollLeft + keep) * zoom / before - keep;
  };
  const fitWidth = () => setZoom(Math.min(1, Math.max(.5, (view.clientWidth - 2) / canvas.offsetWidth)));
  function layout() {
    const shown = (n) => n.open || !n.depth ? n.kids : [];
    // Sizes first (every visible node), then how tall each subtree is, then positions from the root out.
    const visit = (n, vis) => {
      n.el.hidden = !vis;
      for (const k of n.kids) visit(k, vis && (n.open || !n.depth));
      if (!vis) return;
      n.w = n.el.offsetWidth; n.h = n.el.offsetHeight;
      if (n.fold) { n.fold.textContent = n.open ? "" : String(count(n)); n.fold.setAttribute("aria-label", n.open ? t("折叠") : t("展开")); n.el.classList.toggle("closed", !n.open); }
    };
    visit(root, true);
    const span = (n) => {
      const ks = shown(n);
      n.kh = ks.length ? ks.reduce((s, k) => s + span(k), 0) + GAP_Y * (ks.length - 1) : 0;
      return n.sh = Math.max(n.h, n.kh);
    };
    const place = (n, x, top, dir) => {
      n.dir = dir; n.x = dir > 0 ? x : x - n.w; n.y = top + (n.sh - n.h) / 2;
      let y = top + (n.sh - n.kh) / 2;
      for (const k of shown(n)) { place(k, dir > 0 ? n.x + n.w + GAP_X : n.x - GAP_X, y, dir); y += k.sh + GAP_Y; }
    };
    // The first level splits between the right and left of the title, about half the height each side.
    const ks = root.kids;
    ks.forEach(span);
    const totalH = ks.reduce((s, k) => s + k.sh, 0);
    let cut = ks.length;
    if (ks.length >= 4) { let acc = 0; cut = 0; while (cut < ks.length && acc + ks[cut].sh / 2 < totalH / 2) acc += ks[cut++].sh; cut = Math.max(1, cut); }
    const right = ks.slice(0, cut), left = ks.slice(cut);
    const height = (g) => g.reduce((s, k) => s + k.sh, 0) + GAP_Y * Math.max(0, g.length - 1);
    root.x = 0; root.y = -root.h / 2; root.dir = 1;
    let y = -height(right) / 2;
    for (const k of right) { place(k, root.w + GAP_X, y, 1); y += k.sh + GAP_Y; }
    y = -height(left) / 2;
    for (const k of left) { place(k, -GAP_X, y, -1); y += k.sh + GAP_Y; }

    const vis = nodes.filter((n) => !n.el.hidden);
    const minX = Math.min(...vis.map((n) => n.x)) - PAD, minY = Math.min(...vis.map((n) => n.y)) - PAD;
    const W = Math.max(...vis.map((n) => n.x + n.w)) - minX + PAD, H = Math.max(...vis.map((n) => n.y + n.h)) - minY + PAD;
    for (const n of vis) { n.x -= minX; n.y -= minY; n.el.style.transform = `translate(${n.x}px, ${n.y}px)`; n.el.dataset.dir = n.dir; }
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    // Boxes (the title, the first level) join at their middle; deeper nodes sit on a line and join at it.
    const anchor = (n, outward) => {
      const y = n.depth >= 2 ? n.y + n.h : n.y + n.h / 2;
      return [outward ? (n.dir > 0 ? n.x + n.w : n.x) : (n.dir > 0 ? n.x : n.x + n.w), y];
    };
    const paths = [];
    for (const n of vis) for (const k of shown(n)) {
      if (k.el.hidden) continue;
      const [x1, y1] = n.depth ? anchor(n, true) : [k.dir > 0 ? n.x + n.w : n.x, n.y + n.h / 2];
      const [x2, y2] = anchor(k, false), mx = (x1 + x2) / 2;
      paths.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" style="stroke:var(--mm-c${k.branch % BRANCHES})"/>`);
    }
    svg.innerHTML = paths.join("");
    if (!laid) { laid = true; fitWidth(); view.scrollLeft = Math.max(0, (root.x + root.w / 2) * zoom - view.clientWidth / 2); }
    else setZoom(zoom);
  }

  const on = (yes) => {
    art.classList.toggle("mm-on", yes);
    toggle.setAttribute("aria-pressed", String(yes));
    if (yes && !laid && view.clientWidth) layout();
  };
  // Laid out once the map has a width (it is built off screen, and a cached document may be shown again later).
  new ResizeObserver(() => { if (art.classList.contains("mm-on") && view.clientWidth && !laid) layout(); }).observe(view);

  out.onclick = () => setZoom(zoom / 1.2, view.clientWidth / 2);
  inn.onclick = () => setZoom(zoom * 1.2, view.clientWidth / 2);
  fit.onclick = () => fitWidth();
  all.onclick = () => { nodes.forEach((n) => { n.open = true; }); layout(); };
  fold.onclick = () => { nodes.forEach((n) => { n.open = n.depth < 1; }); layout(); };
  // ⌘/Ctrl + wheel (and a trackpad pinch) zooms around the pointer; a plain wheel scrolls the page as usual.
  view.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY / 300), e.clientX - view.getBoundingClientRect().left);
  }, { passive: false });
  // Dragging the empty space moves the map: sideways inside it, up and down with the page.
  view.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.pointerType === "touch" || e.target.closest(".mm-node, a, button")) return;
    const page = view.closest(".preview") || document.scrollingElement;
    let x = e.clientX, y = e.clientY;
    view.setPointerCapture(e.pointerId); view.classList.add("dragging");
    const move = (ev) => { view.scrollLeft -= ev.clientX - x; page.scrollTop -= ev.clientY - y; x = ev.clientX; y = ev.clientY; };
    const up = () => { view.classList.remove("dragging"); view.removeEventListener("pointermove", move); };
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up, { once: true }); view.addEventListener("pointercancel", up, { once: true });
  });

  const toggle = el("button", "md-mm-toggle");
  toggle.type = "button";
  toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2"/><path d="M10 8h2.5M3.5 8H6M9.4 6.6l2-2M6.6 9.4l-2 2M9.4 9.4l2 2M6.6 6.6l-2-2"/></svg>';
  toggle.append(el("span", null, t("思维导图")));
  toggle.title = t("以思维导图显示");
  toggle.onclick = () => { const yes = !art.classList.contains("mm-on"); chosen.set(id, yes); on(yes); };
  const head = art.querySelector(".md-head");
  const props = head.querySelector(".md-props");
  if (props) props.before(toggle); else head.append(toggle);
  on(chosen.has(id) ? chosen.get(id) : !!mindmap);
}
