// Generates the PWA icons. No image libraries: rasterise into an RGBA buffer
// and write a minimal PNG. Run with `node scripts/make-icons.mjs`.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const BG = [13, 17, 23, 255];
const FG = [57, 217, 138, 255];
const DIM = [230, 237, 243, 255];

function canvas(size) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set(BG, i * 4);
  return {
    px,
    size,
    rect(x, y, w, h, color) {
      for (let j = Math.max(0, y | 0); j < Math.min(size, (y + h) | 0); j++) {
        for (let i = Math.max(0, x | 0); i < Math.min(size, (x + w) | 0); i++) {
          this.px.set(color, (j * size + i) * 4);
        }
      }
    },
    // Finder pattern: filled ring with a solid core, like a QR corner marker.
    finder(x, y, s, color) {
      const unit = s / 7;
      this.rect(x, y, s, s, color);
      this.rect(x + unit, y + unit, s - 2 * unit, s - 2 * unit, BG);
      this.rect(x + 2 * unit, y + 2 * unit, s - 4 * unit, s - 4 * unit, color);
    },
  };
}

function draw(size, inset) {
  const c = canvas(size);
  const pad = size * inset;
  const span = size - 2 * pad;
  const finder = span * 0.34;
  const unit = finder / 7;

  c.finder(pad, pad, finder, FG);
  c.finder(size - pad - finder, pad, finder, FG);
  c.finder(pad, size - pad - finder, finder, FG);

  // A curved column of modules: the cylinder the scanner is built for.
  const cx = size - pad - finder * 0.55;
  const top = size - pad - finder;
  for (let k = 0; k < 5; k++) {
    const t = k / 4;
    const bend = Math.sin(t * Math.PI) * unit * 1.6;
    c.rect(cx - unit / 2 - bend, top + t * (finder - unit), unit, unit, k % 2 ? DIM : FG);
  }
  // Timing dots along the top edge.
  for (let k = 0; k < 4; k++) {
    c.rect(pad + finder + unit * (1 + k * 2), pad + finder / 2 - unit / 2, unit, unit, DIM);
  }
  return c;
}

function png(canvasObj) {
  const { px, size } = canvasObj;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr(size)),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

function ihdr(size) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(size, 0);
  b.writeUInt32BE(size, 4);
  b[8] = 8; // bit depth
  b[9] = 6; // RGBA
  return b;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon-192.png"), png(draw(192, 0.12)));
writeFileSync(join(OUT, "icon-512.png"), png(draw(512, 0.12)));
// Maskable icons get cropped to a circle, so keep art inside the safe zone.
writeFileSync(join(OUT, "icon-maskable-512.png"), png(draw(512, 0.22)));
console.log("wrote icons to", OUT);
