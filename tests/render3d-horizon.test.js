// Farmland v3 part 6c: the flat meadow, its far edge (the horizon), the far
// hills, the back row of trees and the field framing, all checked by
// projecting points through the real Three.js camera the game builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {
  CLOUD_LAYERS, DRIFT_CLOUD_BOTTOMS, MEADOW_SEED, MEADOW_TREES_BACK, MEADOW_TREES_BACK_MAX, MEADOW_TREES_SIDE,
  PX_WORLD, SKY_HORIZON_FRACTION, SKY_STRIP_FRACTION, SPRITE_STRETCH_Y, STILL_CLOUDS,
} from '../src/config.js';
import { CAMERA_TARGET, createGameCamera, gameCamera, heightAtDepression } from '../src/render3d/camera.js';
import { CURB, FIELD } from '../src/render3d/farm-layout.js';
import { ASPECTS, CAMERA_POSE, FAR_EDGE_NDC_Y, fitView, FRAMING } from '../src/render3d/framing.js';
import {
  FAR_EDGE_Z, farEdgeWave, farEdgeZ, GROUND_RECT, groundUnderNdc, screenEdgeX, SIDE_TREE_MAX_Z, TREE_ROW_HALF_WIDTH,
} from '../src/render3d/horizon.js';
import { FAR_HILLS, HILL_DEPTH, hillLift, MEADOW_BOUNDS, meadowItems, planMeadow } from '../src/render3d/meadow.js';
import { planDriftClouds, planStillClouds, viewHalfExtent } from '../src/render3d/sky.js';
import { GROUND_Y, groundMeshHeight, TERRAIN_GRID, terrainHeight } from '../src/render3d/terrain.js';
import { boardScreenRect } from '../src/ui/hud-layout.js';
import { BOARD_SIZE, CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CAMERA_TARGET_Z, CELL_SIZE } from '../src/config.js';

const ASPECT_16_9 = ASPECTS['16:9'];
const read = (file) => readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8');
const inRange = (value, { min, max }, what) => assert.ok(value >= min && value <= max, `${what}: ${value} not in ${min} to ${max}`);

// Screen percentages { x from the left, y from the top } of a world point
// through the real Three.js camera at `aspect`.
function project(camera, x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: ((v.x + 1) / 2) * 100, y: ((1 - v.y) / 2) * 100 };
}
// Where the real camera's ray through NDC (x, y) meets y = 0.
function groundAt(camera, ndcX, ndcY) {
  const origin = camera.position.clone();
  const direction = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const s = -origin.y / direction.y;
  return { x: origin.x + direction.x * s, z: origin.z + direction.z * s };
}

const CAMERA = createGameCamera(THREE, ASPECT_16_9);
const plan = planMeadow(MEADOW_SEED);
const backRow = plan.trees.filter((t) => t.z < -10);
const sideTrees = plan.trees.filter((t) => t.z >= -10);
// The tree sheet's anchor pixel (its trunk base) is this many rows below the top.
const TREE_ANCHOR_PX = JSON.parse(readFileSync(new URL('../assets/v3-meta.json', import.meta.url), 'utf8')).trees.anchor[1];

test('(1) the ground is flat: height exactly 0 over the whole ground', () => {
  assert.equal(GROUND_Y, 0);
  const { minX, maxX, minZ, maxZ } = TERRAIN_GRID;
  let most = 0;
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 100; j++) {
      const x = minX + ((maxX - minX) * i) / 99;
      const z = minZ + ((maxZ - minZ) * j) / 99;
      most = Math.max(most, Math.abs(terrainHeight(x, z)), Math.abs(groundMeshHeight(x, z)));
    }
  }
  assert.equal(most, 0);
  // The field, the curb's footing and everything in the meadow stand on y = 0.
  assert.equal(FIELD.y, 0);
  assert.equal(CURB.ground, 0);
  const scene = read('meadow-scene.js');
  assert.doesNotMatch(scene, /drapedGrid|terrainHeight\(|groundMeshHeight\(|position\.setY\(i, (?!GROUND_Y\))/, 'nothing is draped over heights');
  assert.match(scene, /const y = GROUND_Y;/, 'billboards stand on the ground plane');
  assert.doesNotMatch(read('terrain.js'), /Math\.(sin|hypot|sqrt)|plateau/i, 'no hills, rim or radial fall-off');
});

test('(2) the ground is a rectangle reaching 3 units past the left, right and bottom screen edges', () => {
  const ground = read('meadow-scene.js').match(/function createGround\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(ground, /new THREE\.PlaneGeometry\(/);
  assert.doesNotMatch(ground, /Circle|Ring|hypot|sqrt|atan2|Math\.cos/, 'no circular or elliptical outline');
  assert.deepEqual(TERRAIN_GRID, { ...GROUND_RECT, cell: TERRAIN_GRID.cell });
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    const camera = createGameCamera(THREE, aspect);
    for (let k = 0; k <= 40; k++) {
      const ndcY = -1 + ((FAR_EDGE_NDC_Y + 1) * k) / 40; // up the screen sides to the far edge
      const left = groundAt(camera, -1, ndcY);
      const right = groundAt(camera, 1, ndcY);
      assert.ok(left.x - GROUND_RECT.minX >= 3, `${name}: left edge at ${left.x}`);
      assert.ok(GROUND_RECT.maxX - right.x >= 3, `${name}: right edge at ${right.x}`);
      const bottom = groundAt(camera, -1 + (2 * k) / 40, -1);
      assert.ok(GROUND_RECT.maxZ - bottom.z >= 3, `${name}: bottom edge at ${bottom.z}`);
      assert.ok(bottom.x - GROUND_RECT.minX >= 3 && GROUND_RECT.maxX - bottom.x >= 3, `${name}: bottom corner`);
    }
  }
});

test('(2) the meadow is planted over all of the ground the camera sees', () => {
  assert.equal(MEADOW_BOUNDS.minZ, FAR_EDGE_Z);
  const bottom = groundAt(CAMERA, 0, -1);
  assert.ok(MEADOW_BOUNDS.maxZ >= bottom.z, 'down to the bottom of the screen');
  for (const ndcY of [-1, 0, FAR_EDGE_NDC_Y]) {
    const g = groundAt(CAMERA, 1, ndcY);
    assert.ok(MEADOW_BOUNDS.maxX >= g.x && MEADOW_BOUNDS.minX <= -g.x, `out to the screen sides at ${ndcY}`);
  }
  // Flowers, tufts and bushes reach every part of the visible ground: each
  // ninth of the screen below the far edge beside or in front of the field
  // has some (the middle column's upper two are the field and its fence).
  const seen = new Set();
  for (const item of meadowItems(plan).filter((i) => i.kind !== 'tree')) {
    const p = project(CAMERA, item.x, 0, item.z);
    if (p.x < 0 || p.x >= 100 || p.y < 21 || p.y >= 100) continue;
    seen.add(`${Math.floor(p.x / 33.4)},${Math.floor((p.y - 21) / 26.4)}`);
  }
  for (const cell of ['0,0', '0,1', '0,2', '2,0', '2,1', '2,2', '1,2']) assert.ok(seen.has(cell), `${cell}: ${[...seen].join(' ')}`);
});

test('(3) farEdgeZ: the far edge projects 21 percent down the screen at every aspect', () => {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    const camera = createGameCamera(THREE, aspect);
    const z = farEdgeZ(camera, aspect);
    assert.ok(Math.abs(z - farEdgeZ(gameCamera(aspect), aspect)) < 1e-9, `${name}: a Three.js camera and the plain one agree`);
    const range = name === '9:16' ? FRAMING.farEdgeYPortrait : FRAMING.farEdgeY;
    for (const x of [-3, 0, 4]) inRange(project(camera, x, 0, z).y, range, `${name} far edge`);
  }
  assert.equal(FAR_EDGE_NDC_Y, 0.58);
  assert.ok(Math.abs(project(CAMERA, 0, 0, FAR_EDGE_Z).y - 21) < 1e-6, 'exactly 21 percent at 16:9');
  assert.equal(GROUND_RECT.minZ, FAR_EDGE_Z, 'the ground ends at the far edge');
  assert.ok(Math.abs(SKY_HORIZON_FRACTION - 0.21) < 1e-9, 'the sky gradient reaches the horizon there');
  // The ray maths: the ground under the far edge point is on y = 0.
  const g = groundUnderNdc(gameCamera(), 0, FAR_EDGE_NDC_Y);
  assert.ok(Math.abs(g.z - FAR_EDGE_Z) < 1e-9);
});

test('(3) Low: the far edge is a gentle wavy line at most 1 percent of the screen tall', () => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = GROUND_RECT.minX; x <= GROUND_RECT.maxX; x += 0.25) {
    const p = project(CAMERA, x, 0, FAR_EDGE_Z + farEdgeWave(x));
    if (p.x < 0 || p.x > 100) continue;
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  }
  assert.ok(hi - lo > 0.1, 'it does wave');
  assert.ok(hi - lo <= FRAMING.lowEdgeWaveY.max, `${hi - lo} percent tall`);
  inRange(lo, FRAMING.farEdgeY, 'wave top');
  inRange(hi, FRAMING.farEdgeY, 'wave bottom');
});

test('(3) both far hills crest 15 to 19 percent down, their feet hidden below the far edge', () => {
  const pos = CAMERA.position;
  for (const hill of FAR_HILLS) {
    assert.ok(hill.z < FAR_EDGE_Z, 'behind the far edge');
    for (let x = -60; x <= 60; x += 0.5) {
      const top = heightAtDepression(pos, pos.x, hill.z, hill.depressionDeg - hillLift(hill, x));
      const crest = project(CAMERA, x, top, hill.z);
      if (crest.x < 0 || crest.x > 100) continue;
      inRange(crest.y, FRAMING.hillCrestY, `hill at z ${hill.z}, x ${x}`);
      assert.ok(project(CAMERA, x, top - HILL_DEPTH, hill.z).y > 30, 'its foot is well below the far edge');
    }
  }
  assert.ok(SKY_STRIP_FRACTION * 100 <= FRAMING.hillCrestY.min, 'the clouds stay above the lowest crest');
});

test('(3) every cloud shows whole in the sky strip above the hills, behind the trees', () => {
  const frac = (c, y) => (1 - y / viewHalfExtent(c.depth).halfH) / 2;
  for (const c of [...planStillClouds(), ...planDriftClouds()]) {
    assert.ok(frac(c, c.y + c.height) >= 0, 'top not cut off');
    assert.ok(frac(c, c.y) <= SKY_STRIP_FRACTION, `bottom ${frac(c, c.y)} above the hill crests`);
  }
  assert.equal(STILL_CLOUDS.length, 4);
  assert.equal(DRIFT_CLOUD_BOTTOMS.far.length + DRIFT_CLOUD_BOTTOMS.near.length, 8);
  // Depth along the view: trees < clouds < hills.
  const forward = new THREE.Vector3();
  CAMERA.getWorldDirection(forward);
  const depth = (x, y, z) => new THREE.Vector3(x, y, z).sub(CAMERA.position).dot(forward);
  const treeDepth = Math.max(...backRow.map((t) => depth(t.x, 0, t.z)));
  const hill = FAR_HILLS[FAR_HILLS.length - 1];
  const hillDepth = depth(0, heightAtDepression(CAMERA.position, 0, hill.z, hill.depressionDeg), hill.z);
  for (const layer of Object.values(CLOUD_LAYERS)) {
    assert.ok(layer.depth > treeDepth && layer.depth < hillDepth, `${treeDepth} < ${layer.depth} < ${hillDepth}`);
  }
});

test('(4) the back row of trees stands just in front of the far edge, bases 22 to 25 percent down', () => {
  assert.ok(backRow.length <= MEADOW_TREES_BACK_MAX && backRow.length >= 16, `${backRow.length} trees`);
  const treeTop = TREE_ANCHOR_PX * PX_WORLD * SPRITE_STRETCH_Y;
  for (const tree of backRow) {
    assert.equal(tree.scale, 1);
    assert.ok(tree.z > FAR_EDGE_Z, 'in front of the far edge');
    inRange(project(CAMERA, tree.x, 0, tree.z).y, FRAMING.treeBaseY, 'trunk base');
    inRange(project(CAMERA, tree.x, treeTop, tree.z).y, FRAMING.treeCrownY, 'crown top at scale 1');
  }
  // 12 to 14 on screen at 16:9; the row runs past the screen at 21:9 plus 2 units each side.
  const onScreen = backRow.filter((t) => {
    const x = project(CAMERA, t.x, 0, t.z).x;
    return x >= 0 && x <= 100;
  });
  assert.ok(onScreen.length >= MEADOW_TREES_BACK[0] && onScreen.length <= MEADOW_TREES_BACK[1], `${onScreen.length} on screen`);
  const xs = backRow.map((t) => t.x).sort((a, b) => a - b);
  const wide = screenEdgeX(gameCamera(), ASPECTS['21:9'], FAR_EDGE_Z, 1);
  assert.ok(TREE_ROW_HALF_WIDTH >= wide + 2 - 1e-9);
  assert.ok(xs[0] < -wide && xs[xs.length - 1] > wide, 'past both screen edges at 21:9');
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] < 5, `no gap between ${xs[i - 1]} and ${xs[i]}`);
});

test('(4) the 4 to 6 side trees stay in the back third of the visible ground', () => {
  assert.ok(sideTrees.length >= MEADOW_TREES_SIDE[0] && sideTrees.length <= MEADOW_TREES_SIDE[1], `${sideTrees.length}`);
  const bottom = groundAt(CAMERA, 0, -1).z;
  assert.ok(Math.abs(SIDE_TREE_MAX_Z - (FAR_EDGE_Z + (bottom - FAR_EDGE_Z) / 3)) < 1e-6);
  for (const tree of sideTrees) {
    assert.ok(tree.z <= SIDE_TREE_MAX_Z, `side tree at z ${tree.z}`);
    assert.ok(Math.abs(tree.x) > 10, 'left or right of the fence');
    assert.equal(tree.scale, 1);
  }
  assert.ok(sideTrees.some((t) => t.x < 0) && sideTrees.some((t) => t.x > 0));
});

test('(5) field framing at 16:9: the outer curb corners make the right trapezoid', () => {
  const o = CURB.inner + CURB.width;
  const [bl, br, fl, fr] = [[-o, -o], [o, -o], [-o, o], [o, o]].map(([x, z]) => project(CAMERA, x, CURB.top, z));
  assert.ok(Math.abs(bl.y - br.y) < 1e-9 && Math.abs(fl.y - fr.y) < 1e-9, 'level edges');
  inRange(bl.y, FRAMING.fieldBackY, 'back edge');
  inRange(fl.y, FRAMING.fieldFrontY, 'front edge');
  inRange(br.x - bl.x, FRAMING.fieldBackWidth, 'back width');
  inRange(fr.x - fl.x, FRAMING.fieldFrontWidth, 'front width');
  inRange((bl.x + br.x + fl.x + fr.x) / 4, FRAMING.fieldCentreX, 'centre');
  // The targets sit inside their ranges.
  for (const key of ['farEdgeY', 'fieldBackY', 'fieldFrontY', 'fieldBackWidth', 'fieldFrontWidth', 'fieldCentreX']) {
    inRange(FRAMING[key].target, FRAMING[key], key);
  }
});

test('(5) the camera pose lives in framing.js: pitch, field of view, distance and an aim point behind the board centre', () => {
  assert.deepEqual({ ...CAMERA_POSE }, { pitchDeg: 45, fovDeg: 17, distance: 65.5, aimBehind: 2.2 });
  // config.js names read the same pose, nothing keeps its own copy.
  assert.equal(CAMERA_FOV, CAMERA_POSE.fovDeg);
  assert.equal(CAMERA_PITCH_DEG, CAMERA_POSE.pitchDeg);
  assert.equal(CAMERA_DISTANCE, CAMERA_POSE.distance);
  assert.equal(CAMERA_TARGET_Z, -CAMERA_POSE.aimBehind);
  // The aim point is on the board's centre line, behind its centre, with no sideways offset.
  assert.deepEqual(CAMERA_TARGET, { x: 0, y: 0, z: -CAMERA_POSE.aimBehind });
  assert.equal(CAMERA.position.x, 0);
  assert.ok(Math.abs(CAMERA.fov - CAMERA_POSE.fovDeg) < 1e-12);
  const hud = readFileSync(new URL('../src/ui/hud-layout.js', import.meta.url), 'utf8');
  assert.match(hud, /gameCamera\(/, 'the HUD layout projects through the shared game camera');
  assert.doesNotMatch(hud, /CAMERA_(FOV|PITCH_DEG|DISTANCE|TARGET_Z)|cameraPosition\(/, 'no copy of the camera maths in the HUD layout');
});

test('(5) the HUD layout board rectangle matches the real PerspectiveCamera within 1 pixel', () => {
  const half = (BOARD_SIZE * CELL_SIZE) / 2;
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 600], [1680, 720], [720, 1280], [390, 844]]) {
    // The view fills the whole window, its field of view from fitView
    // (docs/art-direction-v3-1.md section 3).
    const camera = new THREE.PerspectiveCamera(fitView(w / h), w / h, 0.5, 260);
    const target = new THREE.Vector3(0, 0, -CAMERA_POSE.aimBehind);
    const pitch = (CAMERA_POSE.pitchDeg * Math.PI) / 180;
    camera.position.set(0, Math.sin(pitch) * CAMERA_POSE.distance, target.z + Math.cos(pitch) * CAMERA_POSE.distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const real = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const x of [-half, half]) {
      for (const z of [-half, half]) {
        const v = new THREE.Vector3(x, 0, z).project(camera);
        const px = ((v.x + 1) / 2) * w;
        const py = ((1 - v.y) / 2) * h;
        real.left = Math.min(real.left, px);
        real.right = Math.max(real.right, px);
        real.top = Math.min(real.top, py);
        real.bottom = Math.max(real.bottom, py);
      }
    }
    const hud = boardScreenRect(w, h);
    for (const side of ['left', 'right', 'top', 'bottom']) {
      assert.ok(Math.abs(hud[side] - real[side]) <= 1, `${w}x${h} ${side}: HUD ${hud[side]}, camera ${real[side]}`);
    }
  }
});
