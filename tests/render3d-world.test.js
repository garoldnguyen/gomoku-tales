import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOARD_SIZE, INTERNAL_HEIGHT, INTERNAL_WIDTH,
} from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION } from '../src/logic/skills.js';
import { HUD_2D, panelRect, skillButtonRect } from '../src/render/layout.js';
import { boardMarks } from '../src/render3d/board-marks.js';
import { gameCamera, projectToNdc } from '../src/render3d/camera.js';
import { createWorldHitTest } from '../src/render3d/hit-test.js';
import { hitTest, isQualityKey, skillHitTest } from '../src/ui/input.js';
import { createLocalGame } from '../src/ui/local-game.js';

const CAMERA = gameCamera(16 / 9);
const worldHitTest = createWorldHitTest(CAMERA);

// --- HUD layout ---

test('the 2D HUD layout is unchanged by the layout parameter', () => {
  for (const player of [X, O]) {
    assert.deepEqual(panelRect(player), panelRect(player, HUD_2D));
    assert.deepEqual(skillButtonRect(player, 1), skillButtonRect(player, 1, HUD_2D));
  }
});

// --- Hit testing ---

test('the 3D hit test only finds board cells: skills are DOM buttons on the glass HUD', () => {
  for (let py = 0; py < INTERNAL_HEIGHT; py += 6) {
    for (let px = 0; px < INTERNAL_WIDTH; px += 6) {
      const hit = worldHitTest(px, py);
      assert.ok(hit === null || (hit.cell && !hit.skill), `${px}, ${py}`);
    }
  }
  assert.equal(worldHitTest(2, 2), null, 'the sky corner is nothing');
});

test('the 3D hit test reaches every board cell by raycast, with the centre in the middle', () => {
  const centre = projectToNdc({ x: 0, y: 0, z: 0 }, CAMERA); // the board centre, just below the screen's middle
  const hud = (ndc) => [((ndc.x + 1) / 2) * INTERNAL_WIDTH, ((1 - ndc.y) / 2) * INTERNAL_HEIGHT];
  assert.deepEqual(worldHitTest(...hud(centre)), { cell: { x: 7, y: 7 } });
  const seen = new Set();
  for (let py = 0; py < INTERNAL_HEIGHT; py += 2) {
    for (let px = 0; px < INTERNAL_WIDTH; px += 2) {
      const hit = worldHitTest(px, py);
      if (hit?.cell) seen.add(`${hit.cell.x},${hit.cell.y}`);
    }
  }
  assert.equal(seen.size, BOARD_SIZE * BOARD_SIZE);
  // Row 0 is the far edge, so it is higher on screen than the last row.
  const top = worldHitTest(INTERNAL_WIDTH / 2, 180);
  const bottom = worldHitTest(INTERNAL_WIDTH / 2, 475);
  assert.equal(top.cell.y, 0);
  assert.equal(bottom.cell.y, BOARD_SIZE - 1);
});

test('skillHitTest with the 2D layout matches the 2D hitTest', () => {
  const r = skillButtonRect(O, 1);
  assert.deepEqual(skillHitTest(r.x + 3, r.y + 3, HUD_2D), hitTest(r.x + 3, r.y + 3));
  assert.equal(skillHitTest(5, 5, HUD_2D), null);
});

test('Q is the quality key, but not with a modifier', () => {
  assert.equal(isQualityKey({ key: 'q' }), true);
  assert.equal(isQualityKey({ key: 'Q' }), true);
  assert.equal(isQualityKey({ key: 'q', ctrlKey: true }), false);
  assert.equal(isQualityKey({ key: 'r' }), false);
});

// --- Board marks for the 3D board ---

function kinds(marks) {
  return marks.decals.map((d) => `${d.kind}@${d.x},${d.y}`).sort();
}

test('hovering an empty cell shows a ghost stone of the player to move', () => {
  const game = createLocalGame();
  game.setHover({ x: 7, y: 7 });
  assert.deepEqual(boardMarks(game.getView()), { decals: [], ghost: { kind: X, x: 7, y: 7 } });
  game.click({ x: 7, y: 7 });
  game.setHover({ x: 7, y: 7 });
  assert.equal(boardMarks(game.getView()).ghost, null, 'no ghost on a taken cell');
  game.setHover({ x: 8, y: 8 });
  assert.deepEqual(boardMarks(game.getView()).ghost, { kind: O, x: 8, y: 8 });
});

test('the Wind Dash flow shows the select mark and target mark while choosing', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 });
  game.click({ x: 0, y: 0 });
  game.clickSkill(X, WIND_DASH);
  game.setHover({ x: 7, y: 7 });
  assert.deepEqual(kinds(boardMarks(game.getView())), ['select@7,7']);
  assert.equal(boardMarks(game.getView()).ghost, null);
  game.click({ x: 7, y: 7 });
  game.setHover({ x: 9, y: 9 });
  assert.deepEqual(kinds(boardMarks(game.getView())), ['dashTarget@9,9', 'select@7,7']);
  game.click({ x: 9, y: 9 });
  game.setHover(null);
  // The announced dash is shown by the skill visuals (effects3d.js) from its event.
  assert.deepEqual(kinds(boardMarks(game.getView())), []);
});

test('the Tornado Zone flow previews the clipped zone while choosing the centre', () => {
  const game = createLocalGame();
  game.clickSkill(X, TORNADO_ZONE);
  game.setHover({ x: 0, y: 0 });
  assert.deepEqual(kinds(boardMarks(game.getView())), ['zonePreview@0,0', 'zonePreview@0,1', 'zonePreview@1,0', 'zonePreview@1,1']);
  game.click({ x: 0, y: 0 });
  game.setHover(null);
  // The announced zone is shown by the skill visuals (effects3d.js) from its event.
  assert.deepEqual(kinds(boardMarks(game.getView())), []);
});

test('Terrain Creation previews a ghost rock and Stone Conversion a select ring', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 });
  game.clickSkill(O, TERRAIN_CREATION);
  game.setHover({ x: 3, y: 3 });
  assert.deepEqual(boardMarks(game.getView()), { decals: [], ghost: { kind: 'rock', x: 3, y: 3 } });
  game.setHover({ x: 7, y: 7 });
  assert.deepEqual(boardMarks(game.getView()), { decals: [], ghost: null }, 'no rock on a stone');
  game.clickSkill(O, STONE_CONVERSION);
  assert.deepEqual(kinds(boardMarks(game.getView())), ['select@7,7']);
});

test('the winning line is marked and no ghost shows after the game ends', () => {
  const game = createLocalGame();
  for (let i = 0; i < 4; i++) {
    game.click({ x: i, y: 0 });
    game.click({ x: i, y: 5 });
  }
  game.click({ x: 4, y: 0 });
  game.setHover({ x: 10, y: 10 });
  const marks = boardMarks(game.getView());
  assert.deepEqual(kinds(marks), ['win@0,0', 'win@1,0', 'win@2,0', 'win@3,0', 'win@4,0']);
  assert.equal(marks.ghost, null);
});

test('pure 3D game helpers do not import Three.js', () => {
  for (const file of ['src/render3d/board-marks.js', 'src/render3d/hit-test.js', 'src/ui/input.js', 'src/render/layout.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]three/, file);
  }
});
