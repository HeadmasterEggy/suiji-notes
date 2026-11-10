// Links and tags of a Markdown file, for the relationship graph. Shared by the app and the Mac agent,
// so both store the same thing in files.links / files.tags.
//   links: [[target]] / [[target|alias]] / [[target#heading]] targets, plus relative links to .md files,
//          stored as written; the graph resolves them against file paths.
//   tags:  front matter `tags:` as a YAML list or [a, b].
export function mdMeta(src) {
  const tags = [], links = new Set();
  const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);   // as the preview reads it: a BOM is fine, "----" is not the end
  if (fm) {
    const lines = fm[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^tags:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const v = m[1].trim();
      if (/^\[.*\]$/.test(v)) tags.push(...v.slice(1, -1).split(","));
      else if (v) tags.push(v);
      else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) tags.push(lines[j].replace(/^\s*-\s+/, ""));
    }
  }
  const body = (fm ? src.slice(fm[0].length) : src).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, "");
  for (const m of body.matchAll(/\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) links.add(m[1].trim());
  for (const m of body.matchAll(/\]\((?!https?:|\/\/|#|mailto:)([^)\s]+?\.md)(?:#[^)]*)?\)/gi)) {
    try { links.add(decodeURI(m[1])); } catch { links.add(m[1]); }
  }
  const clean = (t) => t.trim().replace(/^["']|["']$/g, "");
  return { links: [...links].filter(Boolean).slice(0, 300), tags: [...new Set(tags.map(clean).filter(Boolean))].slice(0, 50) };
}
