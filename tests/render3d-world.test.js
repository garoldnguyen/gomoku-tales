import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOARD_SIZE, BOARD_THICKNESS, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CELL_SIZE, CHARACTER_X,
  INTERNAL_HEIGHT, INTERNAL_WIDTH,
} from '../src/config.js';
import { X, O } from '../src/logic/board.js';
import { WIND_DASH, TORNADO_ZONE, TERRAIN_CREATION, STONE_CONVERSION } from '../src/logic/skills.js';
import { HUD_2D, HUD_3D, panelRect, skillButtonRect } from '../src/render/layout.js';
import { boardMarks } from '../src/render3d/board-marks.js';
import { cameraPosition, cameraRay } from '../src/render3d/camera.js';
import { cellAtHudPoint, createWorldHitTest } from '../src/render3d/hit-test.js';
import { intersectHorizontalPlane, pointerToNdc } from '../src/render3d/picking.js';
import { hitTest, isQualityKey, skillHitTest } from '../src/ui/input.js';
import { createLocalGame } from '../src/ui/local-game.js';

const TARGET = { x: 0, y: 0, z: 0 };
const CAMERA = {
  position: cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE, TARGET),
  target: TARGET,
  fovDeg: CAMERA_FOV,
  aspect: 16 / 9,
};
const HUD_RECT = { left: 0, top: 0, width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT };
const worldHitTest = createWorldHitTest(CAMERA);

// Where the ray through an internal HUD point meets the plane y = planeY.
function groundAt(px, py, planeY) {
  const ndc = pointerToNdc(px, py, HUD_RECT);
  const ray = cameraRay(ndc.x, ndc.y, CAMERA);
  return intersectHorizontalPlane(ray.origin, ray.direction, planeY);
}

function rectCorners({ x, y, w, h }) {
  return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
}

// --- HUD layout over the 3D world ---

test('the 3D HUD panels fit on screen and hold their skill buttons', () => {
  for (const player of [X, O]) {
    const panel = panelRect(player, HUD_3D);
    assert.ok(panel.x >= 0 && panel.x + panel.w <= INTERNAL_WIDTH, `${player} panel x`);
    assert.ok(panel.y >= 0 && panel.y + panel.h <= INTERNAL_HEIGHT, `${player} panel y`);
    const a = skillButtonRect(player, 0, HUD_3D);
    const b = skillButtonRect(player, 1, HUD_3D);
    for (const r of [a, b]) {
      assert.ok(r.x >= panel.x && r.x + r.w <= panel.x + panel.w);
      assert.ok(r.y >= panel.y && r.y + r.h <= panel.y + panel.h);
    }
    assert.ok(a.y + a.h <= b.y);
  }
  assert.ok(panelRect(X, HUD_3D).x + HUD_3D.panelW < panelRect(O, HUD_3D).x);
});

test('the 3D HUD panels cover neither the board nor the characters', () => {
  for (const player of [X, O]) {
    const panel = panelRect(player, HUD_3D);
    // No pixel of the panel looks onto the board.
    for (let py = panel.y; py <= panel.y + panel.h; py += 2) {
      for (let px = panel.x; px <= panel.x + panel.w; px += 2) {
        assert.equal(cellAtHudPoint(px, py, CAMERA), null, `${player} panel covers the board at ${px}, ${py}`);
      }
    }
    // The panel's top edge looks at the ground in front of the character's
    // feet (and its blob shadow), so the upright sprite above stays visible.
    for (const [px, py] of rectCorners(panel).slice(0, 2)) {
      const hit = groundAt(px, py, -BOARD_THICKNESS);
      assert.ok(hit.z > 1.2, `${player} panel top reaches back to z ${hit.z}`);
    }
    const side = player === X ? -1 : 1;
    assert.ok(Math.sign(groundAt(panel.x + panel.w / 2, panel.y, -BOARD_THICKNESS).x) === side);
    assert.ok(CHARACTER_X > (BOARD_SIZE * CELL_SIZE) / 2);
  }
});

test('the 3D status lines sit below the near edge of the board', () => {
  const halfBoard = (BOARD_SIZE * CELL_SIZE) / 2;
  for (const y of [HUD_3D.statusY - 10, HUD_3D.messageY - 8]) {
    // Below the front face of the slab, not over the board top.
    const hit = groundAt(INTERNAL_WIDTH / 2, y, -BOARD_THICKNESS);
    assert.ok(hit.z > halfBoard, `row ${y} looks at z ${hit.z}`);
  }
  assert.ok(HUD_3D.messageY + 8 <= INTERNAL_HEIGHT);
});

test('the 2D HUD layout is unchanged by the layout parameter', () => {
  for (const player of [X, O]) {
    assert.deepEqual(panelRect(player), panelRect(player, HUD_2D));
    assert.deepEqual(skillButtonRect(player, 1), skillButtonRect(player, 1, HUD_2D));
  }
});

// --- Hit testing ---

test('the 3D hit test finds skill buttons on the HUD', () => {
  const cases = [[X, 0, WIND_DASH], [X, 1, TORNADO_ZONE], [O, 0, TERRAIN_CREATION], [O, 1, STONE_CONVERSION]];
  for (const [player, index, skillId] of cases) {
    const r = skillButtonRect(player, index, HUD_3D);
    for (const [px, py] of [[r.x, r.y], [r.x + r.w - 1, r.y + r.h - 1], [r.x + r.w / 2, r.y + r.h / 2]]) {
      assert.deepEqual(worldHitTest(px, py), { skill: { player, skillId } });
    }
  }
  assert.equal(worldHitTest(2, 2), null, 'the sky corner is nothing');
});

test('the 3D hit test reaches every board cell by raycast, with the centre in the middle', () => {
  assert.deepEqual(worldHitTest(INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2), { cell: { x: 7, y: 7 } });
  const seen = new Set();
  for (let py = 0; py < INTERNAL_HEIGHT; py += 2) {
    for (let px = 0; px < INTERNAL_WIDTH; px += 2) {
      const hit = worldHitTest(px, py);
      if (hit?.cell) seen.add(`${hit.cell.x},${hit.cell.y}`);
    }
  }
  assert.equal(seen.size, BOARD_SIZE * BOARD_SIZE);
  // Row 0 is the far edge, so it is higher on screen than the last row.
  const top = worldHitTest(INTERNAL_WIDTH / 2, 125);
  const bottom = worldHitTest(INTERNAL_WIDTH / 2, 465);
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

test('the Wind Dash flow shows the select ring, whirl and target frame, then the announcement', () => {
  const game = createLocalGame();
  game.click({ x: 7, y: 7 });
  game.click({ x: 0, y: 0 });
  game.clickSkill(X, WIND_DASH);
  game.setHover({ x: 7, y: 7 });
  assert.deepEqual(kinds(boardMarks(game.getView())), ['select@7,7']);
  assert.equal(boardMarks(game.getView()).ghost, null);
  game.click({ x: 7, y: 7 });
  game.setHover({ x: 9, y: 9 });
  assert.deepEqual(kinds(boardMarks(game.getView())), ['dashTarget@9,9', 'select@7,7', 'whirl@7,7']);
  game.click({ x: 9, y: 9 });
  game.setHover(null);
  assert.deepEqual(kinds(boardMarks(game.getView())), ['dashTarget@9,9', 'whirl@7,7']);
});

test('the Tornado Zone flow previews the clipped zone, then shows the announced zone', () => {
  const game = createLocalGame();
  game.clickSkill(X, TORNADO_ZONE);
  game.setHover({ x: 0, y: 0 });
  assert.deepEqual(kinds(boardMarks(game.getView())), ['zonePreview@0,0', 'zonePreview@0,1', 'zonePreview@1,0', 'zonePreview@1,1']);
  game.click({ x: 0, y: 0 });
  game.setHover(null);
  assert.deepEqual(kinds(boardMarks(game.getView())), ['zone@0,0', 'zone@0,1', 'zone@1,0', 'zone@1,1']);
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
