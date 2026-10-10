import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOARD_SIZE, CAMERA_DISTANCE, CAMERA_PITCH_DEG, PLANT_DROP_MS, PLANT_DROP_PX, PLANT_OPEN_POP_MS, PLANT_OPEN_POP_SCALE, PX_WORLD,
  SPRITE_STRETCH_Y,
} from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { createInitialState, placeStone } from '../src/logic/game.js';
import {
  dropOffsetPx, enteredStage, growthStage, openPopScale, plantedCells, plantPoseInto,
  STAGE_DROP, STAGE_LAND, STAGE_OPEN, STAGE_REST, STAGE_SPROUT,
} from '../src/render3d/growth.js';
import { cameraPosition } from '../src/render3d/camera.js';
import { cellToWorld } from '../src/render3d/picking.js';
import { anchorForward, anchorShift, faceYaw } from '../src/render3d/sprite-frames.js';
import { metaAnchor, parseV3Meta, PLANT_STAGES, stageStartMs } from '../src/render3d/v3-meta.js';

const meta = parseV3Meta(JSON.parse(readFileSync(new URL('../assets/v3-meta.json', import.meta.url), 'utf8')));
const STAGES = stageStartMs(meta, 'plant-x'); // [0, 150, 450, 850, 1200]
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('the plant stages are Drop, Land, Sprout, Open and Rest at the times of v3-meta.json', () => {
  assert.deepEqual([STAGE_DROP, STAGE_LAND, STAGE_SPROUT, STAGE_OPEN, STAGE_REST], [0, 1, 2, 3, 4]);
  assert.equal(PLANT_STAGES.length, 5);
  assert.deepEqual(STAGES, [0, 150, 450, 850, 1200]);
  assert.deepEqual(stageStartMs(meta, 'plant-o'), STAGES);
  assert.deepEqual(metaAnchor(meta, 'plant-x'), { x: 18, y: 36 });
  assert.deepEqual(metaAnchor(meta, 'plant-o'), { x: 18, y: 36 });
});

test('growthStage gives the frame and the progress inside the stage', () => {
  assert.deepEqual(growthStage(0, STAGES), { frame: STAGE_DROP, progress: 0 });
  assert.deepEqual(growthStage(75, STAGES), { frame: STAGE_DROP, progress: 0.5 });
  assert.deepEqual(growthStage(300, STAGES), { frame: STAGE_LAND, progress: 0.5 });
  assert.deepEqual(growthStage(650, STAGES), { frame: STAGE_SPROUT, progress: 0.5 });
  assert.deepEqual(growthStage(1025, STAGES), { frame: STAGE_OPEN, progress: 0.5 });
});

test('growthStage switches stage exactly at each stage start time', () => {
  for (let stage = 1; stage < STAGES.length; stage++) {
    const before = growthStage(STAGES[stage] - 0.001, STAGES);
    assert.equal(before.frame, stage - 1, `just before stage ${stage}`);
    assert.ok(before.progress > 0.99 && before.progress < 1, 'progress stays below 1 inside a stage');
    const at = growthStage(STAGES[stage], STAGES);
    assert.equal(at.frame, stage, `at stage ${stage}`);
    assert.equal(at.progress, stage === STAGE_REST ? 1 : 0);
  }
});

test('growthStage holds Rest past the end and starts at Drop before 0', () => {
  for (const t of [1200, 1201, 5000, 1e9, Infinity]) assert.deepEqual(growthStage(t, STAGES), { frame: STAGE_REST, progress: 1 }, `t = ${t}`);
  for (const t of [-1, -1000, -Infinity, NaN, undefined]) assert.deepEqual(growthStage(t, STAGES), { frame: STAGE_DROP, progress: 0 }, `t = ${t}`);
});

test('growthStage follows other stage times', () => {
  const slow = [0, 100, 200, 300, 400];
  assert.deepEqual(growthStage(250, slow), { frame: 2, progress: 0.5 });
  assert.deepEqual(growthStage(400, slow), { frame: 4, progress: 1 });
});

test('the seed slides down 10 art pixels over the first 150 ms, easing in', () => {
  assert.equal(PLANT_DROP_PX, 10);
  assert.equal(PLANT_DROP_MS, 150);
  assert.equal(dropOffsetPx(0), 10);
  assert.equal(dropOffsetPx(-50), 10, 'before planting it is still up');
  close(dropOffsetPx(75), 7.5, 'ease in: only a quarter of the way down at half time');
  assert.equal(dropOffsetPx(150), 0);
  assert.equal(dropOffsetPx(151), 0);
  assert.equal(dropOffsetPx(Infinity), 0);
  let previous = Infinity;
  let previousStep = 0;
  for (let t = 0; t <= 150; t += 10) {
    const offset = dropOffsetPx(t);
    assert.ok(offset <= previous, 'it only moves down');
    if (previous !== Infinity) {
      assert.ok(previous - offset >= previousStep - 1e-9, 'it speeds up (ease in)');
      previousStep = previous - offset;
    }
    previous = offset;
  }
});

test('the Open pop goes 1.0, 1.12, 1.0 over 120 ms', () => {
  assert.equal(PLANT_OPEN_POP_MS, 120);
  assert.equal(PLANT_OPEN_POP_SCALE, 1.12);
  assert.equal(openPopScale(0), 1);
  close(openPopScale(60), 1.12, 'peak halfway');
  assert.ok(openPopScale(30) > 1 && openPopScale(30) < 1.12);
  assert.ok(openPopScale(90) > 1 && openPopScale(90) < 1.12);
  assert.equal(openPopScale(120), 1);
  assert.equal(openPopScale(500), 1);
  assert.equal(openPopScale(Infinity), 1);
  assert.equal(openPopScale(-200), 1, 'no pop before Open');
  for (let t = 0; t <= 120; t += 5) assert.ok(openPopScale(t) >= 1 && openPopScale(t) <= 1.12 + 1e-9);
});

test('plantPoseInto writes frame, progress, drop and scale into one object', () => {
  const out = { frame: 0, progress: 0, dropPx: 0, scale: 1 };
  assert.equal(plantPoseInto(0, STAGES, out), out, 'no new object');
  assert.deepEqual(out, { frame: STAGE_DROP, progress: 0, dropPx: 10, scale: 1 });
  plantPoseInto(STAGES[STAGE_OPEN] + 60, STAGES, out);
  assert.equal(out.frame, STAGE_OPEN);
  assert.equal(out.dropPx, 0);
  close(out.scale, 1.12, 'the pop runs from the Open start');
  plantPoseInto(Infinity, STAGES, out);
  assert.deepEqual(out, { frame: STAGE_REST, progress: 1, dropPx: 0, scale: 1 }, 'a plant that already stood there');
});

test('enteredStage fires once when a growing plant reaches a stage, never for a jump to Rest', () => {
  assert.ok(enteredStage(STAGE_DROP, STAGE_LAND, STAGE_LAND));
  assert.ok(!enteredStage(STAGE_LAND, STAGE_LAND, STAGE_LAND), 'only on the first frame');
  assert.ok(enteredStage(-1, STAGE_SPROUT, STAGE_LAND), 'a slow frame that skipped Land still puffs');
  assert.ok(enteredStage(STAGE_SPROUT, STAGE_OPEN, STAGE_OPEN));
  assert.ok(!enteredStage(STAGE_DROP, STAGE_SPROUT, STAGE_OPEN));
  assert.ok(!enteredStage(-1, STAGE_REST, STAGE_LAND), 'a plant shown at Rest has no cues');
  assert.ok(!enteredStage(STAGE_SPROUT, STAGE_REST, STAGE_OPEN));
});

test('plantedCells lists placed moves only', () => {
  const placed = placeStone(createInitialState(), { player: X, x: 3, y: 4 });
  assert.equal(placed.ok, true);
  assert.deepEqual(plantedCells(placed.events), [{ x: 3, y: 4, player: X }]);
  const next = placeStone(placed.state, { player: O, x: 5, y: 5 });
  assert.deepEqual(plantedCells(next.events), [{ x: 5, y: 5, player: O }]);
  assert.deepEqual(plantedCells([{ type: 'stonePetrified', x: 1, y: 1, player: O }, { type: 'stoneThrown' }, { type: 'mudPlaced', x: 2, y: 2 }]), []);
  assert.deepEqual(plantedCells([]), []);
});

test('anchorShift puts the anchor pixel (18, 36) of a 36 x 40 plant above the plot centre', () => {
  const shift = anchorShift(36, 40, { x: 18, y: 36 }, PX_WORLD, SPRITE_STRETCH_Y);
  close(shift.side, 0, 'x 18 is the frame centre');
  // Rows 37 to 39 lie below the anchor pixel (its bottom edge is the point
  // on the plot), so the anchor stands 3 rows above the plane's foot.
  close(shift.lift, 3 * PX_WORLD * SPRITE_STRETCH_Y, 'the anchor height');

  close(anchorShift(36, 40, { x: 10, y: 39 }, PX_WORLD, SPRITE_STRETCH_Y).side, 8 * PX_WORLD, 'a left anchor moves the plane right');
  assert.equal(anchorShift(36, 40, { x: 18, y: 39 }, PX_WORLD, SPRITE_STRETCH_Y).lift, 0, 'an anchor on the last row stands on its foot');
  // The bottom-centre anchors of v3-meta.json need no shift at all.
  assert.deepEqual(anchorShift(24, 16, metaAnchor(meta, 'hay-bale'), PX_WORLD, SPRITE_STRETCH_Y), { side: 0, lift: 0 });
  assert.deepEqual(anchorShift(32, 32, null, PX_WORLD, SPRITE_STRETCH_Y), { side: 0, lift: 0 }, 'rocks stand on their bottom centre');
});

test('anchorForward keeps the anchor on the camera ray through every plot centre', () => {
  const camera = cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE);
  const { lift } = anchorShift(36, 40, { x: 18, y: 36 }, PX_WORLD, SPRITE_STRETCH_Y);
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = cellToWorld(x, y);
      const ground = { x: cell.x, y: 0, z: cell.z };
      const forward = anchorForward(lift, ground, camera);
      // The anchor point: `forward` from the plot centre towards the camera
      // on the ground, `lift` up. It must be on the line camera -> plot.
      const yaw = faceYaw(ground, camera);
      const anchor = { x: ground.x + forward * Math.sin(yaw), y: lift, z: ground.z + forward * Math.cos(yaw) };
      const t = lift / camera.y; // how far up the ray from the plot the anchor height is
      close(anchor.x, ground.x + (camera.x - ground.x) * t, `x on the ray at (${x}, ${y})`);
      close(anchor.z, ground.z + (camera.z - ground.z) * t, `z on the ray at (${x}, ${y})`);
      assert.ok(forward > 0 && forward < 0.5, 'the plant stays inside its own cell, in front of the row behind');
    }
  }
  // The far rows are seen at a flatter angle than the near rows, so they
  // need more: one shift from the camera pitch alone misses both.
  assert.ok(anchorForward(lift, { x: 0, y: 0, z: -5 }, camera) > anchorForward(lift, { x: 0, y: 0, z: 5 }, camera));
  assert.equal(anchorForward(0, { x: 0, y: 0, z: 0 }, camera), 0, 'no lift, no shift');
  assert.equal(anchorForward(lift, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }), 0, 'a camera not above the ground gives no shift');
});
