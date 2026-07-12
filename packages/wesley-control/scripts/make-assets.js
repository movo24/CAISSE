/**
 * Generates the placeholder icon.png / splash.png (solid brand background with
 * a geometric "W" mark) without any image dependency — pure Node (zlib + CRC).
 * Re-run with: node scripts/make-assets.js
 * Replace with the final The Wesley brand assets before store submission.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BG = [11, 18, 32]; // #0B1220 — fond sombre direction
const FG = [240, 200, 90]; // #F0C85A — or Wesley

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, pixelAt) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distance from point to segment, for stroke rendering. */
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** The "W" mark: 4 strokes inside a box centered at (cx, cy) of size s. */
function wMark(cx, cy, s) {
  const hw = s / 2;
  const top = cy - hw * 0.55;
  const bot = cy + hw * 0.55;
  const seg = [
    [cx - hw, top, cx - hw * 0.5, bot],
    [cx - hw * 0.5, bot, cx, top + hw * 0.35],
    [cx, top + hw * 0.35, cx + hw * 0.5, bot],
    [cx + hw * 0.5, bot, cx + hw, top],
  ];
  const stroke = s * 0.09;
  return (x, y) => seg.some(([a, b, c, d]) => distSeg(x, y, a, b, c, d) <= stroke);
}

function writeImage(file, w, h, markSize) {
  const inW = wMark(w / 2, h / 2, markSize);
  const buf = png(w, h, (x, y) => (inW(x, y) ? FG : BG));
  fs.writeFileSync(file, buf);
  console.log(`${path.basename(file)} — ${w}x${h}, ${buf.length} bytes`);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
writeImage(path.join(out, 'icon.png'), 1024, 1024, 560);
writeImage(path.join(out, 'splash.png'), 1284, 2778, 420);
