/**
 * Regenerates the toolbar icons — run with: node extension/icons/make-icons.mjs
 *
 * Chrome will not accept SVG for an extension icon, so the PNGs are committed. Generating
 * them from this script keeps the shapes editable instead of leaving four opaque binaries in
 * the tree with no source. Output is byte-for-byte stable across runs.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // per axis, so 16 coverage samples per pixel

const BACKGROUND = [255, 109, 99]; // --harper-orange
const GLYPH = [255, 255, 255];

/** Lightning bolt, in unit coordinates over the icon square. */
const BOLT = [
  [0.585, 0.075],
  [0.235, 0.545],
  [0.45, 0.545],
  [0.4, 0.925],
  [0.765, 0.44],
  [0.55, 0.44],
];

function insideRoundedRect(x, y, size, radius, inset) {
  const min = inset;
  const max = size - inset;
  if (x < min || y < min || x > max || y > max) return false;

  const left = min + radius;
  const right = max - radius;
  const top = min + radius;
  const bottom = max - radius;
  const cornerX = x < left ? left : x > right ? right : null;
  const cornerY = y < top ? top : y > bottom ? bottom : null;
  if (cornerX === null || cornerY === null) return true;
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function renderRgba(size) {
  const radius = size * 0.235;
  const inset = size >= 48 ? size * 0.03 : 0;
  const bolt = BOLT.map(([x, y]) => [x * size, y * size]);
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // Premultiplied accumulation keeps the rounded corners from fringing.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          if (!insideRoundedRect(x, y, size, radius, inset)) continue;
          const colour = insidePolygon(x, y, bolt) ? GLYPH : BACKGROUND;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }

      const total = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      const alpha = a / total;
      if (alpha > 0) {
        // Un-premultiply back to straight alpha for the PNG.
        const scale = a / 255;
        pixels[offset] = Math.round(r / scale);
        pixels[offset + 1] = Math.round(g / scale);
        pixels[offset + 2] = Math.round(b / scale);
      }
      pixels[offset + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = dirname(fileURLToPath(import.meta.url));
for (const size of SIZES) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, renderRgba(size)));
  console.log(`wrote icon-${size}.png`);
}
