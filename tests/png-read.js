// Test helper (not a test file): reads an 8-bit RGBA PNG of the repo under Node.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// An 8-bit RGBA PNG: { width, height, at(x, y) -> [r, g, b, a] }.
export function png(path) {
  const data = readFileSync(new URL(path, import.meta.url));
  let width = 0;
  let height = 0;
  const idat = [];
  for (let i = 8; i < data.length;) {
    const length = data.readUInt32BE(i);
    const type = data.toString('ascii', i + 4, i + 8);
    const body = data.subarray(i + 8, i + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8, `${path}: 8 bits per channel`);
      assert.equal(body[9], 6, `${path}: RGBA`);
    }
    if (type === 'IDAT') idat.push(body);
    i += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, at: (x, y) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) };
}

