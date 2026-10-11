// The short plants and the glowing hover plot (owner request, October 2026): a plant must not
// rise far into the plot behind it, and the hover plot must tint cleanly. Reads the PNG files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CAMERA_PITCH_DEG } from '../src/config.js';
import { HOVER_SOURCE } from '../src/render3d/character-look.js';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const META = JSON.parse(read('../assets/v3-meta.json'));

// An 8-bit RGBA PNG: { width, height, at(x, y) -> [r, g, b, a] }.
function png(path) {
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
  return { width, height, at: (x, y) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) };
}

const FRAME_W = 36;
const FRAMES = 5;
const STAGE_OPEN = 3;
const STAGE_REST = 4;
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// The first row of frame `f` that has an opaque pixel.
function topRow(sheet, f) {
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < FRAME_W; x++) if (sheet.at(f * FRAME_W + x, y)[3] > 0) return y;
  }
  return -1;
}

test('a grown plant rises at most one plot row above its root, so it never hides which plot it is in', () => {
  // One plot row on the screen, in art pixels: a plot is 32 art pixels across and the camera looks
  // down CAMERA_PITCH_DEG, so its depth shows sin(pitch) as long (the sprites are stretched to square pixels).
  const plotRowPx = 32 * Math.sin((CAMERA_PITCH_DEG * Math.PI) / 180);
  for (const name of ['plant-x', 'plant-o']) {
    const sheet = png(`../assets/3d/v3/${name}.png`);
    assert.equal(sheet.width, FRAME_W * FRAMES, name);
    const anchorRow = META[name].anchor[1];
    for (const stage of [STAGE_OPEN, STAGE_REST]) {
      const top = topRow(sheet, stage);
      assert.ok(top >= 0, `${name} frame ${stage} is not empty`);
      const above = anchorRow - top;
      assert.ok(above <= plotRowPx, `${name} frame ${stage} stands ${above} px over its root; a plot row is ${plotRowPx.toFixed(1)} px`);
    }
    // the growth still goes up: the bud is not taller than the flower is wide
    assert.ok(topRow(sheet, STAGE_REST) <= topRow(sheet, STAGE_REST - 2), `${name} grows upward`);
  }
});

test('the glowing hover plot tints cleanly: the frame is the swapped colour, the glow is plain white', () => {
  const decal = png('../assets/3d/v3/decal-hover.png');
  assert.equal(decal.width, 32);
  assert.equal(decal.height, 32);
  const main = hexToRgb(HOVER_SOURCE);
  let frame = 0;
  let glow = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const [r, g, b, a] = decal.at(x, y);
      if (a === 0) continue;
      const isMain = r === main[0] && g === main[1] && b === main[2];
      const isWhite = r === 255 && g === 255 && b === 255;
      assert.ok(isMain || isWhite, `(${x}, ${y}) is ${r},${g},${b}: only the swapped colour and white`);
      // a partly see-through pixel must be white: a canvas cannot keep a partly see-through colour exactly
      if (a < 255) assert.ok(isWhite, `(${x}, ${y}) is see-through and must be white`);
      if (isMain) frame++;
      else glow++;
    }
  }
  assert.ok(frame >= 100, `a bold frame (${frame} px)`);
  assert.ok(glow >= 300, `a glow inside it (${glow} px)`);
  // the frame is two px thick on all four sides, and the middle is lit but never opaque
  for (const [x, y] of [[16, 1], [16, 2], [16, 29], [16, 30], [1, 16], [2, 16], [29, 16], [30, 16]]) {
    assert.deepEqual(decal.at(x, y), [...main, 255], `frame at (${x}, ${y})`);
  }
  const centre = decal.at(16, 16);
  assert.ok(centre[3] > 0 && centre[3] < 255, 'the centre glows a little, the soil still shows');
});
