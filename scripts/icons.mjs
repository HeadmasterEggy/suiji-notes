// Draws the app icon (green square, three paper lines) as PNG without any image library.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const bg = [0x11, 0x11, 0x11], fg = [0xff, 0xff, 0xff];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const lines = [[0.30, 0.70], [0.30, 0.70], [0.30, 0.56]];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let col = bg;
      lines.forEach(([a, b], i) => {
        const cy = 0.36 + i * 0.14;
        if (Math.abs(v - cy) < 0.035 && u > a && u < b) col = fg;
      });
      raw.set(col, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync("public/icon-180.png", png(180));
writeFileSync("public/icon-512.png", png(512));
writeFileSync("public/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#111111"/><g stroke="#ffffff" stroke-width="7" stroke-linecap="round"><path d="M30 36h40M30 50h40M30 64h26"/></g></svg>`);
console.log("icons written");
