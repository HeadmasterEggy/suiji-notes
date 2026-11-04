// Relationship graph, Obsidian-style. Nodes are notes and Markdown files (and optionally tags), edges are
// [[links]]. A small force simulation lays them out on a canvas: drag the background to pan, scroll or
// pinch to zoom, drag a node to move it, hover to light up its neighbours, click to open it.
//
//   const g = mountGraph(host, { nodes: [{label, kind, ref}], edges: [[i, j]] }, { onOpen(node), isActive(node) })
//   g.redraw()    after the active set changes
//   g.destroy()   before the host is thrown away
export function mountGraph(host, data, { onOpen, isActive }) {
  const canvas = document.createElement("canvas");
  canvas.className = "graph-canvas";
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const N = data.nodes.map((n, i) => ({ ...n, i, x: 0, y: 0, vx: 0, vy: 0, deg: 0, nb: new Set(), fixed: false }));
  const E = data.edges.filter(([a, b]) => a !== b);
  for (const [a, b] of E) { N[a].deg++; N[b].deg++; N[a].nb.add(b); N[b].nb.add(a); }
  // Seed on a sunflower spiral so the first frames already look tidy.
  N.forEach((n, i) => { const r = 14 * Math.sqrt(i + 0.5), t = i * 2.39996; n.x = r * Math.cos(t); n.y = r * Math.sin(t); });
  // Size grows with links but is capped, so one hub note does not cover its neighbours.
  const radius = (n) => n.kind === "tag" ? 2.5 + Math.min(Math.sqrt(n.deg), 6) * 0.6 : 2.5 + Math.min(Math.sqrt(n.deg), 9) * 0.9;
  const edgeAlpha = E.length > 400 ? 0.16 : 0.35;

  let W = 0, H = 0, dpr = 1, raf = 0, alpha = 1;
  let view = { x: 0, y: 0, k: 1 }, userMoved = false, hover = null;

  // ---------- simulation ----------
  function tick() {
    const n = N.length;
    for (let i = 0; i < n; i++) {
      const a = N[i];
      for (let j = i + 1; j < n; j++) {
        const b = N[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 160000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = (130 * alpha) / d2;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const [ia, ib] of E) {
      const a = N[ia], b = N[ib];
      // Clamp the distance: two linked nodes almost on top of each other would otherwise get a huge kick.
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 4);
      const s = ((d - 60) / d) * alpha * 0.5 / Math.min(a.deg, b.deg);
      a.vx += dx * s; a.vy += dy * s; b.vx -= dx * s; b.vy -= dy * s;
    }
    for (const p of N) {
      p.vx -= p.x * 0.012 * alpha; p.vy -= p.y * 0.012 * alpha;
      if (p.fixed) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.6; p.vy *= 0.6;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 30) { p.vx *= 30 / v; p.vy *= 30 / v; }
      if (!Number.isFinite(p.x + p.vx + p.y + p.vy)) { p.vx = p.vy = 0; p.x = Math.random() * 10; p.y = Math.random() * 10; }
      p.x += p.vx; p.y += p.vy;
    }
    alpha *= 0.985;
  }

  // Eases the view toward showing everything; returns true while it is still moving.
  function fit() {
    if (!N.length || !W) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of N) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const k = Math.min(W / (x1 - x0 + 80), H / (y1 - y0 + 80), 2.5);
    if (!Number.isFinite(k) || k <= 0) return false;
    const tx = -((x0 + x1) / 2) * k, ty = -((y0 + y1) / 2) * k;
    view.k += (k - view.k) * 0.2; view.x += (tx - view.x) * 0.2; view.y += (ty - view.y) * 0.2;
    return Math.abs(k - view.k) > k * 0.005 || Math.abs(tx - view.x) > 0.5 || Math.abs(ty - view.y) > 0.5;
  }

  // ---------- drawing ----------
  // Each style can restyle the graph through CSS variables (style.css): --g-node and --g-edge colours,
  // --g-edge-w (line width), --g-glow (blur in px), --g-shape: square, --g-outline (node border).
  function draw() {
    const cs = getComputedStyle(host), v = (n) => cs.getPropertyValue(n).trim();
    const ink = v("--ink") || "#111", muted = v("--muted") || "#888";
    const bg = v("--bg") || "#fff";
    const node = v("--g-node") || muted, edge = v("--g-edge") || muted, ew = +v("--g-edge-w") || 1;
    const glow = +v("--g-glow") || 0, square = v("--g-shape") === "square", outline = v("--g-outline");
    const dot = (x, y, r) => { ctx.beginPath(); if (square) ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2); };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);
    const focus = hover, lit = focus ? focus.nb : null;

    ctx.lineWidth = ew / view.k;
    ctx.lineCap = square ? "square" : "butt";
    ctx.strokeStyle = edge;
    ctx.globalAlpha = focus ? edgeAlpha * 0.35 : edgeAlpha;
    ctx.beginPath();
    for (const [a, b] of E) { if (focus && (a === focus.i || b === focus.i)) continue; ctx.moveTo(N[a].x, N[a].y); ctx.lineTo(N[b].x, N[b].y); }
    ctx.stroke();
    if (focus) {
      // A hub has hundreds of links; drawing them all solid turns into a white burst.
      ctx.globalAlpha = focus.nb.size > 40 ? 0.3 : focus.nb.size > 12 ? 0.55 : 0.9;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2 * ew / view.k;
      ctx.beginPath();
      for (const j of focus.nb) { ctx.moveTo(focus.x, focus.y); ctx.lineTo(N[j].x, N[j].y); }
      ctx.stroke();
    }

    if (glow) { ctx.shadowColor = node; ctx.shadowBlur = glow; }
    for (const p of N) {
      const on = p === focus || (lit && lit.has(p.i)), active = isActive(p);
      ctx.globalAlpha = focus && !on ? 0.25 : 1;
      const r = radius(p);
      dot(p.x, p.y, r);
      if (p.kind === "tag") { ctx.lineWidth = 1.2 / view.k; ctx.strokeStyle = on ? ink : node; ctx.fillStyle = bg; ctx.fill(); ctx.stroke(); }
      else {
        ctx.fillStyle = on || active ? ink : node; ctx.fill();
        if (outline) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = outline; ctx.stroke(); }
      }
      if (active) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = ink; dot(p.x, p.y, r + 3 / view.k); ctx.stroke(); }
    }
    ctx.shadowBlur = 0;

    // Labels never overlap. They are placed in priority order — hovered node, open files, then the
    // best-connected neighbours (or, when zoomed in, the best-connected nodes on screen) — and any label
    // that would collide with one already placed is skipped.
    const fs = 11 / view.k, pad = 3 / view.k, font = cs.getPropertyValue("--font-body") || "sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const zoomLabels = Math.min(1, Math.max(0, (view.k - 1.1) / 0.6));
    const byDeg = (a, b) => b.deg - a.deg;
    const order = [];
    if (focus) order.push(focus);
    order.push(...N.filter((p) => p !== focus && isActive(p)));
    if (focus) order.push(...[...focus.nb].map((j) => N[j]).sort(byDeg).slice(0, 30));
    else if (zoomLabels > 0.02) order.push(...[...N].sort(byDeg));
    const [vx0, vy0] = toWorld([0, 0]), [vx1, vy1] = toWorld([W, H]);
    const placed = [], seen = new Set();
    const free = (x, y, w, h) => !placed.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
    for (const p of order) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      const main = p === focus;
      ctx.font = `${main ? 600 : 400} ${main ? fs * 1.15 : fs}px ${font}`;
      const max = main ? 48 : 22;
      const text = p.label.length > max ? p.label.slice(0, max - 1) + "…" : p.label;
      const w = ctx.measureText(text).width + pad * 2, h = (main ? fs * 1.15 : fs) + pad * 2;
      const x = p.x - w / 2, y = p.y + radius(p) + 2 / view.k;
      if (!main && !free(x, y, w, h)) continue;
      placed.push([x, y, w, h]);
      if (main) {
        ctx.globalAlpha = 0.92; ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(x, y, w, h, square ? 0 : h / 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = ink;
      } else {
        ctx.globalAlpha = focus || isActive(p) ? 0.9 : zoomLabels;
        ctx.fillStyle = focus || isActive(p) ? ink : muted;
      }
      ctx.fillText(text, p.x, y + pad);
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    raf = 0;
    if (alpha > 0.003) tick();
    // A pane that was hidden (phone list view) has no size until shown, so keep easing until it fits.
    const fitting = !userMoved && fit();
    draw();
    if (alpha > 0.003 || drag || fitting) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // ---------- interaction ----------
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toWorld = ([px, py]) => [(px - W / 2 - view.x) / view.k, (py - H / 2 - view.y) / view.k];
  function pick(pt) {
    const [wx, wy] = toWorld(pt);
    let best = null, bd = Infinity;
    for (const p of N) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < radius(p) + 6 / view.k && d < bd) { best = p; bd = d; }
    }
    return best;
  }
  const pointers = new Map();
  let drag = null, pinch = null;
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
    const pt = local(e), node = pick(pt);
    drag = { node, start: pt, vx: view.x, vy: view.y, moved: false };
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
    if (!drag.moved) return;
    if (drag.node) {
      [drag.node.x, drag.node.y] = toWorld(pt);
      hover = drag.node;
      alpha = Math.max(alpha, 0.25);
    } else {
      view.x = drag.vx + pt[0] - drag.start[0]; view.y = drag.vy + pt[1] - drag.start[1];
      userMoved = true;
    }
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
    const pt = local(e), [wx, wy] = toWorld(pt);
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

  return {
    redraw: kick,
    fit() { userMoved = false; kick(); },
    destroy() { cancelAnimationFrame(raf); raf = -1; ro.disconnect(); scheme.removeEventListener("change", kick); },
  };
}
