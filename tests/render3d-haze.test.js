// Farmland v3.1 part 3: the horizon haze of docs/art-direction-v3-1.md
// section 5 (the pure tests of section 5.8), checked against the real
// Three.js camera where a screen position matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import { createGameCamera } from '../src/render3d/camera.js';
import { fitView, GAME_ASPECT, zoomK } from '../src/render3d/framing.js';
import {
  FLOOR_SHADE_COLOR, FLOOR_SHADE_MAX, GROUND_EDGE_FEATHER_PERCENT, GROUND_EDGE_FEATHER_Z, groundEdgeAlpha, FLOOR_SHADE_Z, floorShadeAmount, FOREST_ROW_Z, FOREST_ZONE_Z, farRidgeCrest,
  GROUND_FOG_COLOR, GROUND_FOG_END_Z, GROUND_FOG_MAX, groundFogAmount, groundZAtScreenY, HAZE_COLOR, HAZE_DEPTH_PERCENT,
  HAZE_NODES, hazeAmount, hazeViewInto, horizonScreenFraction, mixHex, nearRidgeCrest, RIDGE_CREST_HAZE, RIDGE_FADE_PX,
  RIDGE_VIRTUAL_HEIGHT, ridgeAlpha, ridgeCrest, ridgeCrestScreenFraction, ridgeHaze, ridgeHeightPx, RIDGES,
  SKY_HAZE_STOPS, WALL_BASE_Z, WALL_TOP_HAZE, wallTopHaze,
} from '../src/render3d/haze.js';
import { FAR_EDGE_Z } from '../src/render3d/horizon.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import { skyGradientStops } from '../src/render3d/sky.js';

const close = (a, b, eps, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} is not ${b} (within ${eps})`);
const read = (file) => readFileSync(new URL(`../src/render3d/${file}`, import.meta.url), 'utf8');
const code = (file) => read(file).replace(/\/\/[^\n]*/g, ''); // without line comments
const { low, medium, high } = QUALITY_LEVELS;

// Screen fraction from the top of world point (x, y, z) through the real camera at `aspect`.
function screenY(aspect, x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(createGameCamera(THREE, aspect));
  return (1 - v.y) / 2;
}

// Samples of z from well behind the wall to well in front of the meadow line.
const DEPTHS = Array.from({ length: 401 }, (_, i) => FAR_EDGE_Z - 2 + i * 0.02);

test('5.1 the colours and sky stops are the documented ones, the haze colour from one source', () => {
  assert.equal(HAZE_COLOR, '#eaf2e4');
  assert.equal(GROUND_FOG_COLOR, '#badca8');
  assert.equal(FLOOR_SHADE_COLOR, '#144628');
  assert.deepEqual(SKY_HAZE_STOPS.map(([at]) => at), [0, 0.45, 0.8, 1]);
  assert.deepEqual(SKY_HAZE_STOPS.map(([, color]) => color), ['#4a90e2', '#7fbdf0', '#c9e2ec', HAZE_COLOR]);
  // The gradient of the scene ends in the haze colour at the horizon, at any horizon.
  for (const h of [0.21, horizonScreenFraction(9 / 16), 1]) {
    const stops = skyGradientStops(h);
    assert.equal(stops[0][0], 0, 'first stop at the top');
    assert.equal(stops[stops.length - 1][0], 1, 'last stop at the bottom');
    close(stops[SKY_HAZE_STOPS.length - 1][0], h, 1e-12, 'the haze colour reaches the horizon');
    assert.equal(stops[stops.length - 1][1], SKY_HAZE_STOPS[SKY_HAZE_STOPS.length - 1][1]);
  }
});

test('5.1 the sky gradient is the same on all three levels, plain and without dithering', () => {
  assert.deepEqual(QUALITY_ORDER.map((level) => QUALITY_LEVELS[level].skyHaze), [true, true, true]);
  const sky = code('sky-scene.js');
  assert.doesNotMatch(sky, /dither/i);
  assert.doesNotMatch(sky, /'(low|medium|high)'/);
  // One gradient builder, fed by skyGradientStops of the live horizon.
  assert.match(sky, /skyGradientStops\(to\)/);
  assert.match(code('breeze-hill.js'), /sky\.setHorizon\(view\.horizon\)/);
});

test('5.2 horizonScreenFraction is the projected far edge, about 0.213 at 16:9, and grows as the window narrows', () => {
  const reference = horizonScreenFraction(GAME_ASPECT);
  close(reference, 0.213, 0.005, '16:9 horizon');
  for (const aspect of [32 / 9, 21 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 9 / 21]) {
    close(horizonScreenFraction(aspect), screenY(aspect, 0, 0, FAR_EDGE_Z), 1e-9, `aspect ${aspect}`);
  }
  let previous = 0;
  for (const aspect of [32 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 9 / 21]) {
    const h = horizonScreenFraction(aspect);
    assert.ok(h >= previous - 1e-12, `not lower at ${aspect}`);
    previous = h;
  }
  assert.equal(horizonScreenFraction(21 / 9), reference, 'the same at 16:9 and wider');
  assert.ok(horizonScreenFraction(9 / 16) > reference + 0.05, 'clearly lower on a phone');
  const view = hazeViewInto(9 / 16, {});
  assert.equal(view.horizon, horizonScreenFraction(9 / 16));
  assert.equal(view.zoom, zoomK(fitView(9 / 16)));
});

test('5.2 groundZAtScreenY turns percent below the far edge at 16:9 into world z with the real camera', () => {
  close(groundZAtScreenY(0), FAR_EDGE_Z, 1e-9, 'the far edge itself');
  for (const percent of [0.55, 2.1, 6.9, 7.2]) {
    const z = groundZAtScreenY(percent);
    close(screenY(GAME_ASPECT, 0, 0, z), horizonScreenFraction() + percent / 100, 1e-9, `${percent} percent`);
  }
  // The named world constants, each made once from its percent.
  assert.equal(WALL_BASE_Z, groundZAtScreenY(HAZE_DEPTH_PERCENT.wallBase));
  assert.deepEqual(FOREST_ROW_Z, ['row1', 'row2', 'row3'].map((row) => groundZAtScreenY(HAZE_DEPTH_PERCENT[row])));
  assert.equal(GROUND_FOG_END_Z, groundZAtScreenY(HAZE_DEPTH_PERCENT.fogEnd));
  assert.equal(FOREST_ZONE_Z, groundZAtScreenY(HAZE_DEPTH_PERCENT.forestZone));
  assert.equal(FLOOR_SHADE_Z.end, groundZAtScreenY(HAZE_DEPTH_PERCENT.floorShadeEnd));
  // Far to near: far edge, wall, rows 1 to 3, fog end, forest zone.
  const order = [FAR_EDGE_Z, WALL_BASE_Z, ...FOREST_ROW_Z, GROUND_FOG_END_Z, FOREST_ZONE_Z];
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `depth ${i} is nearer`);
  close(GROUND_FOG_END_Z - FAR_EDGE_Z, 2.2, 0.2, 'the fog is about 2.2 world units deep');
});

test('5.3 hazeAmount: its nodes, linear between, clamped outside, never rising toward the camera', () => {
  assert.deepEqual(HAZE_NODES.map(([, h]) => h), [0.42, 0.30, 0.14, 0.0]);
  assert.deepEqual(HAZE_NODES.map(([z]) => z), [WALL_BASE_Z, ...FOREST_ROW_Z]);
  for (const [z, h] of HAZE_NODES) close(hazeAmount(z), h, 1e-12, `node at ${z}`);
  for (let i = 1; i < HAZE_NODES.length; i++) {
    const [z0, h0] = HAZE_NODES[i - 1];
    const [z1, h1] = HAZE_NODES[i];
    close(hazeAmount((z0 + z1) / 2), (h0 + h1) / 2, 1e-12, 'half way');
  }
  assert.equal(hazeAmount(WALL_BASE_Z - 5), 0.42);
  assert.equal(hazeAmount(FAR_EDGE_Z - 50), 0.42);
  assert.equal(hazeAmount(FOREST_ROW_Z[2] + 0.5), 0);
  assert.equal(hazeAmount(20), 0);
  for (let i = 1; i < DEPTHS.length; i++) assert.ok(hazeAmount(DEPTHS[i]) <= hazeAmount(DEPTHS[i - 1]) + 1e-12);
});

test('5.3 wallTopHaze: 0.28 at the top of the strip, 0 at its base, falling', () => {
  assert.equal(WALL_TOP_HAZE, 0.28);
  assert.equal(wallTopHaze(0), 0.28);
  assert.equal(wallTopHaze(1), 0);
  for (let v = 0.01; v <= 1; v += 0.01) assert.ok(wallTopHaze(v) <= wallTopHaze(v - 0.01) + 1e-12);
  close(wallTopHaze(0.5), 0.14, 1e-12, 'half way');
});

test('5.4 groundFogAmount: 0.55 at the far edge, 0 from the fog end on, falling', () => {
  assert.equal(GROUND_FOG_MAX, 0.55);
  assert.equal(groundFogAmount(FAR_EDGE_Z), 0.55);
  assert.equal(groundFogAmount(GROUND_FOG_END_Z), 0);
  assert.equal(groundFogAmount(GROUND_FOG_END_Z + 3), 0);
  assert.equal(groundFogAmount(0), 0, 'the board is clear');
  for (let i = 1; i < DEPTHS.length; i++) assert.ok(groundFogAmount(DEPTHS[i]) <= groundFogAmount(DEPTHS[i - 1]) + 1e-12);
});

test('5.4 the ground edge feathers its alpha over a few percent of the screen, so no hard line shows', () => {
  close(screenY(GAME_ASPECT, 0, 0, FAR_EDGE_Z + GROUND_EDGE_FEATHER_Z), horizonScreenFraction() + GROUND_EDGE_FEATHER_PERCENT / 100, 1e-9);
  assert.ok(GROUND_EDGE_FEATHER_Z < GROUND_FOG_END_Z - FAR_EDGE_Z, 'inside the fog');
  assert.equal(groundEdgeAlpha(0), 0, 'see-through at the very edge');
  assert.equal(groundEdgeAlpha(GROUND_EDGE_FEATHER_Z), 1);
  assert.equal(groundEdgeAlpha(10), 1, 'solid everywhere else');
  for (let d = 0.01; d <= GROUND_EDGE_FEATHER_Z; d += 0.01) assert.ok(groundEdgeAlpha(d) >= groundEdgeAlpha(d - 0.01));
  assert.ok(code('meadow-scene.js').includes('diffuseColor.a *= smoothstep(0.0, ${f(GROUND_EDGE_FEATHER_Z)}, vEdge);'));
});

test('5.5 floorShadeAmount: 0 at the far edge, 0.20 on its plateau and never more, 0 at its end and in front', () => {
  assert.equal(FLOOR_SHADE_MAX, 0.20);
  assert.equal(floorShadeAmount(FAR_EDGE_Z), 0);
  assert.ok(FLOOR_SHADE_Z.in < FLOOR_SHADE_Z.out && FLOOR_SHADE_Z.out < FLOOR_SHADE_Z.end);
  for (const z of [FLOOR_SHADE_Z.in, (FLOOR_SHADE_Z.in + FLOOR_SHADE_Z.out) / 2, FLOOR_SHADE_Z.out]) {
    close(floorShadeAmount(z), 0.20, 1e-12, `plateau at ${z}`);
  }
  assert.equal(floorShadeAmount(FLOOR_SHADE_Z.end), 0);
  assert.equal(floorShadeAmount(FLOOR_SHADE_Z.end + 1), 0);
  assert.equal(floorShadeAmount(0), 0);
  for (const z of DEPTHS) assert.ok(floorShadeAmount(z) >= 0 && floorShadeAmount(z) <= 0.20 + 1e-12, `${z}`);
  assert.ok(FLOOR_SHADE_Z.end < FOREST_ZONE_Z, 'it fades out before the meadow starts');
});

test('5.6 the two ridges: colours, sums of sines, alpha feather and haze', () => {
  const [far, near] = RIDGES;
  assert.deepEqual([far.name, far.color, far.featherPx, far.haze], ['far', '#96cc9c', 40, 0.55]);
  assert.deepEqual([near.name, near.color, near.featherPx, near.haze], ['near', '#7abe80', 30, 0.38]);
  for (const x of [0, 137, 512, 1920, 5000]) {
    close(farRidgeCrest(x), 93 - 16 * Math.sin(x / 330 + 1.1) - 8 * Math.sin(x / 140 + 0.4), 1e-12, 'far crest');
    close(nearRidgeCrest(x), 63 - 11 * Math.sin(x / 230 + 2.3) - 6 * Math.sin(x / 95 + 1.7), 1e-12, 'near crest');
  }
  for (const ridge of RIDGES) {
    assert.equal(ridgeAlpha(ridge, 0), 0, 'see-through at the crest');
    assert.equal(ridgeAlpha(ridge, ridge.featherPx), 1);
    assert.ok(ridgeAlpha(ridge, ridge.featherPx / 2) > 0 && ridgeAlpha(ridge, ridge.featherPx / 2) < 1);
    close(ridgeHaze(ridge, 0), ridge.haze + RIDGE_CREST_HAZE, 1e-12, 'hazier at the crest');
    close(ridgeHaze(ridge, RIDGE_FADE_PX), ridge.haze, 1e-12);
    close(ridgeHaze(ridge, RIDGE_FADE_PX * 3), ridge.haze, 1e-12);
  }
  assert.equal(RIDGE_CREST_HAZE, 0.30);
  assert.equal(RIDGE_FADE_PX, 90);
  assert.deepEqual(mixHex(far.color, HAZE_COLOR, 1).map((v) => Math.round(v * 255)), [0xea, 0xf2, 0xe4]);
});

test('5.6 the crests at 16:9 lie within the documented ranges (far 10.6 to 15.0, near 14.0 to 17.1 percent)', () => {
  const ranges = { far: [10.6, 15.0], near: [14.0, 17.1] };
  for (const ridge of RIDGES) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let fx = 0; fx <= 1; fx += 1 / 1920) {
      const y = ridgeCrestScreenFraction(ridge, fx) * 100;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const [min, max] = ranges[ridge.name];
    assert.ok(lo >= min - 0.4 && hi <= max + 0.4, `${ridge.name}: ${lo} to ${hi}`);
    assert.ok(hi < horizonScreenFraction() * 100, 'above the horizon');
  }
});

test('5.6 the crest height above the horizon scales with zoomK and with the screen height, not its width', () => {
  const zoom = zoomK(fitView(9 / 16));
  assert.ok(zoom < 1);
  for (const ridge of RIDGES) {
    for (const xPx of [0, 300, 1000]) {
      close(ridgeHeightPx(ridge, xPx, 1080, zoom), zoom * ridgeHeightPx(ridge, xPx, 1080, 1), 1e-9, 'zoomK');
      close(ridgeHeightPx(ridge, xPx, 1080), ridgeCrest(ridge, xPx), 1e-9, 'virtual px at 1080');
      // The same shape on a screen half as tall: half the height at half the x.
      close(ridgeHeightPx(ridge, xPx / 2, RIDGE_VIRTUAL_HEIGHT / 2), ridgeHeightPx(ridge, xPx, RIDGE_VIRTUAL_HEIGHT) / 2, 1e-9);
    }
  }
});

test('5.6 the ridges are one screen layer with a feathered crest and no blur, its numbers from haze.js', () => {
  const ridges = code('ridges-scene.js');
  assert.match(ridges, /RIDGES\.map\(layerGlsl\)/);
  assert.match(ridges, /smoothstep\(0\.0, \$\{glslFloat\(ridge\.featherPx\)\} \* uZoom, depth\)/);
  assert.match(ridges, /mix\(\$\{glslColor\(ridge\.color\)\}, HAZE, haze\)/);
  assert.match(ridges, /mesh\.visible = features\.ridges;/);
  assert.doesNotMatch(ridges, /blur|'(low|medium|high)'/i);
  assert.doesNotMatch(code('haze.js'), /blur/i);
  // The old flat hill band is gone from the scene.
  assert.doesNotMatch(code('meadow-scene.js'), /createFarHills|FAR_HILLS|features\.farHills/);
});

test('5.4 and 5.5 the ground material mixes in the fog and the floor shade from haze.js, the ground only', () => {
  const meadow = code('meadow-scene.js');
  assert.match(meadow, /function withGroundHaze\(shader, haze\)/);
  for (const name of ['GROUND_FOG_MAX', 'GROUND_FOG_END_Z', 'FLOOR_SHADE_MAX', 'FLOOR_SHADE_Z.in', 'FLOOR_SHADE_Z.out', 'FLOOR_SHADE_Z.end', 'FAR_EDGE_Z']) {
    assert.ok(meadow.includes(`\${f(${name})}`), `${name} feeds the shader`);
  }
  // Both ground looks (Low's mown stripes and the painted meadow) get it.
  assert.equal((meadow.match(/withGroundHaze\(shader, haze\)/g) ?? []).length, 3); // the definition and two uses
  assert.match(meadow, /ground\.setHaze\(features\.groundFog, features\.floorShade\)/);
  // No sprite material reads the ground haze.
  const billboard = meadow.slice(meadow.indexOf('function meadowMaterial('));
  assert.doesNotMatch(billboard.slice(0, billboard.indexOf('\n}\n')), /uGroundFog|withGroundHaze/);
});

test('section 7 quality rows: sky haze and ground fog everywhere, ridges off on Low, floor shade on High only', () => {
  assert.deepEqual([low, medium, high].map((l) => l.skyHaze), [true, true, true]);
  assert.deepEqual([low, medium, high].map((l) => l.groundFog), [true, true, true]);
  assert.deepEqual([low, medium, high].map((l) => l.ridges), [false, true, true]);
  assert.deepEqual([low, medium, high].map((l) => l.floorShade), [false, false, true]);
  const keys = Object.keys(medium).sort();
  assert.deepEqual(Object.keys(low).sort(), keys);
  assert.deepEqual(Object.keys(high).sort(), keys);
  assert.ok(!('farHills' in medium), 'the old hill band switch is gone');
  // Medium has no blur in the scene at all.
  assert.equal(medium.postEffects.depthOfField, false);
  assert.equal(medium.wind, false, 'no blurred far petal lane');
});
