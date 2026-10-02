import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOARD_SIZE, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CELL_SIZE, CURB_PX, FENCE_OFFSET_CELLS,
  FENCE_POST_EVERY, PATH_WIDTH_CELLS, PX_WORLD,
} from '../src/config.js';
import { boardMarks, lastMoveOpacity, lastPlanted, winPulseOpacity } from '../src/render3d/board-marks.js';
import { cameraPosition, cameraRay } from '../src/render3d/camera.js';
import {
  CURB, CURB_SIDES, curbTopCorners, FENCE_RAIL_HEIGHTS, fencePosts, fenceRails, FIELD, fieldTexel, PATH, pathStones,
  zonePieceUv,
} from '../src/render3d/farm-layout.js';
import { cellAtHudPoint } from '../src/render3d/hit-test.js';
import { cellToWorld, pickCell } from '../src/render3d/picking.js';
import { TORNADO_ZONE } from '../src/logic/skills.js';
import { createLocalGame } from '../src/ui/local-game.js';

const TARGET = { x: 0, y: 0, z: 0 };
const CAMERA = {
  position: cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE, TARGET),
  target: TARGET,
  fovDeg: CAMERA_FOV,
  aspect: 16 / 9,
};
const HALF = (BOARD_SIZE * CELL_SIZE) / 2;
const STAGES = [0, 150, 450, 850, 1200];

// The four corners and the centre, with the world centre and the internal
// HUD point (960x540) that picked them before the farmland board.
const PINNED = [
  { cell: { x: 0, y: 0 }, world: { x: -7, z: -7 }, hud: [304, 126] },
  { cell: { x: 14, y: 0 }, world: { x: 7, z: -7 }, hud: [656, 126] },
  { cell: { x: 0, y: 14 }, world: { x: -7, z: 7 }, hud: [249, 459] },
  { cell: { x: 14, y: 14 }, world: { x: 7, z: 7 }, hud: [711, 459] },
  { cell: { x: 7, y: 7 }, world: { x: 0, z: 0 }, hud: [480, 270] },
];

test('cell numbering and raycast picking return the same cells for the corners and the centre', () => {
  for (const { cell, world, hud } of PINNED) {
    assert.deepEqual(cellToWorld(cell.x, cell.y), world, `centre of ${cell.x},${cell.y}`);
    assert.deepEqual(cellAtHudPoint(hud[0], hud[1], CAMERA), cell, `HUD point ${hud} picks ${cell.x},${cell.y}`);
    const direction = { x: world.x - CAMERA.position.x, y: -CAMERA.position.y, z: world.z - CAMERA.position.z };
    assert.deepEqual(pickCell(CAMERA.position, direction), cell, 'a ray at the plot centre picks it');
    // Rays at the four inner corners of the plot pick it too.
    for (const [ox, oz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      const ray = { x: world.x + ox - CAMERA.position.x, y: -CAMERA.position.y, z: world.z + oz - CAMERA.position.z };
      assert.deepEqual(pickCell(CAMERA.position, ray), cell);
    }
  }
  assert.deepEqual(cellAtHudPoint(480, 270, CAMERA), { x: 7, y: 7 });
  assert.deepEqual(pickCell(CAMERA.position, cameraRay(0, 0, CAMERA).direction), { x: 7, y: 7 });
});

test('the field lies on the picking plane and its plots line up with the picked cells', () => {
  assert.equal(FIELD.y, 0, 'the field top is the picking plane');
  assert.equal(FIELD.size, BOARD_SIZE * CELL_SIZE);
  const texturePx = 480; // farm-board and farm-board-low, 32 px per cell
  for (const { cell, world } of PINNED) {
    const texel = fieldTexel(world.x, world.z, texturePx);
    assert.deepEqual({ x: Math.floor(texel.u / 32), y: Math.floor(texel.v / 32) }, cell, 'plot under the cell centre');
    assert.deepEqual(texel, { u: cell.x * 32 + 16, v: cell.y * 32 + 16 }, 'the plot centre');
  }
  assert.equal(fieldTexel(-HALF - 0.01, 0, texturePx), null);
  assert.equal(fieldTexel(0, HALF, texturePx), null);
});

test('the curb is 8 art pixels wide, mitred, and rings the field just above the plots', () => {
  assert.equal(CURB.width, CURB_PX * PX_WORLD);
  assert.equal(CURB.inner, HALF);
  assert.ok(CURB.top > FIELD.y && CURB.top < 0.1, 'a little above the plots');
  assert.ok(CURB.top - CURB.faceHeight > CURB.ground, 'the wooden face ends above the meadow');
  const [innerStart, innerEnd, outerEnd, outerStart] = curbTopCorners();
  assert.deepEqual([innerStart.along, innerEnd.along], [-HALF, HALF]);
  assert.deepEqual([outerStart.along, outerEnd.along], [-(HALF + CURB.width), HALF + CURB.width]);
  // Each mitred corner is shared by two sides.
  const key = (p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`;
  const counts = new Map();
  for (const side of CURB_SIDES) {
    for (const c of curbTopCorners()) {
      const k = key(side.toWorld(c.along, c.across));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  assert.equal(counts.size, 8);
  for (const count of counts.values()) assert.equal(count, 2);
});

test('fence posts stand every 3 cells along the back, left and right, 1.5 cells outside the curb', () => {
  const line = HALF + CURB.width + FENCE_OFFSET_CELLS * CELL_SIZE;
  const posts = fencePosts();
  for (const post of posts) {
    const onBack = Math.abs(post.z + line) < 1e-9;
    const onSide = Math.abs(Math.abs(post.x) - line) < 1e-9;
    assert.ok(onBack || onSide, `post ${post.x},${post.z} is on the fence line`);
    assert.ok(post.z <= HALF + 1e-9, 'the front stays open');
  }
  const back = posts.filter((p) => Math.abs(p.z + line) < 1e-9 && Math.abs(Math.abs(p.x) - line) > 1e-9).map((p) => p.x).sort((a, b) => a - b);
  for (let i = 1; i < back.length; i++) assert.equal(back[i] - back[i - 1], FENCE_POST_EVERY * CELL_SIZE);
  assert.equal(new Set(posts.map((p) => `${p.x},${p.z}`)).size, posts.length, 'no post twice');
  const sides = fenceRails().map((run) => run.side).sort();
  assert.deepEqual(sides, ['back', 'left', 'right']);
  assert.equal(FENCE_RAIL_HEIGHTS.length, 2);
  assert.ok(FENCE_RAIL_HEIGHTS[0] < FENCE_RAIL_HEIGHTS[1]);
});

test('the dirt path leads from the front curb toward the camera with two stepping stones on it', () => {
  assert.equal(PATH.x, 0);
  assert.equal(PATH.width, PATH_WIDTH_CELLS * CELL_SIZE);
  assert.equal(PATH.startZ, HALF + CURB.width);
  assert.ok(PATH.endZ > PATH.startZ);
  const stones = pathStones();
  assert.equal(stones.length, 2);
  for (const stone of stones) {
    assert.ok(Math.abs(stone.x - PATH.x) < PATH.width / 2);
    assert.ok(stone.z > PATH.startZ && stone.z < PATH.endZ);
  }
});

test('the zone decal is cut into nine cell pieces that tile it exactly, far row on top', () => {
  let area = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const uv = zonePieceUv(dx, dy);
      assert.ok(uv.u0 >= 0 && uv.u1 <= 1 && uv.v0 >= 0 && uv.v1 <= 1);
      area += (uv.u1 - uv.u0) * (uv.v1 - uv.v0);
    }
  }
  assert.ok(Math.abs(area - 1) < 1e-9);
  const centre = zonePieceUv(0, 0);
  for (const [key, want] of [['u0', 1 / 3], ['u1', 2 / 3], ['v0', 1 / 3], ['v1', 2 / 3]]) {
    assert.ok(Math.abs(centre[key] - want) < 1e-9, `centre ${key}`);
  }
  assert.equal(zonePieceUv(-1, -1).v1, 1, 'the far row is the top of the image');
  assert.equal(zonePieceUv(-1, -1).u0, 0);
});

test('the Tornado Zone preview places each clipped cell inside the 3x3 zone decal', () => {
  const game = createLocalGame();
  game.clickSkill('X', TORNADO_ZONE);
  game.setHover({ x: 0, y: 0 });
  const pieces = boardMarks(game.getView()).decals.map((d) => `${d.x},${d.y}:${d.dx},${d.dy}`).sort();
  assert.deepEqual(pieces, ['0,0:0,0', '0,1:0,1', '1,0:1,0', '1,1:1,1']);
});

test('winner marks pulse between 70 and 100 percent once a second', () => {
  assert.equal(winPulseOpacity(0), 1);
  assert.ok(Math.abs(winPulseOpacity(500) - 0.7) < 1e-9);
  assert.equal(winPulseOpacity(1000), 1);
  for (let t = 0; t < 2000; t += 37) {
    const o = winPulseOpacity(t);
    assert.ok(o >= 0.7 - 1e-9 && o <= 1 + 1e-9);
  }
});

test('the last-move mark fades in with the Open stage and stays', () => {
  assert.equal(lastMoveOpacity(0, STAGES), 0);
  assert.equal(lastMoveOpacity(849, STAGES), 0);
  assert.equal(lastMoveOpacity(850, STAGES), 0);
  assert.ok(Math.abs(lastMoveOpacity(1025, STAGES) - 0.5) < 1e-9);
  assert.equal(lastMoveOpacity(1200, STAGES), 1);
  assert.equal(lastMoveOpacity(60000, STAGES), 1);
  assert.equal(lastMoveOpacity(Infinity, STAGES), 1, 'shown at once after a catch-up');
});

test('the newest plant is the last placed stone', () => {
  const previous = { x: 1, y: 1, player: 'O' };
  assert.equal(lastPlanted([{ type: 'turnEnded' }], previous), previous);
  assert.deepEqual(lastPlanted([
    { type: 'stonePlaced', player: 'X', x: 3, y: 4 },
    { type: 'turnEnded' },
    { type: 'stonePlaced', player: 'O', x: 5, y: 6 },
  ]), { x: 5, y: 6, player: 'O' });
  assert.equal(lastPlanted([]), null);
});

test('the wood board and the old decals are gone from the 3D render path', () => {
  const read = (file) => readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8');
  for (const file of ['world.js', 'world-renderer.js', 'effects3d.js', 'farm-field.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /ART\.board\b/, `${file} uses the wood board texture`);
    assert.doesNotMatch(source, /ART\.decal\./, `${file} uses an old decal`);
    assert.doesNotMatch(source, /BoxGeometry/, `${file} builds a slab`);
  }
  assert.doesNotMatch(read('farm-layout.js'), /from\s+['"]three/, 'farm-layout.js stays pure');
});
