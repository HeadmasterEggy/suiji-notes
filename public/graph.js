// Relationship graph, Obsidian-style, in 3D. Nodes are notes and Markdown files (and optionally tags), edges
// are [[links]]. A small force simulation lays them out in space and a perspective camera draws them on a 2D
// canvas: drag the background to orbit (or to pan in flat mode), shift- or right-drag to pan, scroll or pinch
// to zoom, drag a node to move it, hover to light up its neighbours, click to open it. Flat mode squashes the
// z axis and turns the camera face-on, which gives the old 2D graph back.
//
// Each note node has a group (its category); every group gets its own colour, listed in a legend in the
// corner. Clicking a legend entry lights that group up and dims the rest; its checkbox shows or hides the
// group, and "only" hides every other group. Hidden groups leave the layout, which re-settles without them.
//
//   const g = mountGraph(host, { nodes: [{label, kind, ref, group}], edges: [[i, j]] }, { onOpen(node), isActive(node), flat })
//   g.redraw()       after the active set changes
//   g.setFlat(bool)  switch between 3D and flat, animated
//   g.destroy()      before the host is thrown away
import { t } from "./i18n.js";

// Categorical colours, readable on light and dark backgrounds. A style can swap them with --g-palette.
const PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7", "#9c755f", "#5fa8d3"];

export function mountGraph(host, data, { onOpen, isActive, flat = false, hidden = [], onHide }) {
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
  // Size grows with links but is capped, so one hub note does not cover its neighbours.
  const radius = (n) => n.kind === "tag" ? 2.5 + Math.min(Math.sqrt(n.deg), 6) * 0.6 : 2.5 + Math.min(Math.sqrt(n.deg), 9) * 0.9;
  const edgeAlpha = E.length > 400 ? 0.16 : 0.35;

  // Groups, biggest first: each of the first ten gets a palette colour, the rest share the plain node colour.
  const sizes = new Map();
  for (const n of N) if (n.kind !== "tag" && n.group) sizes.set(n.group, (sizes.get(n.group) || 0) + 1);
  const groups = [...sizes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  const slot = new Map(groups.slice(0, PALETTE.length).map(([g], i) => [g, i]));
  for (const n of N) n.slot = slot.has(n.group) ? slot.get(n.group) : -1;
  let palette = PALETTE;

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
  allBtn.onclick = () => { if (off.size) off.clear(); else for (const r of rows) off.add(r.key); setHidden(); };
  legend.append(allBtn);
  const syncLegend = () => {
    for (const r of rows) { r.el.classList.toggle("on", r === legendPick); r.el.classList.toggle("off", off.has(r.key)); r.box.setAttribute("aria-checked", !off.has(r.key)); }
    allBtn.textContent = off.size ? t("全部显示") : t("全部隐藏");
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
  // Which nodes and links are in play: those of shown groups, and tags still linked to one of them.
  let shown = N, shownE = E;
  function applyHidden() {
    for (const n of N) n.hidden = n.kind !== "tag" && off.has(keyOf(n));
    for (const n of N) if (n.kind === "tag") n.hidden = ![...n.nb].some((j) => N[j].kind !== "tag" && !N[j].hidden);
    shown = N.filter((n) => !n.hidden);
    shownE = E.filter(([a, b]) => !N[a].hidden && !N[b].hidden);
    if (hover?.hidden) hover = null;
  }
  function setHidden() {
    applyHidden();
    if (legendPick && off.has(legendPick.key)) legendPick = null;
    picked = legendPick ? picked : null;
    syncLegend();
    onHide?.([...off]);
    alpha = Math.max(alpha, 0.6); userMoved = false; kick();
  }
  if (rows.length > 1) host.append(legend);

  let W = 0, H = 0, dpr = 1, raf = 0, alpha = 1;
  // view: screen pan (x, y) and zoom (k). cam: orbit angles; spread: how far out the layout reaches (for perspective and fog).
  let view = { x: 0, y: 0, k: 1 }, userMoved = false, hover = null;
  const cam = { yaw: flat ? 0 : 0.5, pitch: flat ? 0 : -0.35 };
  let spread = 200, userTurned = false;
  // Nodes picked from outside (the assistant): they and their neighbours stay lit and the view frames them.
  let picked = null;   // { core: Set of node indices, near: core plus neighbours }
  applyHidden(); syncLegend();

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
        const f = (130 * alpha) / d2;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f; b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
    }
    for (const [ia, ib] of shownE) {
      const a = N[ia], b = N[ib];
      // Clamp the distance: two linked nodes almost on top of each other would otherwise get a huge kick.
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.max(Math.hypot(dx, dy, dz), 4);
      const s = ((d - 60) / d) * alpha * 0.5 / Math.min(a.deg, b.deg);
      a.vx += dx * s; a.vy += dy * s; a.vz += dz * s; b.vx -= dx * s; b.vy -= dy * s; b.vz -= dz * s;
    }
    let far = 0;
    for (const p of shown) {
      p.vx -= p.x * 0.012 * alpha; p.vy -= p.y * 0.012 * alpha; p.vz -= p.z * 0.012 * alpha;
      if (flat) { p.vz = 0; p.z *= 0.8; if (Math.abs(p.z) < 0.05) p.z = 0; }
      if (p.fixed) { p.vx = p.vy = p.vz = 0; continue; }
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
  const focal = () => spread * 2.2;
  function project() {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), F = focal();
    for (const p of N) {
      const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy;
      const y2 = p.y * cp - z1 * sp, d = p.y * sp + z1 * cp;
      p.d = d; p.s = F / Math.max(F + d, F * 0.1); p.sx = x1 * p.s; p.sy = y2 * p.s;
    }
  }
  // The world point under screen point pt at depth d (used to drag a node across the screen).
  function unproject([px, py], d) {
    const F = focal(), s = F / Math.max(F + d, F * 0.1);
    const x1 = (px - W / 2 - view.x) / view.k / s, y2 = (py - H / 2 - view.y) / view.k / s;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y = y2 * cp + d * sp, z1 = -y2 * sp + d * cp;
    return [x1 * cy - z1 * sy, y, x1 * sy + z1 * cy];
  }
  // Ease the camera face-on in flat mode; returns true while it is still turning.
  function settleCam() {
    if (!flat) return false;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    cam.yaw = wrap(cam.yaw); cam.yaw *= 0.8; cam.pitch *= 0.8;
    if (Math.abs(cam.yaw) < 0.001) cam.yaw = 0;
    if (Math.abs(cam.pitch) < 0.001) cam.pitch = 0;
    return cam.yaw !== 0 || cam.pitch !== 0;
  }

  // Eases the view toward showing everything; returns true while it is still moving.
  function fit() {
    if (!shown.length || !W) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of picked ? [...picked.near].map((i) => N[i]).filter((p) => !p.hidden) : shown) { x0 = Math.min(x0, p.sx); y0 = Math.min(y0, p.sy); x1 = Math.max(x1, p.sx); y1 = Math.max(y1, p.sy); }
    if (picked) {   // a few picked nodes: keep some of their surroundings in view
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max((x1 - x0) / 2, 160), hh = Math.max((y1 - y0) / 2, 120);
      x0 = cx - hw; x1 = cx + hw; y0 = cy - hh; y1 = cy + hh;
    }
    const k = Math.min(W / (x1 - x0 + 80), H / (y1 - y0 + 80), 2.5);
    if (!Number.isFinite(k) || k <= 0) return false;
    const tx = -((x0 + x1) / 2) * k, ty = -((y0 + y1) / 2) * k;
    view.k += (k - view.k) * 0.2; view.x += (tx - view.x) * 0.2; view.y += (ty - view.y) * 0.2;
    return Math.abs(k - view.k) > k * 0.005 || Math.abs(tx - view.x) > 0.5 || Math.abs(ty - view.y) > 0.5;
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
    palette = pal ? pal.split(",").map((c) => c.trim()).filter(Boolean) : PALETTE;
    const colour = (p) => p.slot >= 0 && palette.length ? palette[p.slot % palette.length] : node;
    for (const r of rows) r.el.querySelector("i").style.background = r.g === null ? node : palette[slot.get(r.g) % palette.length];
    const glow = +v("--g-glow") || 0, square = v("--g-shape") === "square", outline = v("--g-outline");
    const dot = (x, y, r) => { ctx.beginPath(); if (square) ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2); };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    const k = view.k, X = (p) => p.sx * k, Y = (p) => p.sy * k;
    const fog = (d) => Math.min(1, Math.max(0.3, 1 - 0.7 * Math.max(0, d) / spread));
    const focus = hover, lit = focus ? focus.nb : null;
    const sel = !focus && picked;

    // Edges in four depth bands, so the far side of the ball recedes.
    ctx.lineCap = square ? "square" : "butt";
    ctx.strokeStyle = edge;
    const bands = [[], [], [], []];
    for (const e of shownE) {
      const [a, b] = e;
      if (focus && (a === focus.i || b === focus.i)) continue;
      const d = (N[a].d + N[b].d) / 2 / spread;
      bands[d < -0.35 ? 0 : d < 0.15 ? 1 : d < 0.6 ? 2 : 3].push(e);
    }
    bands.forEach((band, bi) => {
      if (!band.length) return;
      const f = [1, 1, 0.65, 0.4][bi];
      ctx.globalAlpha = (focus || sel ? edgeAlpha * 0.35 : edgeAlpha) * f;
      ctx.lineWidth = ew * [1.2, 1, 0.85, 0.7][bi];
      ctx.beginPath();
      for (const [a, b] of band) { ctx.moveTo(X(N[a]), Y(N[a])); ctx.lineTo(X(N[b]), Y(N[b])); }
      ctx.stroke();
    });
    if (focus) {
      // A hub has hundreds of links; drawing them all solid turns into a white burst.
      ctx.globalAlpha = focus.nb.size > 40 ? 0.3 : focus.nb.size > 12 ? 0.55 : 0.9;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2 * ew;
      ctx.beginPath();
      for (const j of focus.nb) if (!N[j].hidden) { ctx.moveTo(X(focus), Y(focus)); ctx.lineTo(X(N[j]), Y(N[j])); }
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
        const c = colour(p);
        if (glow) ctx.shadowColor = c;
        ctx.fillStyle = p === focus ? ink : c; ctx.fill();
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
    if (focus) order.push(focus);
    if (sel) order.push(...[...sel.core].map((i) => N[i]));
    order.push(...N.filter((p) => p !== focus && isActive(p)));
    if (focus) order.push(...[...focus.nb].map((j) => N[j]).sort(byDeg).slice(0, 30));
    else if (sel) order.push(...[...sel.near].map((i) => N[i]).sort(byDeg).slice(0, 40));
    else if (zoomLabels > 0.02) order.push(...[...N].sort(byDeg));
    const placed = [], seen = new Set();
    const free = (x, y, w, h) => !placed.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
    for (const p of order) {
      if (seen.has(p) || p.hidden) continue;
      seen.add(p);
      const px = X(p), py = Y(p);
      if (Math.abs(px + view.x) > W / 2 || Math.abs(py + view.y) > H / 2) continue;
      const main = p === focus || (sel && sel.core.size <= 8 && sel.core.has(p.i));
      ctx.font = `${main ? 600 : 400} ${main ? fs * 1.15 : fs}px ${font}`;
      const max = main ? 48 : 22;
      const text = p.label.length > max ? p.label.slice(0, max - 1) + "…" : p.label;
      const w = ctx.measureText(text).width + pad * 2, h = (main ? fs * 1.15 : fs) + pad * 2;
      const x = px - w / 2, y = py + radius(p) * k * p.s + 2;
      if (!main && !free(x, y, w, h)) continue;
      placed.push([x, y, w, h]);
      if (main) {
        ctx.globalAlpha = 0.92; ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(x, y, w, h, square ? 0 : h / 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = ink;
      } else {
        ctx.globalAlpha = (focus || sel || isActive(p) ? 0.9 : zoomLabels) * (isActive(p) ? 1 : fog(p.d));
        ctx.fillStyle = focus || sel || isActive(p) ? ink : muted;
      }
      ctx.fillText(text, px, y + pad);
    }

    // A small x / y / z axis gizmo in the corner shows which way the graph is turned.
    if (!flat || cam.yaw || cam.pitch) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const ox = 32, oy = H - 32, L = 18;
      const axes = [["x", 1, 0, 0], ["y", 0, -1, 0], ["z", 0, 0, 1]].map(([name, x, y, z]) => {
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
        return { name, x: x1, y: y * cp - z1 * sp, d: y * sp + z1 * cp };
      }).sort((a, b) => b.d - a.d);
      ctx.font = `600 10px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 1.5; ctx.lineCap = "round";
      for (const a of axes) {
        ctx.globalAlpha = a.d > 0 ? 0.35 : 0.8;
        ctx.strokeStyle = ink; ctx.fillStyle = ink;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + a.x * L, oy + a.y * L); ctx.stroke();
        ctx.fillText(a.name, ox + a.x * (L + 7), oy + a.y * (L + 7));
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    raf = 0;
    if (alpha > 0.003) tick();
    const turning = settleCam();
    // Turn slowly while the layout settles, so the depth is obvious, until the user takes the camera.
    if (!flat && !userTurned && alpha > 0.02 && !drag && !hover) cam.yaw += 0.004;
    project();
    // A pane that was hidden (phone list view) has no size until shown, so keep easing until it fits.
    const fitting = !userMoved && fit();
    draw();
    if (alpha > 0.003 || drag || fitting || turning) raf = requestAnimationFrame(frame);
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
  let drag = null, pinch = null;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, x: view.x, y: view.y, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      if (drag?.node) drag.node.fixed = false;
      drag = null;
      return;
    }
    const pt = local(e), node = e.button === 0 && !e.shiftKey ? pick(pt) : null;
    // Background: orbit in 3D, pan in flat mode; shift, right or middle button always pans.
    const pan = flat || e.shiftKey || e.button === 1 || e.button === 2;
    drag = { node, pan, start: pt, last: pt, vx: view.x, vy: view.y, moved: false };
    if (node) { node.fixed = true; canvas.style.cursor = "grabbing"; }
  });
  canvas.addEventListener("pointermove", (e) => {
    const pt = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const k = Math.min(6, Math.max(0.1, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
      const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const wx = (pinch.c[0] - W / 2 - pinch.x) / pinch.k, wy = (pinch.c[1] - H / 2 - pinch.y) / pinch.k;
      view = { k, x: c[0] - W / 2 - wx * k, y: c[1] - H / 2 - wy * k };
      userMoved = true; kick(); return;
    }
    if (!drag) {
      const h = pick(pt);
      if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : "grab"; kick(); }
      return;
    }
    if (Math.hypot(pt[0] - drag.start[0], pt[1] - drag.start[1]) > 4) drag.moved = true;
    if (!drag.moved) { drag.last = pt; return; }
    if (drag.node) {
      [drag.node.x, drag.node.y, drag.node.z] = unproject(pt, drag.node.d);
      if (flat) drag.node.z = 0;
      hover = drag.node;
      alpha = Math.max(alpha, 0.25);
    } else if (drag.pan) {
      view.x = drag.vx + pt[0] - drag.start[0]; view.y = drag.vy + pt[1] - drag.start[1];
      userMoved = true;
    } else {
      cam.yaw += (pt[0] - drag.last[0]) * 0.008;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - (pt[1] - drag.last[1]) * 0.008));
      userTurned = true;
    }
    drag.last = pt;
    kick();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const d = drag; drag = null;
    if (d.node) d.node.fixed = false;
    canvas.style.cursor = hover ? "pointer" : "grab";
    if (d.node && !d.moved && e.type === "pointerup") onOpen(d.node);
    kick();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => { if (!drag && hover) { hover = null; kick(); } });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const pt = local(e), [wx, wy] = toScreen(pt);
    const k = Math.min(6, Math.max(0.1, view.k * Math.exp(-e.deltaY * 0.0015)));
    view = { k, x: pt[0] - W / 2 - wx * k, y: pt[1] - H / 2 - wy * k };
    userMoved = true; kick();
  }, { passive: false });

  const ro = new ResizeObserver(() => {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    kick();
  });
  ro.observe(host);
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", kick);
  kick();

  const api = {
    redraw: kick,
    fit() { picked = null; userMoved = false; legendPick = null; syncLegend(); kick(); },
    setFlat(on) {
      if (flat === !!on) return;
      flat = !!on;
      if (!flat) {   // puff the layout back out along z, and tilt the camera so the depth shows
        for (const p of N) p.vz += (Math.random() - 0.5) * 40;
        cam.yaw = 0.5; cam.pitch = -0.35; userTurned = false;
      }
      alpha = Math.max(alpha, 0.5); userMoved = false; kick();
    },
    // Lights up the nodes for which match(node) is true, with their neighbours, and frames them; returns their labels.
    focus(match) {
      const core = new Set(shown.filter((n) => match(n)).map((n) => n.i));
      legendPick = null; syncLegend();
      picked = core.size ? { core, near: new Set([...core].flatMap((i) => [i, ...N[i].nb]).filter((i) => !N[i].hidden)) } : null;
      userMoved = false; kick();
      return [...core].map((i) => N[i].label);
    },
    destroy() { cancelAnimationFrame(raf); raf = -1; ro.disconnect(); scheme.removeEventListener("change", kick); },
  };
  return api;
}
