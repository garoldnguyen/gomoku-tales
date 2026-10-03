import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE, CAMERA_PITCH_DEG, CELL_SIZE, CHARACTER_SPRITE_PX, CHARACTER_X, PX_WORLD,
  SPRITE_STRETCH_Y,
} from '../src/config.js';
import { faceYaw, fadedAlphaTest, frameAt, SPRITE_ALPHA_TEST } from '../src/render3d/sprite-frames.js';
import { bearFrames, IDLE_BOB, rabbitFrames } from '../src/render3d/placeholder-art.js';
import { GROUND_Y, terrainHeight } from '../src/render3d/terrain.js';

test('frameAt steps one frame every frameMs and loops', () => {
  assert.equal(frameAt(0, 4, 100), 0);
  assert.equal(frameAt(99, 4, 100), 0);
  assert.equal(frameAt(100, 4, 100), 1);
  assert.equal(frameAt(250, 4, 100), 2);
  assert.equal(frameAt(399, 4, 100), 3);
  assert.equal(frameAt(400, 4, 100), 0);
  assert.equal(frameAt(1050, 4, 100), 2);
});

test('frameAt holds the last frame of a one-shot animation', () => {
  assert.equal(frameAt(250, 4, 100, { loop: false }), 2);
  assert.equal(frameAt(400, 4, 100, { loop: false }), 3);
  assert.equal(frameAt(10_000, 4, 100, { loop: false }), 3);
});

test('frameAt shows frame 0 for still sprites, bad speeds and times before the start', () => {
  assert.equal(frameAt(5000, 1, 100), 0);
  assert.equal(frameAt(5000, 4, 0), 0);
  assert.equal(frameAt(5000, 4, -10), 0);
  assert.equal(frameAt(-50, 4, 100), 0);
  assert.equal(frameAt(Number.NaN, 4, 100), 0);
});

test('frameAt works with large requestAnimationFrame timestamps', () => {
  const t = 3_600_000; // an hour after page load
  assert.equal(frameAt(t, 4, 220), Math.floor(t / 220) % 4);
  assert.equal(frameAt(t + 220, 4, 220), (frameAt(t, 4, 220) + 1) % 4);
});

test('faceYaw turns a +z facing plane towards the target around the vertical axis only', () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(faceYaw(origin, { x: 0, y: 10, z: 5 }), 0);
  assert.ok(Math.abs(faceYaw(origin, { x: 5, y: 0, z: 0 }) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(faceYaw(origin, { x: -5, y: 0, z: 0 }) + Math.PI / 2) < 1e-12);
  // Height does not matter: the sprite never tilts.
  assert.equal(faceYaw(origin, { x: 3, y: 0, z: 4 }), faceYaw(origin, { x: 3, y: 99, z: 4 }));
  // The rotated +z axis (sin yaw, cos yaw) points at the target.
  const target = { x: -3, y: 20, z: 4 };
  const yaw = faceYaw({ x: 1, y: 0, z: 1 }, target);
  const len = Math.hypot(-4, 3);
  assert.ok(Math.abs(Math.sin(yaw) - -4 / len) < 1e-12);
  assert.ok(Math.abs(Math.cos(yaw) - 3 / len) < 1e-12);
  assert.equal(faceYaw(origin, { x: 0, y: 5, z: 0 }), 0);
});

test('one PX_WORLD makes a 32 px farm board cell exactly one cell wide', () => {
  assert.equal(32 * PX_WORLD, CELL_SIZE);
});

test('the sprite height stretch cancels the camera pitch, so pixels look square', () => {
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  assert.ok(Math.abs(SPRITE_STRETCH_Y * Math.cos(pitch) - 1) < 1e-12);
});

test('characters have 4 frame idle bob sheets of the configured size', () => {
  for (const frames of [rabbitFrames(), bearFrames()]) {
    assert.equal(frames.length, 4);
    assert.equal(IDLE_BOB.length, 4);
    for (const grid of frames) {
      assert.equal(grid.width, CHARACTER_SPRITE_PX);
      assert.equal(grid.height, CHARACTER_SPRITE_PX);
      assert.equal(grid.pixels.length, CHARACTER_SPRITE_PX * CHARACTER_SPRITE_PX);
    }
    // The body moves between frames...
    assert.notDeepEqual(frames[0].pixels, frames[2].pixels);
    // ...while the feet stay planted on the bottom row of every frame.
    const feet = frames[0].pixels.slice((CHARACTER_SPRITE_PX - 2) * CHARACTER_SPRITE_PX);
    for (const grid of frames) {
      assert.ok(grid.pixels.slice(-grid.width).some(Boolean), 'feet reach the bottom row');
      assert.deepEqual(grid.pixels.slice((CHARACTER_SPRITE_PX - 2) * CHARACTER_SPRITE_PX), feet);
    }
  }
});

test('the rabbit wears a blue scarf and the bear is brown', () => {
  const rabbit = new Set(rabbitFrames()[0].pixels);
  const bear = new Set(bearFrames()[0].pixels);
  assert.ok(rabbit.has('#ffffff') && rabbit.has('#3f7fd8'));
  assert.ok(bear.has('#9b6235'));
});

test('the meadow is flat: the board and both characters stand on the ground plane', () => {
  assert.equal(GROUND_Y, 0);
  const half = (BOARD_SIZE * CELL_SIZE) / 2;
  for (let x = -half; x <= half; x += 0.5) {
    for (let z = -half; z <= half; z += 0.5) assert.equal(terrainHeight(x, z), GROUND_Y);
  }
  for (const x of [-CHARACTER_X, CHARACTER_X]) {
    for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
      assert.equal(terrainHeight(x + dx, dz), GROUND_Y);
    }
  }
  // No hill falls away behind the board any more, and nothing rises.
  for (let x = -30; x <= 30; x += 1) {
    for (let z = -11; z <= 14; z += 1) assert.equal(terrainHeight(x, z), 0);
  }
});

test('faded sprites keep opaque art pixels and cut out transparent ones', () => {
  for (const opacity of [1, 0.45, 0.2]) {
    const threshold = fadedAlphaTest(opacity);
    // Three.js tests texelAlpha * opacity against alphaTest and discards below it.
    assert.ok(1 * opacity >= threshold, `opaque pixel survives at opacity ${opacity}`);
    assert.ok(0 * opacity < threshold, `transparent pixel is cut at opacity ${opacity}`);
  }
  assert.equal(fadedAlphaTest(1), SPRITE_ALPHA_TEST);
  // The bug this guards: an unscaled threshold discards a 0.45 ghost entirely.
  assert.ok(1 * 0.45 < SPRITE_ALPHA_TEST);
});
