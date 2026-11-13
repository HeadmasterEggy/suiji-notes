// A small vault for the test harness: a few folders and documents that use every common Markdown element.
const KITCHEN_SINK = `# Week01 概览

Intro paragraph with **bold**, *italic*, \`inline code\`, a [link](https://example.com), a [[Week02]] wiki link,
an [anchor](#表格) and an inline formula $E = mc^2$。

## 列表

- one
- two
  - nested
1. first
2. second
10. tenth

- [ ] open task
- [x] done task

> A quote
> over two lines.

## 表格

| a | b |
|---|---|
| 1 | 2 |

\`\`\`js
const x = 1;
\`\`\`

$$\\int_0^1 x\\,dx = \\tfrac12$$

#### 四级标题

#tag-one #标签
`;

export function fixture() {
  const now = "2026-11-13T00:00:00Z";
  const docs = [
    ["f1", "COMP5318", "Week01.md", KITCHEN_SINK, ["Week02.md"], ["tag-one", "标签"]],
    ["f2", "COMP5318", "Week02.md", "# Week02\n\nBack to [[Week01]].\n", ["Week01.md"], []],
    ["f3", "Notes", "README.md", "# README\n\nPlain text.\n", [], []],
  ];
  const files = docs.map(([id, folder, name, body, links, tags]) => ({
    id, name, folder, path: `u1/${folder}/${name}`, size: new TextEncoder().encode(body).length, mime: "text/markdown",
    created_at: now, updated_at: now, links, tags, local_key: null,
  }));
  return {
    tables: { files, notes: [] },
    blobs: Object.fromEntries(docs.map(([, folder, name, body]) => [`u1/${folder}/${name}`, body])),
  };
}
