/**
 * Generates the Ion icon at any size.
 *
 * Self-contained: only Node built-ins, no dependencies, so the asset is fully
 * reproducible and no third-party artwork is involved.
 *
 * Usage:
 *   node assets/generate.mjs                                   # 64px → assets/icon.png
 *   node assets/generate.mjs --size 1024 --out build/icon.png  # packaging master
 *
 * The drawing is scale-free, so the 64px tray icon and the 1024px packaging
 * master are one shape rather than two artworks to keep in sync. The default
 * invocation is unchanged, so the shipped tray icon stays byte-identical.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SIZE = 64;
const SS = 4; // supersampling factor

const BLURPLE = [0x58, 0x65, 0xf2, 255];
const WHITE = [255, 255, 255, 255];

/** `--size N --out path`; the 64px tray icon stays the default. */
function parseArgs(argv) {
  let size = DEFAULT_SIZE;
  const here = dirname(fileURLToPath(import.meta.url));
  let out = join(here, "icon.png");
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--size") size = Number(argv[++i]);
    else if (argv[i] === "--out") out = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(size) || size < 16 || size > 4096) {
    throw new Error(`--size must be an integer in [16, 4096], got ${String(size)}`);
  }
  return { size, out };
}

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

/** Renders the icon at `size` and returns a PNG buffer. */
function png(size) {
  // Supersample, then average each SS×SS block into one pixel, so the shape
  // holds up at 64px and at 1024px alike.
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const sampleX = (px + (sx + 0.5) / SS) / size;
          const sampleY = (py + (sy + 0.5) / SS) / size;
          const color = sample(sampleX, sampleY);
          for (let c = 0; c < 4; c += 1) acc[c] += color[c];
        }
      }
      const out = (py * size + px) * 4;
      for (let c = 0; c < 4; c += 1) pixels[out + c] = Math.round(acc[c] / (SS * SS));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // compression, filter, interlace: 0

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const { size, out } = parseArgs(process.argv.slice(2));
// The packaging master lives in a gitignored build directory that only exists
// when packaging runs, so this makes the directory rather than failing on a
// path the caller reasonably assumed.
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png(size));
process.stdout.write(`wrote ${size}x${size} icon to ${out}\n`);
