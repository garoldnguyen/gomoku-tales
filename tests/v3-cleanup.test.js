// The Farmland v3 cleanup (docs/art-direction-v3.md sections 2 and 12):
// the old wood board, pot pieces, sprite clouds and wind streaks are gone,
// and the only wood left is the curb and the fence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ART, artNames } from '../src/render3d/art-assets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The wood and parchment colours of the old signboard screens and panels.
const WOOD = /#(?:a8703c|5a3418|e8c08a|c48a50|c49a64|f6d8a8|3a2410|fff6e0|7a4a22|d9a066|8a5a2b)\b/i;

test('the DOM screens and the glass HUD have no wood and use the one UI font', () => {
  for (const path of ['src/ui/screens.css', 'src/ui/hud.css']) {
    const css = read(path);
    assert.doesNotMatch(css, WOOD, `${path} has a wood colour`);
    assert.doesNotMatch(css, /monospace/, `${path} uses another font`);
    assert.match(css, /"Jost"/, `${path} uses Jost`);
  }
});

test('the retired 3D modules are gone and nothing in src imports them', () => {
  assert.ok(!existsSync(new URL('../src/render3d/decal-art.js', import.meta.url)), 'decal-art.js (the wood board top) is gone');
  const dir = new URL('../src/render3d/', import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const code = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(code, /decal-art\.js|drawBoardTop|stoneGrid|cloudGrid|flowerGrid|createWindStreaks/, `${file} uses retired code`);
  }
});

test('in 3D the only wooden art is the curb and the fence', () => {
  const wooden = artNames(ART).filter((name) => /wood|board-top|plank/.test(name));
  assert.deepEqual(wooden, [ART.v3.curb]);
  assert.deepEqual(artNames(ART.v3.board), ['farm-board', 'farm-board-low'], 'the board is the farm field');
  assert.ok(artNames(ART).includes(ART.v3.fencePost) && artNames(ART).includes(ART.v3.fenceRail));
});
