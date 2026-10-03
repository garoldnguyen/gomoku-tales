// The full window view (docs/art-direction-v3-1.md section 3): fitView and
// zoomK, the ground covering every window shape, picking at every shape
// and the resize function. All pure, no browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BOARD_SIZE, CELL_SIZE, CURB_PX, MEADOW_SEED, PX_WORLD } from '../src/config.js';
import { gameCamera, projectToNdc } from '../src/render3d/camera.js';
import { CURB } from '../src/render3d/farm-layout.js';
import { clipPlanes } from '../src/render3d/depth-of-field.js';
import {
  CAMERA_POSE, FIELD_HALF_EXTENT, fitView, GAME_ASPECT, MAX_ASPECT, MIN_ASPECT, zoomK,
} from '../src/render3d/framing.js';
import { cellAtViewPoint, createWorldHitTest } from '../src/render3d/hit-test.js';
import {
  FAR_EDGE_Z, GROUND_HALF_WIDTH, GROUND_NEAR_Z, GROUND_RECT, groundUnderNdc, screenEdgeX,
} from '../src/render3d/horizon.js';
import {
  MEADOW_BOUNDS, MEADOW_STRIP_INNER_X, MEADOW_STRIPS, meadowItems, mergeMeadowPlans, planMeadow, planMeadowStrips,
} from '../src/render3d/meadow.js';
import { cellToWorld } from '../src/render3d/picking.js';
import { QUALITY_LEVELS } from '../src/render3d/quality.js';
import { TERRAIN_GRID } from '../src/render3d/terrain.js';
import { windowView } from '../src/render3d/view-size.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Window shapes, width over height.
const SHAPES = {
  '32:9': 32 / 9, '21:9': 21 / 9, '16:9': 16 / 9, '3:2': 3 / 2, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16, '9:21': 9 / 21,
};
const REFERENCE = CAMERA_POSE.fovDeg;

// The camera of the game at `aspect`, with field of view `fovDeg`.
const cameraAt = (aspect, fovDeg = fitView(aspect)) => ({ ...gameCamera(aspect), fovDeg });

// The four ground corners of the FIELD_HALF_EXTENT square.
const E = FIELD_HALF_EXTENT;
const CORNERS = [[-E, -E], [E, -E], [-E, E], [E, E]];
const inView = (camera) => CORNERS.every(([x, z]) => {
  const p = projectToNdc({ x, y: 0, z }, camera);
  return p !== null && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
});

// --- 1. fitView and zoomK ---

test('FIELD_HALF_EXTENT is the board, its curb and a one cell margin', () => {
  assert.ok(Math.abs(FIELD_HALF_EXTENT - ((BOARD_SIZE * CELL_SIZE) / 2 + CURB_PX * PX_WORLD + CELL_SIZE)) < 1e-12);
  assert.ok(Math.abs(FIELD_HALF_EXTENT - (CURB.inner + CURB.width + CELL_SIZE)) < 1e-12);
  assert.equal(FIELD_HALF_EXTENT, 8.75);
});

test('fitView: the four field corners are inside the view at every window shape', () => {
  for (const [name, aspect] of Object.entries(SHAPES)) {
    assert.ok(inView(cameraAt(aspect)), `${name}: fitView ${fitView(aspect)}`);
  }
});

test('fitView: narrower than 16:9 it is the smallest view that fits, never under the reference', () => {
  for (const [name, aspect] of Object.entries(SHAPES)) {
    if (aspect >= GAME_ASPECT) continue;
    const fov = fitView(aspect);
    assert.ok(fov >= REFERENCE, `${name}: ${fov}`);
    if (fov > REFERENCE) {
      assert.ok(!inView(cameraAt(aspect, fov - 0.05)), `${name}: ${fov - 0.05} degrees still fits, so ${fov} is not the smallest`);
    } else {
      // Clamped to the reference: the field already fits at 16:9's view.
      assert.equal(fov, REFERENCE, `${name}: clamped exactly to the reference`);
      assert.ok(inView(cameraAt(aspect, REFERENCE)), `${name}: fits at the reference view`);
    }
  }
  // The tall shapes need a wider view than 16:9.
  for (const name of ['3:4', '9:16', '9:21']) assert.ok(fitView(SHAPES[name]) > REFERENCE + 1, name);
});

test('fitView: exactly the reference at 16:9 and wider, and non-increasing in aspect', () => {
  for (const aspect of [GAME_ASPECT, 2, SHAPES['21:9'], SHAPES['32:9'], 10]) assert.equal(fitView(aspect), REFERENCE);
  let last = Infinity;
  for (let aspect = 0.3; aspect <= 4; aspect += 0.01) {
    const fov = fitView(aspect);
    assert.ok(fov <= last + 1e-12, `${aspect}: ${fov} after ${last}`);
    last = fov;
  }
});

test('zoomK: 1 at the reference view, smaller as the view widens', () => {
  assert.ok(Math.abs(zoomK(REFERENCE) - 1) < 1e-12);
  assert.equal(zoomK(fitView(SHAPES['21:9'])), 1);
  const portrait = zoomK(fitView(SHAPES['9:16']));
  const tall = zoomK(fitView(SHAPES['9:21']));
  assert.ok(portrait < 1 && tall < portrait, `${portrait} ${tall}`);
  const v = 30;
  assert.ok(Math.abs(zoomK(v) - Math.tan((REFERENCE * Math.PI) / 360) / Math.tan((v * Math.PI) / 360)) < 1e-12);
});

test('the game camera uses fitView and keeps its position and aim at every shape', () => {
  const reference = gameCamera(GAME_ASPECT);
  for (const [name, aspect] of Object.entries(SHAPES)) {
    const camera = gameCamera(aspect);
    assert.equal(camera.fovDeg, fitView(aspect), name);
    assert.equal(camera.aspect, aspect, name);
    assert.deepEqual(camera.position, reference.position, name);
    assert.deepEqual(camera.target, reference.target, name);
  }
});

// --- 2. The ground covers the view ---

test('the ground bounds come from one place and reach 44 to each side and z 24 toward the camera', () => {
  assert.ok(GROUND_HALF_WIDTH >= 44);
  assert.ok(GROUND_NEAR_Z >= 24);
  assert.deepEqual(GROUND_RECT, { minX: -GROUND_HALF_WIDTH, maxX: GROUND_HALF_WIDTH, minZ: FAR_EDGE_Z, maxZ: GROUND_NEAR_Z });
  assert.deepEqual(TERRAIN_GRID, { ...GROUND_RECT, cell: TERRAIN_GRID.cell });
});

test('ground coverage: the bottom corners and middle of every window shape land on the ground with 1 unit to spare', () => {
  for (const name of ['9:21', '9:16', '3:4', '1:1', '4:3', '16:9', '21:9', '32:9']) {
    const camera = cameraAt(SHAPES[name]);
    for (const ndcX of [-1, 0, 1]) {
      const hit = groundUnderNdc(camera, ndcX, -1);
      assert.ok(hit, `${name} ${ndcX}: the ray meets the ground`);
      assert.ok(hit.x - GROUND_RECT.minX >= 1 && GROUND_RECT.maxX - hit.x >= 1, `${name} ${ndcX}: x ${hit.x}`);
      assert.ok(GROUND_RECT.maxZ - hit.z >= 1 && hit.z - GROUND_RECT.minZ >= 1, `${name} ${ndcX}: z ${hit.z}`);
    }
    // Along the far edge's row the screen sides stay inside the ground.
    for (const side of [-1, 1]) {
      const x = screenEdgeX(camera, SHAPES[name], FAR_EDGE_Z, side);
      assert.ok(Math.abs(x) <= GROUND_HALF_WIDTH, `${name} far edge side ${side}: x ${x}`);
    }
  }
});

// --- 3. Picking at every window shape ---

test('picking round trip: cell centres projected into a window of each shape pick the same cell', () => {
  for (const [name, [w, h]] of Object.entries({ '21:9': [2520, 1080], '16:9': [1920, 1080], '4:3': [1440, 1080], '9:16': [1080, 1920] })) {
    const view = windowView(w, h, 'medium');
    const camera = gameCamera(view.aspect);
    assert.equal(camera.fovDeg, view.fovDeg, `${name}: the camera and the resize agree`);
    const hitTest = createWorldHitTest(camera, view);
    for (const [cx, cy] of [[0, 0], [7, 7], [14, 14]]) {
      const { x, z } = cellToWorld(cx, cy);
      const ndc = projectToNdc({ x, y: 0, z }, camera);
      const px = ((ndc.x + 1) / 2) * view.width;
      const py = ((1 - ndc.y) / 2) * view.height;
      assert.ok(px >= 0 && px <= view.width && py >= 0 && py <= view.height, `${name} (${cx},${cy}) is on screen`);
      assert.deepEqual(hitTest(px, py), { cell: { x: cx, y: cy } }, `${name} (${cx},${cy})`);
      assert.deepEqual(cellAtViewPoint(px, py, view, camera), { x: cx, y: cy });
    }
  }
});

test('the hit test reads a live view and camera, so it follows a resize', () => {
  const view = { width: 1920, height: 1080 };
  const camera = gameCamera(view.width / view.height);
  const hitTest = createWorldHitTest(camera, view);
  // Resize to portrait in place, as world.js does.
  const next = windowView(1080, 1920, 'high');
  view.width = next.width;
  view.height = next.height;
  camera.aspect = next.aspect;
  camera.fovDeg = next.fovDeg;
  const { x, z } = cellToWorld(3, 11);
  const ndc = projectToNdc({ x, y: 0, z }, gameCamera(next.aspect));
  assert.deepEqual(hitTest(((ndc.x + 1) / 2) * 1080, ((1 - ndc.y) / 2) * 1920), { cell: { x: 3, y: 11 } });
});

// --- 4. The resize function ---

test('windowView: renderer size, the quality pixel ratio cap, camera aspect and field of view', () => {
  for (const [level, row] of Object.entries(QUALITY_LEVELS)) {
    const view = windowView(1680, 720, level, 3);
    assert.equal(view.pixelRatio, row.pixelRatioCap, level);
    assert.deepEqual(windowView(1680, 720, row, 3), view, `${level}: a row works like its name`);
    assert.equal(windowView(1680, 720, level, 1).pixelRatio, 1, `${level}: never above the screen's`);
  }
  const wide = windowView(1680, 720, 'medium', 1);
  assert.equal(wide.width, 1680);
  assert.equal(wide.height, 720);
  assert.equal(wide.aspect, 1680 / 720);
  assert.equal(wide.fovDeg, REFERENCE);
  const phone = windowView(390, 844, 'medium', 3);
  assert.equal(phone.pixelRatio, QUALITY_LEVELS.medium.pixelRatioCap);
  assert.equal(phone.fovDeg, fitView(390 / 844));
});

test('windowView never returns a zero or negative size', () => {
  for (const [w, h] of [[0, 0], [-5, 720], [1280, -1], [0.2, 0.4], [Number.NaN, 600], [Infinity, 600]]) {
    const view = windowView(w, h, 'low', 1);
    assert.ok(view.width >= 1 && view.height >= 1, `${w}x${h}`);
    assert.ok(Number.isFinite(view.aspect) && view.aspect > 0, `${w}x${h}`);
    assert.ok(Number.isFinite(view.fovDeg) && view.fovDeg >= REFERENCE, `${w}x${h}`);
    assert.ok(view.pixelRatio > 0, `${w}x${h}`);
  }
});

test('an extreme window keeps a working camera: fitView stops at 9:21, clip planes and picking stay finite', () => {
  assert.ok(Math.abs(MIN_ASPECT - SHAPES['9:21']) < 1e-12 && Math.abs(MAX_ASPECT - SHAPES['32:9']) < 1e-12);
  // A window dragged to 1 px wide (or tall) must not stop the render loop.
  for (const [w, h] of [[1, 900], [1, 5000], [3, 2000], [100, 1000], [5000, 1], [3000, 3]]) {
    const view = windowView(w, h, 'high', 2);
    if (view.aspect < MIN_ASPECT) assert.equal(view.fovDeg, fitView(MIN_ASPECT), `${w}x${h}`);
    assert.ok(view.fovDeg < 90, `${w}x${h}`);
    const camera = cameraAt(view.aspect, view.fovDeg);
    const clip = clipPlanes(camera);
    assert.ok(Number.isFinite(clip.near) && Number.isFinite(clip.far) && clip.near > 0 && clip.far > clip.near, `${w}x${h}`);
    const hit = cellAtViewPoint(view.width / 2, view.height * 0.6, { width: view.width, height: view.height }, camera);
    assert.ok(hit === null || (Number.isInteger(hit.x) && Number.isInteger(hit.y)), `${w}x${h}`);
  }
});

// --- The meadow side strips (section 3.3) ---

test('planMeadowStrips: two more planMeadow calls on the side strips with seed plus 1 and plus 2', () => {
  assert.equal(MEADOW_STRIP_INNER_X, 27);
  const [left, right] = MEADOW_STRIPS;
  assert.equal(left.bounds.minX, -GROUND_HALF_WIDTH);
  assert.equal(right.bounds.maxX, GROUND_HALF_WIDTH);
  assert.equal(left.bounds.maxX, -Math.max(MEADOW_STRIP_INNER_X, MEADOW_BOUNDS.maxX));
  assert.equal(right.bounds.minX, Math.max(MEADOW_STRIP_INNER_X, MEADOW_BOUNDS.maxX));
  for (const strip of MEADOW_STRIPS) {
    assert.equal(strip.bounds.minZ, MEADOW_BOUNDS.minZ);
    assert.equal(strip.bounds.maxZ, MEADOW_BOUNDS.maxZ);
  }
  const strips = planMeadowStrips(MEADOW_SEED);
  assert.deepEqual(strips, mergeMeadowPlans(planMeadow(MEADOW_SEED + 1, left.bounds), planMeadow(MEADOW_SEED + 2, right.bounds)));
  assert.deepEqual(planMeadowStrips(MEADOW_SEED), strips, 'deterministic');
  const items = meadowItems(strips);
  assert.ok(strips.patches.length > 10 && items.length > 200, `${strips.patches.length} patches, ${items.length} items`);
  for (const item of items) {
    const strip = item.x < 0 ? left : right;
    assert.ok(item.x >= strip.bounds.minX && item.x <= strip.bounds.maxX, `${item.kind} at x ${item.x}`);
    assert.ok(Math.abs(item.x) >= MEADOW_BOUNDS.maxX, `${item.kind} at x ${item.x} stays out of the central meadow`);
  }
  // Both sides get flowers.
  assert.ok(strips.patches.some((p) => p.x < 0) && strips.patches.some((p) => p.x > 0));
});

test('the scene draws the strips with the central meadow, hidden on Low by the existing switches', () => {
  const scene = read('src/render3d/meadow-scene.js');
  assert.match(scene, /mergeMeadowPlans\(planMeadow\(MEADOW_SEED\), planMeadowStrips\(MEADOW_SEED\)\)/);
  // Every kind a plan holds shows only with these switches, all off on Low and on for Medium and High.
  assert.match(scene, /flowers\.visible = features\.meadowFlowers !== 'off'/);
  assert.match(scene, /scenery\.visible = features\.scenery/);
  assert.match(scene, /tufts\.visible = features\.ground !== 'mown'/);
  assert.equal(QUALITY_LEVELS.low.meadowFlowers, 'off');
  assert.equal(QUALITY_LEVELS.low.scenery, false);
  assert.equal(QUALITY_LEVELS.low.ground, 'mown');
  for (const level of ['medium', 'high']) {
    assert.notEqual(QUALITY_LEVELS[level].meadowFlowers, 'off');
    assert.equal(QUALITY_LEVELS[level].scenery, true);
    assert.notEqual(QUALITY_LEVELS[level].ground, 'mown');
  }
});

// --- The page fills the window ---

test('the 3D page fills the whole window; the 2D renderer keeps its 16:9 stage', () => {
  const html = read('index.html');
  const rule = (selector) => html.match(new RegExp(`${selector.replace(/[.#]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  const stage3d = rule('body.world-3d #stage');
  assert.match(stage3d, /position: fixed;/);
  assert.match(stage3d, /inset: 0;/);
  assert.match(rule('body.world-3d #game'), /pointer-events: none;/, 'the overlay lets the pointer through to the world');
  assert.match(rule('#stage'), /width: min\(100vw, calc\(100vh \* 16 \/ 9\)\);/, 'the 2D stage is unchanged');
  const main = read('src/main.js');
  assert.match(main, /document\.body\.classList\.add\('world-3d'\)/);
  assert.match(main, /document\.body\.classList\.remove\('world-3d'\)/, 'the fallback to 2D goes back to the stage');
  assert.match(main, /const pointerCanvas = renderer === RENDERER_2D \? canvas : worldCanvas;/);
  assert.match(read('src/render3d/world-renderer.js'), /hitTest: createWorldHitTest\(world\.cameraSetup, worldCanvas\)/);
});
