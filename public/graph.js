// Relationship graph, Obsidian-style, in 3D. Nodes are notes and Markdown files (and optionally tags), edges
// are [[links]]. A small force simulation lays them out in space and a perspective camera draws them on a 2D
// canvas: drag the background to orbit (or to pan in flat mode), shift- or right-drag to pan, scroll or pinch
// to zoom, drag a node to move it, hover or click to light up its neighbours, click again to open it. Flat mode squashes the
// z axis and turns the camera face-on, which gives the old 2D graph back.
//
// Each note node has a group (its category); every group gets its own colour, listed in a legend in the
// corner. Clicking a legend entry lights that group up and dims the rest; its checkbox shows or hides the
// group, and "only" hides every other group. Hidden groups leave the layout, which re-settles without them.
//
//   const g = mountGraph(host, { nodes: [{label, kind, ref, group}], edges: [[i, j]] }, { onOpen(node), isActive(node), flat })
//   g.redraw()       after the active set changes
//   g.setFlat(bool)  switch between 3D and flat, animated
//   g.toggleForces() open or close the settings panel (display options and force sliders, like Obsidian's)
//
// Also in the pane: a search box (top left) that lights up matching notes (Enter opens the first), a local
// graph mode (only the open notes and what lies within 1–3 links of them) and node size by links or by length
// (node.len, in characters). Those view settings are kept per device as "suiji:graphView".
//   g.destroy()      before the host is thrown away
import { t } from "./i18n.js";

// Categorical colours, readable on light and dark backgrounds. A style can swap them with --g-palette.
const PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7", "#9c755f", "#5fa8d3"];

// Force settings: multipliers on the defaults (centre, repel, link) and the link length in px.
export const FORCE_DEFAULTS = { center: 1, repel: 1, link: 1, dist: 60 };
const FORCE_SLIDERS = [
  ["center", "向心力", 0, 3, 0.05],
  ["repel", "排斥力", 0, 3, 0.05],
  ["link", "连线力", 0, 3, 0.05],
  ["dist", "连线距离", 20, 250, 1],
];

export function mountGraph(host, data, { onOpen, isActive, flat = false, hidden = [], onHide, forces = {}, onForces, options = [], prev = null }) {
  const canvas = document.createElement("canvas");
  canvas.className = "graph-canvas";
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const N = data.nodes.map((n, i) => ({ ...n, i, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, deg: 0, nb: new Set(), fixed: false, sx: 0, sy: 0, s: 1, d: 0 }));
  const E = data.edges.filter(([a, b]) => a !== b);
  for (const [a, b] of E) { N[a].deg++; N[b].deg++; N[a].nb.add(b); N[b].nb.add(a); }
  // Seed on a golden-angle spiral (a ball of them in 3D) so the first frames already look tidy.
  N.forEach((n, i) => {
    const t = i * 2.39996;
    if (flat) { const r = 14 * Math.sqrt(i + 0.5); n.x = r * Math.cos(t); n.y = r * Math.sin(t); return; }
    const r = 22 * Math.cbrt(i + 0.5), u = 1 - 2 * ((i + 0.5) / N.length), w = Math.sqrt(1 - u * u);
    n.x = r * w * Math.cos(t); n.y = r * u; n.z = r * w * Math.sin(t);
  });
  // Notes the user dragged stay where they were put, per device: "suiji:graphPins" maps kind:ref to [x, y, z].
  const pinKey = (n) => n.kind + ":" + n.ref;
  let pins = {};
  try { pins = JSON.parse(localStorage.getItem("suiji:graphPins")) || {}; } catch {}
  const savePins = () => { try { localStorage.setItem("suiji:graphPins", JSON.stringify(pins)); } catch {} };
  for (const n of N) {
    const at = pins[pinKey(n)];
    if (Array.isArray(at) && at.length === 3 && at.every(Number.isFinite)) { n.pin = at; [n.x, n.y, n.z] = [at[0], at[1], flat ? 0 : at[2]]; }
  }
  // The same pane's graph before a rebuild (prev, from api.state()): notes start where they were.
  let carried = 0;
  if (prev?.pos) for (const n of N) {
    const at = prev.pos.get(pinKey(n));
    if (at && !n.pin) { [n.x, n.y, n.z] = [at[0], at[1], flat ? 0 : at[2]]; carried++; }
    else if (n.pin) carried++;
  }
  const AXIS = { x: "#e5484d", y: "#30a46c", z: "#3e63dd" };
  // Size grows with links but is capped, so one hub note does not cover its neighbours.
  const S = { local: false, depth: 1, size: "links", spin: false, arrows: false, orphans: true };
  try { Object.assign(S, JSON.parse(localStorage.getItem("suiji:graphView")) || {}); } catch {}
  const saveS = () => { try { localStorage.setItem("suiji:graphView", JSON.stringify(S)); } catch {} };
  const maxLen = Math.max(1, ...N.map((n) => n.len || 0));
  // A little larger in 3D, where perspective shrinks the far half.
  const radius = (n) => (flat ? 1 : 1.15) * (n.kind === "tag" ? 2.5 + Math.min(Math.sqrt(n.deg), 6) * 0.6
    : S.size === "len" ? 2 + 9 * Math.sqrt((n.len || 0) / maxLen)
    : 2.5 + Math.min(Math.sqrt(n.deg), 9) * 0.9);
  const edgeAlpha = E.length > 400 ? 0.16 : 0.35;

  // Groups, biggest first: each of the first ten gets a palette colour, the rest share the plain node colour.
  const sizes = new Map();
  for (const n of N) if (n.kind !== "tag" && n.group) sizes.set(n.group, (sizes.get(n.group) || 0) + 1);
  const groups = [...sizes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  const slot = new Map(groups.slice(0, PALETTE.length).map(([g], i) => [g, i]));
  for (const n of N) n.slot = slot.has(n.group) ? slot.get(n.group) : -1;
  let palette = PALETTE;

  // Colour groups of the user's own (like Obsidian's): a query and a colour; the first group a note matches
  // colours it, over its category. "#tag" matches a tag, "path:folder" a folder, anything else the name or path.
  // Kept per device as "suiji:graphColors".
  let CG = [];
  try { CG = (JSON.parse(localStorage.getItem("suiji:graphColors")) || []).filter((g) => g && typeof g.q === "string" && typeof g.c === "string"); } catch {}
  const saveCG = () => { try { localStorage.setItem("suiji:graphColors", JSON.stringify(CG)); } catch {} };
  function matches(n, q) {
    q = q.trim().toLowerCase();
    if (!q || n.kind === "tag") return false;
    if (q.startsWith("#")) { const tag = q.slice(1); return !!tag && (n.tags || []).some((x) => String(x).toLowerCase() === tag || String(x).toLowerCase().startsWith(tag + "/")); }
    if (q.startsWith("path:")) return (n.path || "").toLowerCase().includes(q.slice(5).trim());
    return n.label.toLowerCase().includes(q) || (n.path || "").toLowerCase().includes(q);
  }
  const recolour = () => { for (const n of N) n.cg = CG.findIndex((g) => matches(n, g.q)); };
  recolour();

  // Legend: one row per coloured group (plus "other"). Click the name to light that group up (again to
  // clear); the checkbox shows or hides it; "only" hides all the others.
  const OTHER = "\u0000other";
  const keyOf = (n) => n.slot < 0 ? OTHER : n.group;
  const off = new Set(hidden);
  let legendPick = null;
  const legend = document.createElement("div");
  legend.className = "graph-legend";
  const rows = groups.slice(0, PALETTE.length).map(([g, c]) => ({ g, key: g, c }));
  const rest = groups.slice(PALETTE.length).reduce((a, [, c]) => a + c, 0);
  if (rest) rows.push({ g: null, key: OTHER, c: rest });
  const allBtn = Object.assign(document.createElement("button"), { type: "button", className: "graph-legend-all" });
  // Only categories that exist count: a hidden one whose folder has since gone would otherwise keep the
  // button on "show all" with everything showing.
  const anyOff = () => rows.some((r) => off.has(r.key));
  allBtn.onclick = () => { if (anyOff()) off.clear(); else for (const r of rows) off.add(r.key); setHidden(); };
  const legendHead = document.createElement("div");
  legendHead.className = "graph-legend-head";
  const fold = Object.assign(document.createElement("button"), { type: "button", className: "graph-legend-fold" });
  fold.innerHTML = `<span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
  fold.querySelector("span").textContent = t("分类");
  let folded = null;
  try { folded = localStorage.getItem("suiji:graphLegend"); } catch {}
  const setFold = (on, save) => {
    legend.classList.toggle("folded", on); fold.setAttribute("aria-expanded", !on);
    if (save) try { localStorage.setItem("suiji:graphLegend", on ? "1" : "0"); } catch {}
  };
  fold.onclick = () => setFold(!legend.classList.contains("folded"), true);
  legendHead.append(fold, allBtn);
  legend.append(legendHead);
  const syncLegend = () => {
    for (const r of rows) { r.el.classList.toggle("on", r === legendPick); r.el.classList.toggle("off", off.has(r.key)); r.box.setAttribute("aria-checked", !off.has(r.key)); }
    allBtn.textContent = anyOff() ? t("全部显示") : t("全部隐藏");
  };
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "graph-legend-row";
    row.innerHTML = `<button type="button" role="checkbox" class="box"><i></i></button><button type="button" class="name"><span></span><em></em></button><button type="button" class="only"></button>`;
    const name = r.g ?? t("其他");
    r.el = row; r.box = row.querySelector(".box");
    r.box.title = t("显示 / 隐藏"); r.box.setAttribute("aria-label", name);
    row.querySelector("span").textContent = name;
    row.querySelector("em").textContent = r.c;
    row.querySelector(".name").title = t("高亮这一类");
    const only = row.querySelector(".only");
    only.textContent = t("只看"); only.title = t("只显示这一类");
    r.box.onclick = () => { off.has(r.key) ? off.delete(r.key) : off.add(r.key); setHidden(); };
    only.onclick = () => { off.clear(); for (const x of rows) if (x !== r) off.add(x.key); setHidden(); };
    row.querySelector(".name").onclick = () => {
      if (legendPick === r) { api.fit(); return; }
      if (off.has(r.key)) { off.delete(r.key); setHidden(); }
      api.focus((n) => keyOf(n) === r.key && n.kind !== "tag");
      legendPick = r; syncLegend();
    };
    legend.append(row);
  }
  // The user's colour groups head the legend: click one to light its notes up.
  const cgList = document.createElement("div");
  legendHead.after(cgList);
  function syncCGLegend() {
    cgList.replaceChildren();
    CG.forEach((g, gi) => {
      if (!g.q.trim()) return;
      const row = document.createElement("div");
      row.className = "graph-legend-row";
      row.innerHTML = `<span class="box"><i></i></span><button type="button" class="name"><span></span><em></em></button>`;
      row.querySelector("i").style.background = g.c;
      row.querySelector(".name span").textContent = g.q.trim();
      row.querySelector("em").textContent = N.filter((n) => n.cg === gi).length;
      row.querySelector(".name").onclick = () => api.focus((n) => n.cg === gi);
      cgList.append(row);
    });
    legend.classList.toggle("has-cg", cgList.childElementCount > 0);
    if ((rows.length > 1 || cgList.childElementCount) && !legend.isConnected) host.append(legend);
  }

  // Which nodes and links are in play: those of shown groups, and tags still linked to one of them.
  let shown = N, shownE = E, localKey = "";
  function applyHidden() {
    for (const n of N) n.hidden = n.kind !== "tag" && off.has(keyOf(n));
    // Orphans switched off: notes without a single link to another note.
    if (!S.orphans) for (const n of N) if (n.kind !== "tag" && ![...n.nb].some((j) => N[j].kind !== "tag")) n.hidden = true;
    for (const n of N) if (n.kind === "tag") n.hidden = ![...n.nb].some((j) => N[j].kind !== "tag" && !N[j].hidden);
    // Local graph: walk out from the open notes, S.depth links deep; everything farther is left out.
    const centres = S.local ? N.filter((n) => !n.hidden && isActive(n)) : [];
    localKey = centres.map((n) => n.i).join(",");
    if (centres.length) {
      const seen = new Set(centres.map((n) => n.i));
      let ring = [...seen];
      for (let d = 0; d < S.depth; d++) {
        const next = [];
        for (const i of ring) for (const j of N[i].nb) if (!seen.has(j) && !N[j].hidden) { seen.add(j); next.push(j); }
        ring = next;
      }
      for (const n of N) if (!seen.has(n.i)) n.hidden = true;
    }
    shown = N.filter((n) => !n.hidden);
    shownE = E.filter(([a, b]) => !N[a].hidden && !N[b].hidden);
    if (hover?.hidden) hover = null;
    if (chosen?.hidden) chosen = null;
  }
  // The shown set changed shape: let the layout re-settle and the view re-frame it.
  function relayout() { applyHidden(); picked = null; alpha = Math.max(alpha, 0.6); userMoved = false; fitPending = true; kick(); }
  function setHidden() {
    applyHidden();
    if (legendPick && off.has(legendPick.key)) legendPick = null;
    picked = legendPick ? picked : null;
    syncLegend();
    onHide?.([...off]);
    alpha = Math.max(alpha, 0.6); userMoved = false; fitPending = true; kick();
  }
  syncCGLegend();
  if (rows.length > 1 || cgList.childElementCount) {
    if (!legend.isConnected) host.append(legend);
    // Folded by default where it would cover much of a small pane (phones); then as the user left it.
    setFold(folded === null ? host.getBoundingClientRect().width < 560 || matchMedia("(max-width: 700px)").matches : folded === "1", false);
  }

  let W = 0, H = 0, dpr = 1, raf = 0, alpha = 1;
  // view: screen pan (x, y) and zoom (k). cam: orbit angles; spread: how far out the layout reaches (for perspective and fog).
  // view.k is the zoom; panning moves the camera's turning point (cam.cx/cy/cz) instead of the picture, so
  // a drag always turns the graph around the middle of the pane. fitPending: frame the graph once more.
  let view = { x: 0, y: 0, k: 1 }, userMoved = false, fitPending = true, hover = null;
  let shownLabels = new Set(), labelsEasing = false, onScreen = true;
  // A clicked note stays lit with its links; clicking it again opens it, clicking the background lets go.
  let chosen = null;
  // Orbit angles, and the point the camera turns around (eased toward a clicked note so it comes into focus).
  const cam = { yaw: flat ? 0 : 0.5, pitch: flat ? 0 : 0.38, cx: 0, cy: 0, cz: 0 };
  let spread = 200, touchedAt = 0;
  // Nodes picked from outside (the assistant): they and their neighbours stay lit and the view frames them.
  let picked = null;   // { core: Set of node indices, near: core plus neighbours }
  applyHidden(); syncLegend();
  const warm = prev && N.length && carried / N.length > 0.8;   // nearly all known: only a nudge to settle the newcomers
  if (warm) alpha = 0.3;

  // The camera is kept per device ("suiji:graphCam"), so the graph opens turned and zoomed the way it was
  // left. Only a view the user moved by hand is put back exactly; otherwise just the angle, and it frames itself.
  try {
    const sv = JSON.parse(localStorage.getItem("suiji:graphCam"));
    if (sv && !!sv.flat === flat && [sv.yaw, sv.pitch, sv.k, ...(sv.c || [])].every(Number.isFinite)) {
      if (!flat) { cam.yaw = sv.yaw; cam.pitch = sv.pitch; }
      if (sv.manual && sv.c?.length === 3) { view.k = sv.k; [cam.cx, cam.cy, cam.cz] = sv.c; userMoved = true; fitPending = false; }
    }
  } catch {}
  if (warm && prev.flat === flat) {   // a rebuild keeps the view exactly, whether the user moved it or not
    view.k = prev.k; [cam.cx, cam.cy, cam.cz] = prev.c; cam.yaw = prev.yaw; cam.pitch = prev.pitch;
    spread = prev.spread; userMoved = prev.userMoved; fitPending = !userMoved;
    chosen = prev.chosen ? N.find((n) => pinKey(n) === prev.chosen) || null : null;
  }
  let camSaved = "", camTimer = 0;
  function saveCam() {
    const r = (v) => Math.round(v * 1000) / 1000;
    const sv = JSON.stringify({ flat, yaw: r(cam.yaw), pitch: r(cam.pitch), k: r(view.k), c: [r(cam.cx), r(cam.cy), r(cam.cz)], manual: userMoved });
    if (sv === camSaved) return;
    camSaved = sv;
    clearTimeout(camTimer);
    camTimer = setTimeout(() => { try { localStorage.setItem("suiji:graphCam", sv); } catch {} }, 400);
  }

  // ---------- search ----------
  // Lights up the notes whose name contains the text and frames them; Enter opens the first, Esc clears.
  const search = Object.assign(document.createElement("input"), { type: "search", className: "graph-search", placeholder: t("搜索节点"), spellcheck: false });
  search.setAttribute("aria-label", t("搜索节点"));
  let hits = [];
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { hits = []; api.fit(); return; }
    hits = shown.filter((n) => n.label.toLowerCase().includes(q)).sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1) || b.deg - a.deg);
    const set = new Set(hits);
    api.focus((n) => set.has(n));
    search.classList.toggle("none", !hits.length);
  };
  search.onkeydown = (e) => {
    if (e.key === "Enter" && hits[0]) { e.preventDefault(); onOpen(hits[0]); }
    else if (e.key === "Escape") { search.value = ""; search.oninput(); search.blur(); }
  };
  if (N.length) host.append(search);

  // ---------- forces panel ----------
  const F = { ...FORCE_DEFAULTS };
  for (const k in F) if (Number.isFinite(forces[k])) F[k] = forces[k];
  const panel = document.createElement("div");
  panel.className = "graph-forces";
  panel.hidden = true;
  const head = document.createElement("div");
  head.className = "graph-forces-head";
  head.innerHTML = `<b></b><button type="button" class="ghost small"></button>`;
  head.querySelector("b").textContent = t("力度");
  const reset = head.querySelector("button");
  reset.textContent = t("重置");
  // Display: the app's switches (show tag nodes…), the local graph and node size, above the forces.
  const sec = document.createElement("div");
  sec.className = "graph-forces-head";
  sec.innerHTML = "<b></b>";
  sec.querySelector("b").textContent = t("显示");
  panel.append(sec);
  const sw = (label, checked, change) => {
    const row = document.createElement("label");
    row.className = "graph-switch";
    row.innerHTML = `<span></span><input type="checkbox" role="switch">`;
    row.querySelector("span").textContent = label;
    const box = row.querySelector("input");
    box.checked = !!checked;
    box.onchange = () => change(box.checked);
    panel.append(row);
    return row;
  };
  for (const o of options) sw(o.label, o.checked, o.onChange);
  const localRow = sw(t("局部图谱"), S.local, (on) => { S.local = on; saveS(); depthRow.hidden = !on; relayout(); });
  localRow.title = t("只显示其他窗格里打开的笔记，以及离它几步之内的笔记");
  const depthRow = document.createElement("label");
  depthRow.innerHTML = `<span></span><output></output><input type="range" min="1" max="3" step="1">`;
  depthRow.querySelector("span").textContent = t("深度");
  const depthIn = Object.assign(depthRow.querySelector("input"), { value: S.depth });
  const depthOut = depthRow.querySelector("output");
  depthOut.textContent = S.depth;
  depthIn.oninput = () => { S.depth = +depthIn.value; depthOut.textContent = S.depth; saveS(); relayout(); };
  depthRow.hidden = !S.local;
  panel.append(depthRow);
  const sizeRow = document.createElement("div");
  sizeRow.className = "graph-seg-row";
  sizeRow.innerHTML = `<span></span><div class="graph-seg" role="radiogroup"></div>`;
  sizeRow.querySelector("span").textContent = t("节点大小");
  for (const [v, label] of [["links", t("链接数")], ["len", t("篇幅")]]) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", S.size === v);
    b.onclick = () => {
      S.size = v; saveS();
      for (const x of sizeRow.querySelectorAll("button")) x.setAttribute("aria-checked", x === b);
      kick();
    };
    sizeRow.querySelector(".graph-seg").append(b);
  }
  panel.append(sizeRow);
  sw(t("自动旋转"), S.spin, (on) => { S.spin = on; saveS(); kick(); });
  sw(t("箭头"), S.arrows, (on) => { S.arrows = on; saveS(); kick(); }).title = t("在连线上画箭头，指向被链接的笔记");
  sw(t("孤立笔记"), S.orphans, (on) => { S.orphans = on; saveS(); relayout(); }).title = t("显示没有任何链接的笔记");

  // Colour groups: one row each (colour, query, remove), and a button for a new one.
  const cgHead = document.createElement("div");
  cgHead.className = "graph-forces-head gap";
  cgHead.innerHTML = `<b></b><button type="button" class="ghost small"></button>`;
  cgHead.querySelector("b").textContent = t("颜色组");
  const cgAdd = cgHead.querySelector("button");
  cgAdd.textContent = t("新建");
  const cgBox = document.createElement("div");
  cgBox.className = "graph-cg";
  panel.append(cgHead, cgBox);
  const cgChanged = () => { saveCG(); recolour(); syncCGLegend(); kick(); };
  function cgRender() {
    cgBox.replaceChildren();
    if (!CG.length) {
      const p = document.createElement("p");
      p.className = "graph-cg-empty"; p.textContent = t("用标签、文件夹或名字给笔记上色");
      cgBox.append(p);
    }
    CG.forEach((g) => {
      const row = document.createElement("div");
      row.className = "graph-cg-row";
      row.innerHTML = `<input type="color"><input type="text" spellcheck="false"><button type="button" class="ghost small">×</button>`;
      const [col, q] = row.querySelectorAll("input");
      col.value = g.c; q.value = g.q; q.placeholder = t("#标签、path:文件夹 或名字");
      col.setAttribute("aria-label", t("颜色")); q.setAttribute("aria-label", t("颜色组"));
      col.oninput = () => { g.c = col.value; cgChanged(); };
      q.oninput = () => { g.q = q.value; cgChanged(); };
      row.querySelector("button").onclick = () => { CG.splice(CG.indexOf(g), 1); cgChanged(); cgRender(); };
      row.querySelector("button").title = t("删除");
      cgBox.append(row);
    });
  }
  cgAdd.onclick = () => {
    const used = new Set(CG.map((g) => g.c));
    const c = ["#d6409f", "#0090ff", "#f76b15", "#12a594", "#8e4ec6", "#ffc53d", "#30a46c", "#e5484d"].find((x) => !used.has(x)) || "#d6409f";
    CG.push({ q: "", c }); cgChanged(); cgRender();
    cgBox.querySelector(".graph-cg-row:last-child input[type=text]")?.focus();
  };
  cgRender();
  head.classList.add("gap");
  panel.append(head);
  const inputs = {};
  for (const [key, label, min, max, step] of FORCE_SLIDERS) {
    const row = document.createElement("label");
    row.innerHTML = `<span></span><output></output><input type="range">`;
    row.querySelector("span").textContent = t(label);
    const input = Object.assign(row.querySelector("input"), { min, max, step, value: F[key] });
    const out = row.querySelector("output");
    const show = () => { out.textContent = key === "dist" ? Math.round(F[key]) : F[key].toFixed(2); };
    show();
    input.oninput = () => { F[key] = +input.value; show(); reheat(); };
    input.onchange = () => onForces?.({ ...F });
    inputs[key] = { input, show };
    panel.append(row);
  }
  const unpinAll = Object.assign(document.createElement("button"), { type: "button", className: "ghost small graph-unpin", textContent: t("清除拖动过的位置") });
  unpinAll.onclick = () => { pins = {}; savePins(); for (const n of N) n.pin = null; alpha = Math.max(alpha, 0.6); kick(); };
  reset.onclick = () => {
    Object.assign(F, FORCE_DEFAULTS);
    for (const k in inputs) { inputs[k].input.value = F[k]; inputs[k].show(); }
    onForces?.({ ...F }); reheat();
  };
  panel.append(unpinAll);
  host.append(panel);
  // Settle again after a slider moves, and let the view re-frame the new shape.
  const reheat = () => { alpha = Math.max(alpha, 0.5); userMoved = false; fitPending = true; kick(); };

  // ---------- simulation ----------
  function tick() {
    const V = shown, n = V.length;
    for (let i = 0; i < n; i++) {
      const a = V[i];
      for (let j = i + 1; j < n; j++) {
        const b = V[j];
        let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 160000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = flat ? 0 : Math.random() - 0.5; d2 = 1; }
        const f = (130 * F.repel * alpha) / d2;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f; b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
    }
    for (const [ia, ib] of shownE) {
      const a = N[ia], b = N[ib];
      // Clamp the distance: two linked nodes almost on top of each other would otherwise get a huge kick.
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.max(Math.hypot(dx, dy, dz), 4);
      const s = ((d - F.dist) / d) * alpha * 0.5 * F.link / Math.min(a.deg, b.deg);
      a.vx += dx * s; a.vy += dy * s; a.vz += dz * s; b.vx -= dx * s; b.vy -= dy * s; b.vz -= dz * s;
    }
    let far = 0;
    for (const p of shown) {
      const c = 0.012 * F.center * alpha;
      p.vx -= p.x * c; p.vy -= p.y * c; p.vz -= p.z * c;
      // A pinned note still counts toward how far the layout reaches: the camera stands back by that much, and
      // a note dragged out past it would end up behind the camera, drawn huge or upside down.
      if (p.pin && !p.fixed) { p.x = p.pin[0]; p.y = p.pin[1]; p.z = flat ? 0 : p.pin[2]; p.vx = p.vy = p.vz = 0; far = Math.max(far, Math.hypot(p.x, p.y, p.z)); continue; }
      if (flat) { p.vz = 0; p.z *= 0.8; if (Math.abs(p.z) < 0.05) p.z = 0; }
      if (p.fixed) { p.vx = p.vy = p.vz = 0; far = Math.max(far, Math.hypot(p.x, p.y, p.z)); continue; }
      p.vx *= 0.6; p.vy *= 0.6; p.vz *= 0.6;
      const v = Math.hypot(p.vx, p.vy, p.vz);
      if (v > 30) { p.vx *= 30 / v; p.vy *= 30 / v; p.vz *= 30 / v; }
      if (!Number.isFinite(p.x + p.vx + p.y + p.vy + p.z + p.vz)) { p.vx = p.vy = p.vz = 0; p.x = Math.random() * 10; p.y = Math.random() * 10; p.z = 0; }
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      far = Math.max(far, Math.hypot(p.x, p.y, p.z));
    }
    spread += (Math.max(far, 120) - spread) * 0.1;
    alpha *= 0.985;
  }

  // ---------- camera ----------
  // Rotates by yaw (around y) then pitch (around x); depth d grows away from the viewer. The camera sits
  // `focal` in front of the origin, far enough that the whole layout stays in front of it.
  const focal = () => spread * 1.7;
  // Any world point to [screen x, screen y, depth, scale] (screen relative to the pane centre, before zoom).
  function proj(x, y, z) {
    x -= cam.cx; y -= cam.cy; z -= cam.cz;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), F = focal();
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp, d = y * sp + z1 * cp, s = F / Math.max(F + d, F * 0.1);
    return [x1 * s, y2 * s, d, s];
  }
  function project() {
    for (const p of N) [p.sx, p.sy, p.d, p.s] = proj(p.x, p.y, p.z);
  }
  // The world point under screen point pt at depth d (used to drag a node across the screen).
  function unproject([px, py], d) {
    const F = focal(), s = F / Math.max(F + d, F * 0.1);
    const x1 = (px - W / 2 - view.x) / view.k / s, y2 = (py - H / 2 - view.y) / view.k / s;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y = y2 * cp + d * sp, z1 = -y2 * sp + d * cp;
    return [x1 * cy - z1 * sy + cam.cx, y + cam.cy, x1 * sy + z1 * cy + cam.cz];
  }
  // A shift on screen (pre-zoom units, at the turning point's depth) as a shift in the world.
  function unrotate(x1, y2) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y = y2 * cp, z1 = -y2 * sp;
    return [x1 * cy - z1 * sy, y, x1 * sy + z1 * cy];
  }
  // Move the picture by (dx, dy) screen px: the turning point moves the other way.
  function panBy(dx, dy) {
    const [x, y, z] = unrotate(-dx / view.k, -dy / view.k);
    cam.cx += x; cam.cy += y; cam.cz += z;
  }
  // Zoom to k keeping the point under screen pt where it is.
  function zoomAt(pt, k) {
    const ux = (pt[0] - W / 2) / view.k, uy = (pt[1] - H / 2) / view.k;
    const f = 1 - view.k / k;
    const [x, y, z] = unrotate(ux * f, uy * f);
    cam.cx += x; cam.cy += y; cam.cz += z; view.k = k;
  }

  // Ease the camera face-on in flat mode, or to a view picked on the corner axes; true while still turning.
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let camGoal = null;
  function settleCam() {
    if (!flat && camGoal) {
      const dy = wrap(camGoal.yaw - cam.yaw), dp = camGoal.pitch - cam.pitch;
      if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) { cam.yaw = camGoal.yaw; cam.pitch = camGoal.pitch; camGoal = null; return false; }
      cam.yaw += dy * 0.18; cam.pitch += dp * 0.18;
      return true;
    }
    if (!flat) return false;
    cam.yaw = wrap(cam.yaw); cam.yaw *= 0.8; cam.pitch *= 0.8;
    if (Math.abs(cam.yaw) < 0.001) cam.yaw = 0;
    if (Math.abs(cam.pitch) < 0.001) cam.pitch = 0;
    return cam.yaw !== 0 || cam.pitch !== 0;
  }

  // Eases the view toward showing everything; returns true while it is still moving.
  function fit() {
    if (!shown.length || !W) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    // A clicked note: frame it with its links; else the picked set; else everything.
    const frameSet = chosen ? [chosen, ...[...chosen.nb].map((i) => N[i])].filter((p) => !p.hidden)
      : picked ? [...picked.near].map((i) => N[i]).filter((p) => !p.hidden) : shown;
    for (const p of frameSet) { x0 = Math.min(x0, p.sx); y0 = Math.min(y0, p.sy); x1 = Math.max(x1, p.sx); y1 = Math.max(y1, p.sy); }
    if (picked || chosen) {   // a few nodes: keep some of their surroundings in view
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max((x1 - x0) / 2, 160), hh = Math.max((y1 - y0) / 2, 120);
      x0 = cx - hw; x1 = cx + hw; y0 = cy - hh; y1 = cy + hh;
    }
    // Keep clear of the search box and toolbar along the top: frame into the pane below them.
    const top = H > 300 ? 48 : 0;
    const k = Math.min(W / (x1 - x0 + 80), (H - top) / (y1 - y0 + 80), 2.5);
    if (!Number.isFinite(k) || k <= 0) return false;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - top / 2 / k;
    const [dx, dy, dz] = unrotate(mx * 0.2, my * 0.2);
    cam.cx += dx; cam.cy += dy; cam.cz += dz;
    view.k += (k - view.k) * 0.2;
    return Math.abs(k - view.k) > k * 0.005 || Math.abs(mx * k) > 0.5 || Math.abs(my * k) > 0.5;
  }

  // ---------- drawing ----------
  // Each style can restyle the graph through CSS variables (style.css): --g-node and --g-edge colours,
  // --g-edge-w (line width), --g-glow (blur in px), --g-shape: square, --g-outline (node border).
  // Everything is drawn in screen pixels around the pane centre; nearer nodes are bigger and drawn last,
  // farther ones fade into the background.
  function draw() {
    const cs = getComputedStyle(host), v = (n) => cs.getPropertyValue(n).trim();
    const ink = v("--ink") || "#111", muted = v("--muted") || "#888";
    const bg = v("--bg") || "#fff";
    const node = v("--g-node") || muted, edge = v("--g-edge") || muted, ew = +v("--g-edge-w") || 1;
    const pal = v("--g-palette");
    palette = pal && pal.includes(",") ? pal.split(",").map((c) => c.trim()).filter(Boolean) : PALETTE;   // "initial" (terminal, light) means the usual colours
    const colour = (p) => p.cg >= 0 ? CG[p.cg].c : p.slot >= 0 && palette.length ? palette[p.slot % palette.length] : node;
    for (const r of rows) r.el.querySelector("i").style.background = r.g === null ? node : palette[slot.get(r.g) % palette.length];
    const glow = +v("--g-glow") || 0, square = v("--g-shape") === "square", outline = v("--g-outline");
    const dot = (x, y, r) => { ctx.beginPath(); if (square) ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2); };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    const k = view.k, X = (p) => p.sx * k, Y = (p) => p.sy * k;
    const fog = (d) => Math.min(1, Math.max(0.22, 1 - 0.8 * Math.max(0, d) / spread));
    const focus = hover || chosen, lit = focus ? focus.nb : null;
    const sel = !focus && picked;

    // A box around the graph, seen in perspective: of its six sides, the three behind the graph are drawn
    // (a floor and two walls, like the corner of a room), each faintly tinted with its axis colour, and every
    // note casts a shadow on the floor. Turning the graph swaps in whichever sides are behind it.
    let floorY = null;
    room = null;
    if (!flat && shown.length > 1) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of shown) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      // While a note is dragged the box stays put, or its walls would slide along with the note and the
      // guides on them would show nothing.
      if (!(drag?.node && drag.moved && roomBox)) roomBox = { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: Math.max(x1 - x0, y1 - y0, z1 - z0) / 2 + 40 };
      const { c, half } = roomBox, step = half / 4;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      // How squarely each axis points at the viewer (1: straight on, 0: edge-on).
      const facing = [Math.abs(-sy * cp), Math.abs(sp), Math.abs(cy * cp)];
      const at = (a, v, u, w) => { const q = [0, 0, 0], o = [(a + 1) % 3, (a + 2) % 3]; q[a] = v; q[o[0]] = u; q[o[1]] = w; return proj(q[0], q[1], q[2]); };
      const walls = [];
      for (let a = 0; a < 3; a++) {
        const o = [(a + 1) % 3, (a + 2) % 3];
        const near = at(a, c[a] - half, c[o[0]], c[o[1]])[2], far = at(a, c[a] + half, c[o[0]], c[o[1]])[2];
        walls.push({ a, v: c[a] + (far > near ? half : -half), o, fade: Math.min(1, Math.max(0, (facing[a] - 0.06) / 0.3)) });
      }
      const AX = [AXIS.x, AXIS.y, AXIS.z];
      for (const wl of walls) {
        if (!wl.fade) continue;
        const { a, v, o } = wl, u0 = c[o[0]] - half, u1 = c[o[0]] + half, w0 = c[o[1]] - half, w1 = c[o[1]] + half;
        const corner = [[u0, w0], [u1, w0], [u1, w1], [u0, w1]].map(([u, w]) => at(a, v, u, w));
        ctx.globalAlpha = 0.035 * wl.fade; ctx.fillStyle = AX[a];
        ctx.beginPath(); corner.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, q[0] * k, q[1] * k)); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = 1;
        ctx.globalAlpha = 0.14 * wl.fade; ctx.stroke();
        ctx.globalAlpha = 0.06 * wl.fade;
        ctx.beginPath();
        for (let i = -3; i <= 3; i++) {
          let q = at(a, v, c[o[0]] + i * step, w0), r = at(a, v, c[o[0]] + i * step, w1);
          ctx.moveTo(q[0] * k, q[1] * k); ctx.lineTo(r[0] * k, r[1] * k);
          q = at(a, v, u0, c[o[1]] + i * step); r = at(a, v, u1, c[o[1]] + i * step);
          ctx.moveTo(q[0] * k, q[1] * k); ctx.lineTo(r[0] * k, r[1] * k);
        }
        ctx.stroke();
      }
      room = { c, half, walls };
      // Shadows on the floor (or the ceiling, seen from below).
      const fl = walls[1];
      floorY = fl.v;
      if (fl.fade) {
        ctx.fillStyle = ink;
        for (const p of shown) {
          if (p.kind === "tag") continue;
          const [sx, sy2, , ss] = proj(p.x, fl.v, p.z), r = radius(p) * k * ss * 1.1;
          ctx.globalAlpha = 0.09 * fl.fade * ((focus || sel) && !(p === focus || lit?.has(p.i) || sel?.near?.has(p.i)) ? 0.3 : 1);
          ctx.beginPath(); ctx.ellipse(sx * k, sy2 * k, r, r * Math.max(0.2, Math.abs(sp)), 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Links: nearer ones thicker and stronger, far ones thin and faint.
    ctx.lineCap = square ? "square" : "round";
    ctx.strokeStyle = edge;
    const base = focus || sel ? edgeAlpha * 0.35 : edgeAlpha;
    // Grouped into eight depth bands, one stroke each: per-link strokes cost too much on big graphs.
    const BANDS = 8, bands = Array.from({ length: BANDS }, () => []);
    let s0 = Infinity, s1 = -Infinity;
    for (const p of shown) { s0 = Math.min(s0, p.s); s1 = Math.max(s1, p.s); }
    const span = Math.max(1e-6, s1 - s0);
    for (const e of shownE) {
      if (focus && (e[0] === focus.i || e[1] === focus.i)) continue;
      const m = (N[e[0]].s + N[e[1]].s) / 2;
      bands[Math.min(BANDS - 1, Math.floor(((m - s0) / span) * BANDS))].push(e);
    }
    // Arrowheads (Settings > Arrows) point at the note being linked to, just outside its dot.
    const arrow = (from, to, size) => {
      const dx = X(to) - X(from), dy = Y(to) - Y(from), len = Math.hypot(dx, dy), r = radius(to) * k * to.s + 1.5;
      if (len < r + size * 2) return;
      const ux = dx / len, uy = dy / len, tx = X(to) - ux * r, ty = Y(to) - uy * r, bx = tx - ux * size, by = ty - uy * size;
      ctx.moveTo(tx, ty); ctx.lineTo(bx - uy * size * 0.55, by + ux * size * 0.55); ctx.lineTo(bx + uy * size * 0.55, by - ux * size * 0.55); ctx.closePath();
    };
    bands.forEach((band, bi) => {
      if (!band.length) return;
      const m = s0 + span * (bi + 0.5) / BANDS, F = focal(), d = F / m - F;   // the band's middle scale, and its depth
      ctx.globalAlpha = base * Math.min(1.4, fog(d) * 1.15);
      ctx.lineWidth = ew * Math.min(ew > 1.5 ? 1.4 : 2.2, Math.max(0.4, m) ** 1.5);
      ctx.beginPath();
      for (const [a, b] of band) { ctx.moveTo(X(N[a]), Y(N[a])); ctx.lineTo(X(N[b]), Y(N[b])); }
      ctx.stroke();
      if (S.arrows) {
        const size = Math.max(3, Math.min(7, 5 * m * Math.sqrt(k))) * Math.max(1, ew * 0.7);
        ctx.fillStyle = edge; ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 1.6);
        ctx.beginPath();
        for (const [a, b, dir] of band) { if (dir & 1) arrow(N[a], N[b], size); if (dir & 2) arrow(N[b], N[a], size); }
        ctx.fill();
      }
    });
    if (focus) {
      // A hub has hundreds of links; drawing them all solid turns into a white burst.
      ctx.globalAlpha = focus.nb.size > 40 ? 0.3 : focus.nb.size > 12 ? 0.55 : 0.9;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2 * ew;
      ctx.beginPath();
      for (const j of focus.nb) if (!N[j].hidden) { ctx.moveTo(X(focus), Y(focus)); ctx.lineTo(X(N[j]), Y(N[j])); }
      if (S.arrows) {
        ctx.stroke(); ctx.fillStyle = ink; ctx.beginPath();
        for (const [a, b, dir] of shownE) {
          if (a !== focus.i && b !== focus.i) continue;
          if (dir & 1) arrow(N[a], N[b], 6); if (dir & 2) arrow(N[b], N[a], 6);
        }
        ctx.fill(); ctx.beginPath();
      }
      ctx.stroke();
    }
    if (sel) {
      ctx.globalAlpha = 0.7; ctx.strokeStyle = ink; ctx.lineWidth = 1.2 * ew;
      ctx.beginPath();
      for (const [a, b] of shownE) if (sel.core.has(a) || sel.core.has(b)) { ctx.moveTo(X(N[a]), Y(N[a])); ctx.lineTo(X(N[b]), Y(N[b])); }
      ctx.stroke();
    }

    if (glow) { ctx.shadowColor = node; ctx.shadowBlur = glow; }
    const back = [...shown].sort((a, b) => b.d - a.d);   // far to near, so near nodes cover far ones
    for (const p of back) {
      const on = p === focus || (lit && lit.has(p.i)) || (sel && sel.near.has(p.i)), active = isActive(p);
      ctx.globalAlpha = ((focus || sel) && !on ? 0.18 : 1) * (on || active ? 1 : fog(p.d));
      const r = radius(p) * k * p.s, x = X(p), y = Y(p);
      dot(x, y, r);
      if (p.kind === "tag") { ctx.lineWidth = 1.2; ctx.strokeStyle = on ? ink : node; ctx.fillStyle = bg; ctx.fill(); ctx.stroke(); }
      else {
        const c = p === focus ? ink : colour(p);
        if (glow) ctx.shadowColor = c;
        ctx.fillStyle = c; ctx.fill();
        if (outline) { ctx.lineWidth = 2; ctx.strokeStyle = outline; ctx.stroke(); }
      }
      if (active) { ctx.lineWidth = 2; ctx.strokeStyle = ink; dot(x, y, r + 3); ctx.stroke(); }
    }
    ctx.shadowBlur = 0;

    // Labels never overlap. They are placed in priority order — hovered node, open files, then the
    // best-connected neighbours (or, when zoomed in, the best-connected nodes on screen, nearest first
    // among equals) — and any label that would collide with one already placed is skipped.
    const fs = 11, pad = 3, font = cs.getPropertyValue("--font-body") || "sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const zoomLabels = Math.min(1, Math.max(0, (view.k - 1.1) / 0.6));
    const byDeg = (a, b) => b.deg - a.deg || a.d - b.d;
    const order = [];
    let hubs = null, fixed = -1;
    if (focus) order.push(focus);
    if (sel) order.push(...[...sel.core].map((i) => N[i]));
    order.push(...N.filter((p) => p !== focus && isActive(p)));
    if (focus) order.push(...[...focus.nb].map((j) => N[j]).sort(byDeg).slice(0, 30));
    else if (sel) order.push(...[...sel.near].map((i) => N[i]).sort(byDeg).slice(0, 40));
    else {
      // The best-connected notes are always named, so the graph reads at a glance; the rest fade in with zoom.
      const ranked = shown.filter((p) => p.kind !== "tag").sort(byDeg);
      hubs = new Set(ranked.slice(0, Math.max(4, Math.min(12, Math.round(Math.sqrt(ranked.length))))));
      order.push(...hubs);
      fixed = order.length;
      // In 3D the near side is named too, nearest first; far names fade out (below).
      if (!flat) order.push(...ranked.filter((p) => p.d < -0.4 * spread).sort((a, b) => a.d - b.d));
      if (zoomLabels > 0.02) order.push(...ranked);
    }
    // Names already showing keep their place ahead of new ones, so they do not flicker as the graph turns.
    if (fixed >= 0) {
      const rest = order.slice(fixed);
      order.length = fixed;
      order.push(...rest.filter((p) => shownLabels.has(p)), ...rest.filter((p) => !shownLabels.has(p)));
    }
    if (order.length > 160) order.length = 160;   // measuring every name of a big graph each frame is what costs
    const placed = [], seen = new Set(), nowShown = new Set();
    let lastFont = "";
    labelsEasing = false;
    const free = (x, y, w, h) => !placed.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
    for (const p of order) {
      if (seen.has(p) || p.hidden) continue;
      seen.add(p);
      const px = X(p), py = Y(p);
      if (Math.abs(px + view.x) > W / 2 || Math.abs(py + view.y) > H / 2) continue;
      const main = p === focus || (sel && sel.core.size <= 8 && sel.core.has(p.i));
      // Depth: names grow and brighten toward the viewer and dim and shrink away from it.
      const near = flat ? 0.5 : Math.min(1, Math.max(0, 0.5 - p.d / (2 * spread)));
      const lf = flat ? 1 : 0.15 + 0.85 * near ** 1.4, fz = flat ? fs : Math.round(fs * (0.85 + 0.4 * near) * 2) / 2;
      // Setting ctx.font parses it, which is slow: only when it changes (sizes are rounded to half pixels).
      const f = `${main ? 600 : 400} ${main ? fs * 1.15 : fz}px ${font}`;
      if (f !== lastFont) { ctx.font = f; lastFont = f; }
      const max = main ? 48 : 22;
      const chars = Array.from(p.label);   // by character, so an emoji is never cut in half
      const text = chars.length > max ? chars.slice(0, max - 1).join("") + "…" : p.label;
      const w = ctx.measureText(text).width + pad * 2, h = (main ? fs * 1.15 : fz) + pad * 2;
      const x = px - w / 2, y = py + radius(p) * k * p.s + 2;
      if (!main && !free(x, y, w, h)) continue;
      placed.push([x, y, w, h]);
      // A name that just appeared fades in over a few frames.
      if (!shownLabels.has(p)) p.la = 0;
      p.la = Math.min(1, (p.la ?? 1) + 0.12);
      if (p.la < 1) labelsEasing = true;
      nowShown.add(p);
      if (main) {
        ctx.globalAlpha = 0.92; ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(x, y, w, h, square ? 0 : h / 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = ink;
      } else {
        const hub = hubs?.has(p), close = !flat && p.d < -0.4 * spread;
        ctx.globalAlpha = (focus || sel || isActive(p) || close ? 0.95 : hub ? Math.max(0.85, zoomLabels) : zoomLabels) * (isActive(p) ? Math.max(0.6, lf) : lf);
        ctx.fillStyle = ink;
      }
      ctx.globalAlpha *= p.la;
      ctx.fillText(text, px, y + pad);
      // Under the hovered or clicked note: its category, how many links it has, and that a second click opens it.
      if (p === focus && (p.kind !== "tag" || p === chosen)) {
        const sub = [p.kind !== "tag" && p.group, p.kind !== "tag" && t("{n} 条链接", { n: p.deg }), p === chosen && t("再点一次打开"), p.pin && (matchMedia("(pointer: coarse)").matches ? t("已固定，长按取消") : t("已固定，右键取消"))].filter(Boolean).join(" · ");
        ctx.font = lastFont = `400 ${fs}px ${font}`;
        const sw = ctx.measureText(sub).width + pad * 2, sy = y + h + 1;
        placed.push([px - sw / 2, sy, sw, fs + pad * 2]);
        ctx.globalAlpha = 0.92; ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(px - sw / 2, sy, sw, fs + pad * 2, square ? 0 : (fs + pad * 2) / 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = muted;
        ctx.fillText(sub, px, sy + pad);
      }
    }

    shownLabels = nowShown;

    // While a note is dragged: x / y / z axes through it (the locked one bold), a line down to the floor, and
    // where it is, so it is clear which way it moves.
    const held = drag?.node && drag.moved ? drag.node : null;
    if (held) {
      const n = held, L = spread * 0.22, c0 = [X(n), Y(n)];
      ctx.lineCap = "round"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = lastFont = `600 10px ${font}`;
      for (const ax of flat ? ["x", "y"] : ["x", "y", "z"]) {
        const u = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[ax];
        const a = proj(n.x - u[0] * L, n.y - u[1] * L, n.z - u[2] * L), b = proj(n.x + u[0] * L, n.y + u[1] * L, n.z + u[2] * L);
        const on = lockAxis === ax;
        ctx.globalAlpha = lockAxis && !on ? 0.25 : 0.9;
        ctx.strokeStyle = AXIS[ax]; ctx.lineWidth = on ? 3 : 1.5;
        ctx.beginPath(); ctx.moveTo(a[0] * k, a[1] * k); ctx.lineTo(b[0] * k, b[1] * k); ctx.stroke();
        ctx.fillStyle = AXIS[ax]; ctx.fillText(ax, b[0] * k + (b[0] - a[0]) * k * 0.06, b[1] * k + (b[1] - a[1]) * k * 0.06);
      }
      // Its shadow on the floor and on both walls, each tied to it by a dashed line and crossed by two guide
      // lines across that side: where it sits along all three axes, at a glance.
      if (room) {
        const AX = [AXIS.x, AXIS.y, AXIS.z], P = [n.x, n.y, n.z];
        for (const wl of room.walls) {
          if (wl.fade < 0.15) continue;
          const at3 = (a, v, b, u) => { const q = [...P]; q[wl.a] = wl.v; if (b !== undefined) q[b] = u; return proj(q[0], q[1], q[2]); };
          const s = at3();
          ctx.strokeStyle = AX[wl.a]; ctx.lineWidth = 1;
          ctx.globalAlpha = 0.35 * wl.fade; ctx.beginPath();
          for (const o of wl.o) {
            const p0 = at3(0, 0, o, room.c[o] - room.half), p1 = at3(0, 0, o, room.c[o] + room.half);
            ctx.moveTo(p0[0] * k, p0[1] * k); ctx.lineTo(p1[0] * k, p1[1] * k);
          }
          ctx.stroke();
          ctx.globalAlpha = 0.7 * wl.fade; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(s[0] * k, s[1] * k); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = AX[wl.a]; ctx.globalAlpha = 0.85 * wl.fade;
          ctx.beginPath(); ctx.arc(s[0] * k, s[1] * k, Math.max(2.5, radius(n) * k * s[3] * 0.8), 0, Math.PI * 2); ctx.fill();
        }
      }
      const r = (v) => Math.round(v);
      const lines = [`x ${r(n.x)}   y ${r(-n.y)}${flat ? "" : `   z ${r(n.z)}`}`, flat ? t("按住 X / Y 只沿一个方向") : t("按住 X / Y / Z 只沿一个方向 · 滚轮前后移动")];
      ctx.font = lastFont = `400 10px ${font}`;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12, bx = c0[0] + 14, by = c0[1] - 40;
      ctx.globalAlpha = 0.9; ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(bx, by, w, 30, square ? 0 : 6); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(lines[0], bx + 6, by + 4); ctx.fillStyle = muted; ctx.fillText(lines[1], bx + 6, by + 17);
    }

    // While turning the graph, mark the point it turns around (always the middle of the pane).
    if (drag && drag.moved && !drag.node && !drag.pan && !flat) {
      ctx.globalAlpha = 0.55; ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.moveTo(-12, 0); ctx.lineTo(-8, 0); ctx.moveTo(8, 0); ctx.lineTo(12, 0);
      ctx.moveTo(0, -12); ctx.lineTo(0, -8); ctx.moveTo(0, 8); ctx.lineTo(0, 12); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The x / y / z axes in the corner show which way the graph is turned (red, green, blue, like 3D tools).
    if (!flat || cam.yaw || cam.pitch) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const ox = 36, oy = H - 36, L = 22;
      const axes = [["x", 1, 0, 0], ["y", 0, -1, 0], ["z", 0, 0, 1]].map(([name, x, y, z]) => {
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
        return { name, x: x1, y: y * cp - z1 * sp, d: y * sp + z1 * cp };
      }).sort((a, b) => b.d - a.d);
      ctx.font = lastFont = `600 10px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 2; ctx.lineCap = "round";
      gizmo = { ox, oy, hits: [] };
      for (const a of axes) {
        ctx.globalAlpha = a.d > 0 ? 0.4 : 0.95;
        ctx.strokeStyle = AXIS[a.name]; ctx.fillStyle = AXIS[a.name];
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + a.x * L, oy + a.y * L); ctx.stroke();
        const lx = ox + a.x * (L + 8), ly = oy + a.y * (L + 8);
        if (gizmoHover === a.name) { ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(lx, ly, 8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
        ctx.fillText(a.name, lx, ly);
        gizmo.hits.push({ name: a.name, x: lx, y: ly });
      }
      if (gizmoHover === "home") { ctx.globalAlpha = 0.25; ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI * 2); ctx.fill(); }
    } else gizmo = null;

    // Nothing left to show (every category hidden, or only orphans with orphans off): say so, not a blank pane.
    if (!shown.length && N.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = lastFont = `400 13px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.8; ctx.fillStyle = muted;
      ctx.fillText(anyOff() ? t("所有分类都隐藏了，在右下角重新打开") : t("没有可显示的笔记"), W / 2, H / 2);
    }

    // How to move around, in one quiet line at the bottom left (beside the axes in 3D).
    {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const touch = matchMedia("(pointer: coarse)").matches;
      const hint = flat ? (touch ? t("单指拖动平移 · 双指缩放") : sawPad ? t("双指滑动或拖动平移 · 滚轮或捏合缩放") : t("拖动平移 · 滚轮缩放"))
        : touch ? t("单指拖动旋转 · 双指平移和缩放")
        : sawPad ? t("双指横向滑动或拖动旋转 · 滚轮或捏合缩放 · 点 x / y / z 正对该轴")
        : t("拖动旋转 · 右键拖动平移 · 滚轮缩放 · 点 x / y / z 正对该轴");
      ctx.font = lastFont = `400 11px ${font}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const hx = gizmo ? 72 : 12, room = W - hx - Math.min(W * 0.46, 200) - 16;
      if (ctx.measureText(hint).width <= room) { ctx.globalAlpha = 0.6; ctx.fillStyle = muted; ctx.fillText(hint, hx, H - 16); }
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    raf = 0;
    if (alpha > 0.003) tick();
    const turning = settleCam();
    // Turn slowly (Settings > Auto-rotate), pausing while the user handles the graph and for a few seconds after.
    // Never while the pane is out of sight (a phone's list view, a hidden tab): it would burn battery for nothing.
    const spinning = !flat && S.spin && onScreen && W > 0 && H > 0 && !document.hidden && !drag && !hover && !chosen && !picked && performance.now() - touchedAt > 4000;
    if (spinning) cam.yaw += 0.0025;
    project();
    // Frame the graph while it settles, or once when asked (a click, a filter, Center) — not all the time, so
    // turning it never makes the zoom pump. A pane that was hidden (phone list view) has no size until shown.
    const fitting = !userMoved && (fitPending || alpha > 0.02) && fit();
    if (!fitting && alpha <= 0.02 && W) fitPending = false;
    if (W) saveCam();
    draw();
    if (alpha > 0.003 || drag || fitting || turning || spinning || labelsEasing) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (raf !== -1 && !raf) raf = requestAnimationFrame(frame); };

  // ---------- interaction ----------
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toScreen = ([px, py]) => [(px - W / 2 - view.x) / view.k, (py - H / 2 - view.y) / view.k];
  function pick(pt) {
    const [wx, wy] = toScreen(pt);
    let best = null, bd = Infinity;
    for (const p of shown) {   // nearest to the viewer wins when two overlap
      const dist = Math.hypot(p.sx - wx, p.sy - wy);
      if (dist < radius(p) * p.s + 6 / view.k && p.d < bd) { best = p; bd = p.d; }
    }
    return best;
  }
  const pointers = new Map();
  let pressTimer = 0;
  let drag = null, pinch = null, gizmo = null, gizmoHover = null, room = null, roomBox = null;
  // The corner axes: a letter looks straight along that axis (again: from the other side); the middle goes back to the usual view.
  function gizmoAt([px, py]) {
    if (!gizmo || flat) return null;
    for (const h of gizmo.hits) if (Math.hypot(px - h.x, py - h.y) < 10) return h.name;
    return Math.hypot(px - gizmo.ox, py - gizmo.oy) < 7 ? "home" : null;
  }
  function viewAlong(name) {
    const views = { x: [-Math.PI / 2, 0], y: [0, 1.5], z: [0, 0], home: [0.5, 0.38] };
    let [yaw, pitch] = views[name];
    const same = Math.abs(wrap(cam.yaw - yaw)) < 0.05 && Math.abs(cam.pitch - pitch) < 0.05;
    if (same && name === "y") pitch = -1.5;
    else if (same && name !== "home") yaw += Math.PI;
    camGoal = { yaw: cam.yaw + wrap(yaw - cam.yaw), pitch };
    userMoved = false; fitPending = true; touchedAt = performance.now(); kick();
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      if (drag?.node) drag.node.fixed = false;
      drag = null;
      return;
    }
    const g = e.button === 0 && gizmoAt(local(e));
    if (g) { viewAlong(g); return; }
    camGoal = null;
    const pt = local(e), node = (e.button === 0 && !e.shiftKey) || e.button === 2 ? pick(pt) : null;
    // Background: orbit in 3D, pan in flat mode; shift, right or middle button always pans.
    const pan = flat || e.shiftKey || e.button === 1 || (e.button === 2 && !node);
    drag = { node, pan, start: pt, last: pt, vx: view.x, vy: view.y, moved: false };
    if (node) { node.fixed = true; canvas.style.cursor = "grabbing"; }
    // No right button on a touch screen: holding a pinned note still for a moment releases it instead.
    clearTimeout(pressTimer);
    if (node?.pin && e.pointerType !== "mouse") pressTimer = setTimeout(() => {
      if (drag?.node !== node || drag.moved) return;
      node.fixed = false; node.pin = null; delete pins[pinKey(node)]; savePins();
      drag = null; alpha = Math.max(alpha, 0.3); navigator.vibrate?.(10); kick();
    }, 550);
  });
  canvas.addEventListener("pointermove", (e) => {
    const pt = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const k = Math.min(6, Math.max(0.1, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
      const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      zoomAt(c, k); panBy(c[0] - pinch.c[0], c[1] - pinch.c[1]); pinch.c = c;
      userMoved = true; touchedAt = performance.now(); kick(); return;
    }
    if (!drag) {
      const g = gizmoAt(pt), h = g ? null : pick(pt);
      if (g !== gizmoHover) { gizmoHover = g; kick(); }
      if (h !== hover) { hover = h; kick(); }
      canvas.style.cursor = h || g ? "pointer" : "grab";
      return;
    }
    if (Math.hypot(pt[0] - drag.start[0], pt[1] - drag.start[1]) > 4) drag.moved = true;
    if (!drag.moved) { drag.last = pt; return; }
    if (drag.node) {
      const n = drag.node;
      if (lockAxis && !(flat && lockAxis === "z")) {
        // Along one world axis only: the pointer's movement measured along that axis as it lies on screen.
        const a = proj(n.x, n.y, n.z), u = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[lockAxis];
        const b = proj(n.x + u[0], n.y + u[1], n.z + u[2]);
        const dx = (b[0] - a[0]) * view.k, dy = (b[1] - a[1]) * view.k, len2 = dx * dx + dy * dy;
        if (len2 > 1e-4) n[lockAxis] += ((pt[0] - drag.last[0]) * dx + (pt[1] - drag.last[1]) * dy) / len2;
      } else [n.x, n.y, n.z] = unproject(pt, n.d);
      if (flat) n.z = 0;
      hover = n;
      alpha = Math.max(alpha, 0.25);
      // The view holds still while a note is moved: re-framing as the layout reacts would slide the graph out
      // from under the pointer (and the note away from where it is dropped).
      userMoved = true;
    } else if (drag.pan) {
      panBy(pt[0] - drag.last[0], pt[1] - drag.last[1]);
      userMoved = true; touchedAt = performance.now();
    } else {
      // Grab-and-turn: the near side follows the pointer, like turning a globe.
      cam.yaw -= (pt[0] - drag.last[0]) * 0.008;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + (pt[1] - drag.last[1]) * 0.008));
      userMoved = true; touchedAt = performance.now();
    }
    drag.last = pt;
    kick();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const d = drag; drag = null;
    if (d.node) {
      d.node.fixed = false;
      // Put down where it was dragged: pin it there (kept on this device). In flat mode its depth is kept.
      if (d.moved) { const n = d.node; n.pin = [n.x, n.y, flat ? (n.pin?.[2] ?? 0) : n.z]; pins[pinKey(n)] = n.pin.map((v) => Math.round(v * 10) / 10); savePins(); }
      // Right click on a pinned note, without dragging: let it go back to the layout.
      else if (e.button === 2 && d.node.pin) { d.node.pin = null; delete pins[pinKey(d.node)]; savePins(); alpha = Math.max(alpha, 0.3); }
    }
    lockAxis = null;
    canvas.style.cursor = hover ? "pointer" : "grab";
    if (!d.moved && e.type === "pointerup" && e.button === 0) {
      if (d.node && d.node === chosen) onOpen(d.node);
      else if (d.node || chosen) { chosen = d.node; userMoved = false; fitPending = true; }   // a note: light it up and fly to it; the background: let go and show everything
    }
    kick();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("keydown", (e) => { if (e.key === "Escape" && (chosen || picked || legendPick)) api.fit(); });
  canvas.tabIndex = -1;
  // While dragging a note, holding X, Y or Z keeps it on that axis.
  let lockAxis = null;
  const onKey = (e) => {
    const k = e.key?.toLowerCase();
    if (!drag?.node || !"xyz".includes(k) || k.length !== 1) return;
    lockAxis = e.type === "keydown" ? k : lockAxis === k ? null : lockAxis;
    e.preventDefault(); kick();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  canvas.addEventListener("pointerleave", () => { if (!drag && (hover || gizmoHover)) { hover = null; gizmoHover = null; kick(); } });
  let wheelAt = 0, wheelPad = null, sawPad = false;
  try { sawPad = localStorage.getItem("suiji:graphPad2") === "1"; } catch {}
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (drag?.node && !flat) {   // while holding a note: the wheel pushes it away or pulls it closer
      const n = drag.node, F = focal(), d = Math.max(-F * 0.75, n.d - e.deltaY * 0.4);
      [n.x, n.y, n.z] = unproject(drag.last, d);
      drag.moved = true; alpha = Math.max(alpha, 0.25); kick(); return;
    }
    // A trackpad: pinching (sent as a wheel with ctrl) zooms; two fingers turn the graph (move it in 2D, or
    // with shift). A mouse wheel zooms. Which one it is gets decided once per gesture, so it cannot flip midway.
    const now = performance.now(), zoomBy = (f) => zoomAt([W / 2, H / 2], Math.min(6, Math.max(0.1, view.k * f)));
    if (now - wheelAt > 250) wheelPad = null;
    wheelAt = now;
    if (e.ctrlKey) zoomBy(Math.exp(-e.deltaY * 0.01));
    else {
      // Only a sideways component gives a trackpad away: a mouse wheel (on a Mac, too) only ever scrolls up and
      // down, and the browser reports both in the same units, so anything else would mistake one for the other.
      if (wheelPad === null) wheelPad = e.deltaX !== 0 && !e.shiftKey;
      if (!wheelPad) zoomBy(Math.exp(-e.deltaY * 0.0015));
      else {
        if (!sawPad) { sawPad = true; try { localStorage.setItem("suiji:graphPad2", "1"); } catch {} }
        if (flat) panBy(-e.deltaX, -e.deltaY);
        else { camGoal = null; cam.yaw += e.deltaX * 0.006; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - e.deltaY * 0.006)); }
      }
    }
    userMoved = true; touchedAt = now; kick();
  }, { passive: false });

  const ro = new ResizeObserver(() => {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!userMoved) fitPending = true;
    kick();
  });
  ro.observe(host);
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; kick(); });
  io.observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", kick);
  kick();

  const api = {
    redraw() {
      if (S.local) {   // another note opened beside the graph: the local graph moves to it
        const key = N.filter((n) => !(n.kind !== "tag" && off.has(keyOf(n))) && isActive(n)).map((n) => n.i).join(",");
        if (key !== localKey) { relayout(); return; }
      }
      kick();
    },
    fit() { picked = null; chosen = null; userMoved = false; fitPending = true; legendPick = null; syncLegend(); kick(); },
    toggleForces() { panel.hidden = !panel.hidden; return !panel.hidden; },
    // Where everything is, for the next build of this pane's graph (see prev).
    state() {
      return { pos: new Map(N.map((n) => [pinKey(n), [n.x, n.y, n.z]])), k: view.k, c: [cam.cx, cam.cy, cam.cz], yaw: cam.yaw, pitch: cam.pitch, spread, userMoved, flat, chosen: chosen && pinKey(chosen) };
    },
    setFlat(on) {
      if (flat === !!on) return;
      flat = !!on;
      if (!flat) {   // puff the layout back out along z, and tilt the camera so the depth shows
        for (const p of N) p.vz += (Math.random() - 0.5) * 40;
        cam.yaw = 0.5; cam.pitch = 0.38; touchedAt = 0;
      }
      alpha = Math.max(alpha, 0.5); userMoved = false; fitPending = true; kick();
    },
    // Lights up the nodes for which match(node) is true, with their neighbours, and frames them; returns their labels.
    focus(match) {
      const core = new Set(shown.filter((n) => match(n)).map((n) => n.i));
      legendPick = null; syncLegend();
      picked = core.size ? { core, near: new Set([...core].flatMap((i) => [i, ...N[i].nb]).filter((i) => !N[i].hidden)) } : null;
      userMoved = false; fitPending = true; kick();
      return [...core].map((i) => N[i].label);
    },
    destroy() { clearTimeout(camTimer); clearTimeout(pressTimer); try { if (camSaved) localStorage.setItem("suiji:graphCam", camSaved); } catch {} cancelAnimationFrame(raf); raf = -1; ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", kick); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); scheme.removeEventListener("change", kick); },
  };
  return api;
}
