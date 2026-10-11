// The short plants and the glowing hover plot (owner request, October 2026): a plant must not
// rise far into the plot behind it, and the hover plot must tint cleanly. Reads the PNG files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAMERA_PITCH_DEG } from '../src/config.js';
import { HOVER_SOURCE } from '../src/render3d/character-look.js';
import { png } from './png-read.js';

const META = JSON.parse(readFileSync(new URL('../assets/v3-meta.json', import.meta.url)));

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
