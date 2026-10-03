// Regression test of Farmland v3 part 5c: on High, a resting X or O plant
// sways in calm wind. Its Rest frame has transparent rows on top, so the
// height fraction of the sway runs from the root row to the top visible
// row (not the top of the frame), and the top visible row reaches one art
// pixel of lean at the crest of the calm wave while the bottom never moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { SWAY_PERIOD_MS } from '../src/config.js';
import { STAGE_REST } from '../src/render3d/growth.js';
import { visibleTopRow } from '../src/render3d/sprite-frames.js';
import { plantSwayAmplitudePx, plantSwayLeanPx, swayAmplitudePx, swayLeanPx, swayRowFraction } from '../src/render3d/wind.js';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const META = JSON.parse(read('../assets/v3-meta.json'));
const FRAMES = 5;

// The alpha of every pixel of an 8-bit RGBA PNG (row by row, top first).
function pngAlpha(path) {
  const data = read(path);
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
  return { width, height, alphaAt: (x, y) => pixels[(y * width + x) * 4 + 3] };
}

for (const name of ['plant-x', 'plant-o']) {
  test(`${name}: the Rest frame sways one art pixel at the top in calm wind, its bottom never moves`, () => {
    const sheet = pngAlpha(`../assets/3d/v3/${name}.png`);
    const frameWidth = sheet.width / FRAMES;
    const rootRow = sheet.height - 1 - META[name].anchor[1];
    const topRow = visibleTopRow(sheet.alphaAt, frameWidth, sheet.height, STAGE_REST);
    // the finding: the Rest frame has transparent rows on top
    assert.ok(topRow < sheet.height - 1, `${name}: top visible row ${topRow}`);
    const visibleRows = [];
    for (let row = 0; row <= topRow; row++) {
      const y = sheet.height - 1 - row;
      for (let x = STAGE_REST * frameWidth; x < (STAGE_REST + 1) * frameWidth; x++) {
        if (sheet.alphaAt(x, y) >= 128) {
          visibleRows.push(row);
          break;
        }
      }
    }
    const bottomRow = visibleRows[0];
    assert.equal(visibleRows.at(-1), topRow);
    assert.equal(swayRowFraction(topRow, sheet.height, rootRow, topRow), 1);

    const calm = plantSwayAmplitudePx(0);
    assert.equal(calm, swayAmplitudePx(0) / 2, 'half the meadow amplitude');
    for (const phase of [0, 1.3, 4]) {
      let topMax = 0;
      let topSum = 0;
      let meadowSum = 0;
      for (let t = 0; t < SWAY_PERIOD_MS; t++) {
        let below = 0;
        for (const row of visibleRows) {
          const lean = plantSwayLeanPx(swayRowFraction(row, sheet.height, rootRow, topRow), phase, t, calm);
          assert.ok(Number.isInteger(lean) && lean >= 0 && lean <= 1, `${name} row ${row}: ${lean}`);
          assert.ok(lean >= below, `${name} row ${row}: lean never shrinks going up`);
          below = lean;
          if (row === bottomRow) assert.equal(lean, 0, `${name}: the bottom visible row never moves`);
          if (row === topRow) {
            topMax = Math.max(topMax, lean);
            topSum += lean;
          }
        }
        meadowSum += swayLeanPx(1, phase, t, swayAmplitudePx(0));
      }
      assert.equal(topMax, 1, `${name} phase ${phase}: the top visible row leans one art pixel`);
      const plant = topSum / SWAY_PERIOD_MS;
      const meadow = meadowSum / SWAY_PERIOD_MS;
      assert.ok(Math.abs(plant - meadow / 2) < 0.02, `${name}: plant ${plant}, meadow ${meadow}`);
    }
  });
}

test('the swaying sprite shader spans its sway from the root to the top visible row', () => {
  const sprites = read('../src/render3d/sprites.js').toString();
  assert.match(sprites, /topRow: sheetTopRow\(sheet, frameWidth, swayFrame\)/);
  assert.match(sprites, /Math\.max\(topRow - rootRow, 1\)/);
});

test('visibleTopRow finds the highest visible row of one frame', () => {
  // two frames 2 x 4; frame 0 has its top pixel on row 1 from the top,
  // frame 1 is empty
  const alpha = [
    0, 0, 0, 0,
    0, 255, 0, 0,
    0, 0, 0, 0,
    255, 0, 0, 0,
  ];
  const alphaAt = (x, y) => alpha[y * 4 + x];
  assert.equal(visibleTopRow(alphaAt, 2, 4, 0), 2);
  assert.equal(visibleTopRow(alphaAt, 2, 4, 1), 3);
  assert.equal(swayRowFraction(2, 4, 0, 2), 1);
  assert.equal(swayRowFraction(1, 4, 0, 2), 0.5);
  assert.equal(swayRowFraction(3, 4), 1);
});
