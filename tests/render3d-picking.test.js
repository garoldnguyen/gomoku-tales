import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_SIZE, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CELL_SIZE } from '../src/config.js';
import { cameraPosition, cameraRay } from '../src/render3d/camera.js';
import { cellToWorld, intersectHorizontalPlane, pickCell, pointerToNdc, worldToCell } from '../src/render3d/picking.js';
import { createFpsMeter } from '../src/render3d/fps.js';

const TARGET = { x: 0, y: 0, z: 0 };
const ASPECT = 16 / 9;
const POSITION = cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE, TARGET);
const CAMERA = { position: POSITION, target: TARGET, fovDeg: CAMERA_FOV, aspect: ASPECT };

function close(actual, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
}

function angleBetween(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.min(1, dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))));
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a, k) {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

function norm(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function pickAtNdc(x, y) {
  const ray = cameraRay(x, y, CAMERA);
  return pickCell(ray.origin, ray.direction);
}

test('config holds the HD-2D camera values from the art direction', () => {
  assert.ok(CAMERA_FOV >= 30 && CAMERA_FOV <= 40);
  assert.ok(CAMERA_PITCH_DEG >= 50 && CAMERA_PITCH_DEG <= 60);
  assert.ok(CAMERA_DISTANCE > 0);
  assert.ok(CELL_SIZE > 0);
});

test('the camera sits CAMERA_DISTANCE away, looking down by the pitch from the +z side', () => {
  close(Math.hypot(POSITION.x, POSITION.y, POSITION.z), CAMERA_DISTANCE, 'distance');
  close(POSITION.x, 0, 'x');
  assert.ok(POSITION.y > 0 && POSITION.z > 0);
  close(Math.atan2(POSITION.y, POSITION.z) * 180 / Math.PI, CAMERA_PITCH_DEG, 'pitch');
  const raised = cameraPosition(90, 10, { x: 2, y: 1, z: -3 });
  close(raised.x, 2, 'top-down x');
  close(raised.y, 11, 'top-down y');
  close(raised.z, -3, 'top-down z');
});

test('the centre ray points at the target and the edge rays match the field of view', () => {
  const centre = cameraRay(0, 0, CAMERA);
  const toTarget = { x: -POSITION.x, y: -POSITION.y, z: -POSITION.z };
  close(angleBetween(centre.direction, toTarget), 0, 'centre', 1e-6);
  const halfFov = (CAMERA_FOV / 2) * Math.PI / 180;
  close(angleBetween(cameraRay(0, 1, CAMERA).direction, centre.direction), halfFov, 'top edge', 1e-6);
  const halfWidth = Math.atan(Math.tan(halfFov) * ASPECT);
  close(angleBetween(cameraRay(1, 0, CAMERA).direction, centre.direction), halfWidth, 'right edge', 1e-6);
  assert.ok(cameraRay(1, 0, CAMERA).direction.x > 0, 'right of the screen is +x');
  assert.ok(cameraRay(0, 1, CAMERA).direction.z < centre.direction.z, 'up the screen is towards -z');
});

test('pointerToNdc maps the element corners and centre', () => {
  const rect = { left: 100, top: 50, width: 800, height: 450 };
  assert.deepEqual(pointerToNdc(100, 50, rect), { x: -1, y: 1 });
  assert.deepEqual(pointerToNdc(900, 500, rect), { x: 1, y: -1 });
  assert.deepEqual(pointerToNdc(500, 275, rect), { x: 0, y: 0 });
});

test('a ray meets the board plane only when it points at it', () => {
  assert.deepEqual(intersectHorizontalPlane({ x: 1, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }), { x: 1, y: 0, z: 2 });
  assert.deepEqual(intersectHorizontalPlane({ x: 0, y: 4, z: 0 }, { x: 1, y: -2, z: 0 }, 2), { x: 1, y: 2, z: 0 });
  assert.equal(intersectHorizontalPlane({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }), null, 'parallel');
  assert.equal(intersectHorizontalPlane({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }), null, 'pointing up');
});

test('worldToCell covers the board from edge to edge and nothing outside it', () => {
  const half = (BOARD_SIZE * CELL_SIZE) / 2;
  const last = BOARD_SIZE - 1;
  assert.deepEqual(worldToCell(-half, -half), { x: 0, y: 0 });
  assert.deepEqual(worldToCell(half - 1e-6, half - 1e-6), { x: last, y: last });
  assert.deepEqual(worldToCell(0, 0), { x: (BOARD_SIZE - 1) / 2, y: (BOARD_SIZE - 1) / 2 });
  assert.equal(worldToCell(-half - 1e-6, 0), null);
  assert.equal(worldToCell(0, half), null);
  assert.equal(worldToCell(half, 0), null);
  assert.equal(worldToCell(0, -half - 0.5), null);
});

test('worldToCell and cellToWorld agree for every cell and other board sizes', () => {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const centre = cellToWorld(x, y);
      assert.deepEqual(worldToCell(centre.x, centre.z), { x, y });
    }
  }
  const small = { boardSize: 4, cellSize: 2 };
  assert.deepEqual(cellToWorld(0, 3, small), { x: -3, z: 3 });
  assert.deepEqual(worldToCell(-3.9, 3.9, small), { x: 0, y: 3 });
  assert.equal(worldToCell(4, 0, small), null);
});

test('a ray from the camera to any cell centre picks that cell', () => {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const c = cellToWorld(x, y);
      const direction = { x: c.x - POSITION.x, y: -POSITION.y, z: c.z - POSITION.z };
      assert.deepEqual(pickCell(POSITION, direction), { x, y });
    }
  }
});

test('picking through the screen finds the centre cell, the far rows up the screen, and misses off the board', () => {
  const mid = (BOARD_SIZE - 1) / 2;
  assert.deepEqual(pickAtNdc(0, 0), { x: mid, y: mid });
  const up = pickAtNdc(0, 0.3);
  assert.ok(up && up.y < mid, 'higher on screen is a lower row number');
  const right = pickAtNdc(0.3, 0);
  assert.ok(right && right.x > mid, 'right on screen is a higher column number');
  assert.equal(pickAtNdc(-1, 0), null, 'left edge of the screen is beside the board');
  assert.equal(pickAtNdc(0, 1), null, 'top edge of the screen is past the board');
});

test('the whole board is inside the camera view', () => {
  // The camera looks along -POSITION with +x to its right (it sits at x = 0).
  const forward = scale(POSITION, -1 / norm(POSITION));
  const right = { x: 1, y: 0, z: 0 };
  const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  const tanHalf = Math.tan((CAMERA_FOV / 2) * Math.PI / 180);
  const half = (BOARD_SIZE * CELL_SIZE) / 2;
  for (const [wx, wz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    const ray = sub({ x: wx, y: 0, z: wz }, POSITION);
    const depth = dot(ray, forward);
    assert.ok(depth > 0, 'in front of the camera');
    const ndcX = dot(ray, right) / depth / (tanHalf * ASPECT);
    const ndcY = dot(ray, up) / depth / tanHalf;
    assert.ok(Math.abs(ndcX) < 1 && Math.abs(ndcY) < 1, `corner ${wx},${wz} is on screen`);
    assert.deepEqual(pickAtNdc(ndcX * 0.999, ndcY * 0.999), worldToCell(wx * 0.999, wz * 0.999), 'and picks back to its cell');
  }
});

test('the FPS meter averages frames over its window', () => {
  const meter = createFpsMeter(500);
  assert.equal(meter.tick(1000), 0);
  for (let i = 1; i <= 29; i++) meter.tick(1000 + i * 16);
  assert.equal(meter.fps, 0, 'no reading before the window has passed');
  for (let i = 30; i <= 32; i++) meter.tick(1000 + i * 16);
  assert.equal(meter.fps, (32 * 1000) / 512);
  for (let i = 1; i <= 10; i++) meter.tick(1512 + i * 50);
  assert.equal(meter.fps, 20);
});

test('pure render3d helpers do not import Three.js', () => {
  for (const file of ['camera.js', 'picking.js', 'fps.js']) {
    const source = readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]three/, file);
  }
});
