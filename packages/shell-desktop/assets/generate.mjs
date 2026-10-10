/**
 * Generates the Ion tray/window icon (assets/icon.png).
 *
 * Self-contained: only Node built-ins, no dependencies, so the asset is fully
 * reproducible and no third-party artwork is involved.
 *
 * Usage: node assets/generate.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_SIZE = 64;
const SS = 4; // supersampling factor

const BLURPLE = [0x58, 0x65, 0xf2, 255];
const WHITE = [255, 255, 255, 255];

function inRoundedRect(x, y, radius) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = x < radius ? radius : x > 1 - radius ? 1 - radius : x;
  const cy = y < radius ? radius : y > 1 - radius ? 1 - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function inGlyph(x, y) {
  // Serif "I": crossbars top and bottom, narrow stem.
  const inBar = y >= 0.26 && y <= 0.37 && x >= 0.24 && x <= 0.76;
  const inStem = y > 0.37 && y < 0.63 && x >= 0.45 && x <= 0.55;
  const inFoot = y >= 0.63 && y <= 0.74 && x >= 0.24 && x <= 0.76;
  return inBar || inStem || inFoot;
}

function sample(x, y) {
  if (!inRoundedRect(x, y, 0.2)) return [0, 0, 0, 0];
  return inGlyph(x, y) ? WHITE : BLURPLE;
}

const pixels = Buffer.alloc(OUTPUT_SIZE * OUTPUT_SIZE * 4);
for (let py = 0; py < OUTPUT_SIZE; py++) {
  for (let px = 0; px < OUTPUT_SIZE; px++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const sampleX = (px + (sx + 0.5) / SS) / OUTPUT_SIZE;
        const sampleY = (py + (sy + 0.5) / SS) / OUTPUT_SIZE;
        const color = sample(sampleX, sampleY);
        for (let c = 0; c < 4; c++) acc[c] += color[c];
      }
    }
    const out = (py * OUTPUT_SIZE + px) * 4;
    for (let c = 0; c < 4; c++) pixels[out + c] = Math.round(acc[c] / (SS * SS));
  }
}

// -- PNG encoding -----------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUTPUT_SIZE, 0);
ihdr.writeUInt32BE(OUTPUT_SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// compression, filter, interlace: 0

const stride = OUTPUT_SIZE * 4;
const raw = Buffer.alloc((stride + 1) * OUTPUT_SIZE);
for (let y = 0; y < OUTPUT_SIZE; y++) {
  raw[y * (stride + 1)] = 0; // filter: none
  pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "icon.png");
writeFileSync(out, png);
process.stdout.write(`wrote ${OUTPUT_SIZE}x${OUTPUT_SIZE} icon to ${out}\n`);
