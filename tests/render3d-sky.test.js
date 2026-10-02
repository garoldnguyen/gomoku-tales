import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CLOUD_LAYERS, DRIFT_CLOUD_BOTTOMS, PETAL_TRAIL_ALPHA, PETAL_TRAIL_MS,
  PX_WORLD, SKY_HORIZON_FRACTION, STILL_CLOUDS, SUN_RAY_COUNT, SUN_RAY_PERIOD_MS, WIND_LANES, WISP_ALPHA, WISP_COUNT,
  WISP_HEIGHTS,
} from '../src/config.js';
import { ART, PLACEHOLDERS_3D } from '../src/render3d/art-assets.js';
import { cameraPosition, cameraRay, projectToNdc } from '../src/render3d/camera.js';
import { FAR_HILLS } from '../src/render3d/meadow.js';
import { fieldFade, laneVelocity, LANE_NAMES, petalAt, petalPoint, planPetals, trailAt } from '../src/render3d/petals.js';
import { QUALITY_LEVELS } from '../src/render3d/quality.js';
import * as config from '../src/config.js';
import {
  pixelWorldAt, planDriftClouds, planStillClouds, planWisps, SCREEN_WIND, screenToView, SKY_ALPHA_CUTOFF,
  skyDrift, skyGradientStops, skyPixelDiscarded, sunRayAlpha, VIEW_ASPECT, viewHalfExtent, windOnScreen, wrapAround,
  wrapRange,
} from '../src/render3d/sky.js';
import { terrainHeight } from '../src/render3d/terrain.js';
import { WIND_GROUND } from '../src/render3d/wind.js';

const camera = cameraPosition(CAMERA_PITCH_DEG, CAMERA_DISTANCE);
const setup = { position: camera, target: { x: 0, y: 0, z: 0 }, fovDeg: CAMERA_FOV, aspect: VIEW_ASPECT };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const along = (p) => p.x * WIND_GROUND.x + p.z * WIND_GROUND.z;

test('sky: the gradient of section 7 from the top of the view down to the horizon', () => {
  const h = SKY_HORIZON_FRACTION;
  assert.deepEqual(skyGradientStops(), [
    [0, '#4a90e2'], [0.45 * h, '#7fbdf0'], [0.8 * h, '#cfe8f8'], [h, '#f4f0d8'], [1, '#f4f0d8'],
  ]);
  assert.deepEqual(skyGradientStops(1).map(([at]) => at), [0, 0.45, 0.8, 1]);
});

test('sky: the horizon is where the meadow crest meets the sky in the middle of the view', () => {
  // March down the centre column of the view until a ray hits the ground.
  let crest = null;
  for (let ndcY = 1; ndcY > -1 && crest === null; ndcY -= 0.002) {
    const { origin, direction } = cameraRay(0, ndcY, setup);
    for (let s = 0; s < 200; s += 0.25) {
      const z = origin.z + direction.z * s;
      if (z < -36) break;
      if (origin.y + direction.y * s < terrainHeight(origin.x + direction.x * s, z)) {
        crest = (1 - ndcY) / 2;
        break;
      }
    }
  }
  assert.ok(Math.abs(crest - SKY_HORIZON_FRACTION) < 0.01, `crest at ${crest}`);
});

test('quality: Low has the plain gradient only, Medium still clouds, High drifting clouds and wind', () => {
  assert.equal(QUALITY_LEVELS.low.sky, 'gradient');
  assert.equal(QUALITY_LEVELS.low.wind, false);
  assert.equal(QUALITY_LEVELS.medium.sky, 'still-clouds');
  assert.equal(QUALITY_LEVELS.medium.backgroundMotion, false);
  assert.equal(QUALITY_LEVELS.high.sky, 'drifting-clouds');
  assert.equal(QUALITY_LEVELS.high.wind, true);
  assert.equal(QUALITY_LEVELS.high.backgroundMotion, true);
});

test('clouds: screen spots map into camera space and back', () => {
  const depth = 60;
  const { halfW, halfH } = viewHalfExtent(depth);
  assert.ok(close(halfH, Math.tan((CAMERA_FOV * Math.PI) / 360) * depth));
  assert.ok(close(halfW, halfH * VIEW_ASPECT));
  assert.deepEqual(screenToView(0.5, 0.5, depth), { x: 0, y: 0 });
  const corner = screenToView(0, 0, depth);
  assert.ok(close(corner.x, -halfW) && close(corner.y, halfH));
  // At scale 1 a cloud pixel looks as big as a board pixel; the far layer is 0.6 of it.
  assert.equal(pixelWorldAt(CAMERA_DISTANCE), PX_WORLD);
  assert.ok(close(pixelWorldAt(depth, 0.6) / depth, (PX_WORLD * 0.6) / CAMERA_DISTANCE));
});

test('clouds: Medium has 4 still clouds at about 14, 50, 78 and 90 percent across, 8 to 16 percent down', () => {
  const clouds = planStillClouds();
  assert.equal(clouds.length, 4);
  clouds.forEach((cloud, i) => {
    const { halfW, halfH } = viewHalfExtent(cloud.depth);
    const fx = (cloud.x / halfW + 1) / 2;
    const fy = (1 - cloud.y / halfH) / 2;
    assert.ok(close(fx, STILL_CLOUDS[i].x, 1e-9), `x ${fx}`);
    assert.ok(fy >= 0.08 && fy <= 0.16, `bottom ${fy}`);
    assert.ok(fy < SKY_HORIZON_FRACTION, 'the meadow crest never cuts a cloud bottom');
  });
  assert.deepEqual(STILL_CLOUDS.map((spot) => spot.x), [0.14, 0.5, 0.78, 0.9]);
});

test('clouds: High has 8 clouds, far layer scale 0.6 at 0.35 and near layer scale 1.0 at 0.6', () => {
  const clouds = planDriftClouds();
  assert.equal(clouds.length, 8);
  const far = clouds.filter((c) => c.layer === 'far');
  const near = clouds.filter((c) => c.layer === 'near');
  assert.equal(far.length, 4);
  assert.equal(near.length, 4);
  assert.deepEqual(CLOUD_LAYERS.far, { ...CLOUD_LAYERS.far, scale: 0.6, speed: 0.35 });
  assert.deepEqual(CLOUD_LAYERS.near, { ...CLOUD_LAYERS.near, scale: 1.0, speed: 0.6 });
  for (const c of far) assert.ok(c.speed === 0.35 && close(c.pxWorld, pixelWorldAt(c.depth, 0.6)));
  for (const c of near) assert.ok(c.speed === 0.6 && close(c.pxWorld, pixelWorldAt(c.depth, 1)));
  assert.ok(CLOUD_LAYERS.far.depth > CLOUD_LAYERS.near.depth, 'the far layer is farther');
  for (const c of clouds) assert.ok(c.x >= c.range.min && c.x < c.range.min + c.range.span);
  assert.deepEqual(planDriftClouds(), clouds, 'deterministic');
});

test('clouds stand in front of the far hills', () => {
  // The depth along the view of the nearer hill's top, straight ahead.
  const hill = FAR_HILLS[FAR_HILLS.length - 1];
  const dz = camera.z - hill.z;
  const dy = dz * Math.tan((hill.depressionDeg * Math.PI) / 180);
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const hillDepth = dy * Math.sin(pitch) + dz * Math.cos(pitch);
  for (const layer of Object.values(CLOUD_LAYERS)) assert.ok(layer.depth < hillDepth, `${layer.depth} < ${hillDepth}`);
});

test('the one wind looks right and a little down on screen, as the ground wind looks', () => {
  assert.ok(close(Math.hypot(SCREEN_WIND.x, SCREEN_WIND.y), 1));
  assert.ok(SCREEN_WIND.x > 0 && SCREEN_WIND.y < 0, 'from the upper left toward the lower right');
  assert.deepEqual(windOnScreen(), SCREEN_WIND);
  // A small step along WIND_GROUND at the board centre, seen through the real camera.
  const step = 1e-4;
  const a = projectToNdc({ x: 0, y: 0, z: 0 }, setup);
  const b = projectToNdc({ x: WIND_GROUND.x * step, y: 0, z: WIND_GROUND.z * step }, setup);
  const { halfW, halfH } = viewHalfExtent(1);
  const dx = (b.x - a.x) * halfW;
  const dy = (b.y - a.y) * halfH;
  const len = Math.hypot(dx, dy);
  assert.ok(close(dx / len, SCREEN_WIND.x, 1e-6) && close(dy / len, SCREEN_WIND.y, 1e-6), `${dx / len}, ${dy / len}`);
  const degreesDown = (Math.atan2(-SCREEN_WIND.y, SCREEN_WIND.x) * 180) / Math.PI;
  assert.ok(degreesDown > 12 && degreesDown < 20, `about 16 degrees down, ${degreesDown}`);
});

test('clouds and wisps drift straight to the right at their layer speed and never sink', () => {
  const out = { x: 0, y: 0 };
  for (const c of [...planDriftClouds(), ...planWisps()]) {
    const { x: x0, y: y0 } = skyDrift(c, 0, out);
    assert.ok(close(x0, c.x) && close(y0, c.y), 'starts at its plan');
    for (let t = 0; t < 600000; t += 997) {
      const { x: xa, y: ya } = skyDrift(c, t, out);
      assert.equal(ya, c.y, 'keeps its height');
      const { x: xb } = skyDrift(c, t + 200, out);
      if (xb < xa) continue; // wrapped just now
      assert.ok(close(xb - xa, c.speed * 0.2, 1e-9), 'right at its layer speed');
    }
  }
  for (const w of planWisps()) assert.equal(w.speed, 0.35);
  // The sinking is gone, config and all.
  for (const name of ['CLOUD_SINK_BOTTOM', 'CLOUD_SINK_FADE', 'WISP_SINK_BOTTOM']) assert.equal(config[name], undefined, name);
});

test('cloud wrap-around: sideways only, out of sight on the right, back in out of sight on the left', () => {
  for (const value of [-25, -10.5, -10, 0, 3.3, 10, 29.9, 30, 1e6 + 0.25]) {
    const w = wrapAround(value, -10, 40);
    assert.ok(w >= -10 && w < 30, `${value} -> ${w}`);
    const turns = (w - value) / 40;
    assert.ok(close(turns, Math.round(turns), 1e-6), 'moved by whole spans only');
  }
  const out = { x: 0, y: 0 };
  for (const c of [...planDriftClouds(), ...planWisps()]) {
    const { range, speed } = c;
    const max = range.min + range.span;
    const { halfW } = viewHalfExtent(c.depth);
    assert.deepEqual(wrapRange(c.depth, c.width), range);
    // Fully off the left edge at the low end, fully off the right at the high end.
    assert.ok(range.min + c.width / 2 <= -halfW + 1e-9);
    assert.ok(max - c.width / 2 >= halfW - 1e-9);
    let prev = skyDrift(c, 0, out).x;
    let wraps = 0;
    const acrossMs = (range.span / speed) * 1000;
    for (let t = 50; t <= acrossMs * 2.5; t += 50) {
      const { x } = skyDrift(c, t, out);
      assert.ok(x >= range.min && x < max);
      if (x < prev) {
        wraps++;
        assert.ok(prev - c.width / 2 > halfW - 0.1, 'left fully off the right edge');
        assert.ok(x + c.width / 2 < -halfW + 0.1, 'comes back fully off the left edge');
      }
      prev = x;
    }
    assert.ok(wraps >= 2, 'comes back again and again');
    assert.ok(close(skyDrift(c, acrossMs, out).x, c.x, 1e-6), 'back where it started after one span');
  }
});

test('drifting clouds and wisps show whole inside the sky strip at both layer scales', () => {
  const clouds = planDriftClouds();
  assert.deepEqual(clouds.map((c) => c.layer), ['far', 'far', 'far', 'far', 'near', 'near', 'near', 'near']);
  const frac = (c, y) => (1 - y / viewHalfExtent(c.depth).halfH) / 2;
  clouds.forEach((c) => {
    const bottom = frac(c, c.y);
    const top = frac(c, c.y + c.height);
    assert.ok(top >= 0, `${c.layer} top ${top} is not cut off`);
    assert.ok(bottom <= SKY_HORIZON_FRACTION, `${c.layer} bottom ${bottom} above the meadow crest`);
  });
  clouds.filter((c) => c.layer === 'near').forEach((c, i) => assert.ok(close(frac(c, c.y), DRIFT_CLOUD_BOTTOMS.near[i])));
  for (const w of planWisps()) {
    assert.ok(frac(w, w.y + w.height / 2) >= 0 && frac(w, w.y - w.height / 2) <= SKY_HORIZON_FRACTION);
  }
});

test('drifting clouds and wisps blend with real alpha and never discard a pixel above opacity 0.02', () => {
  assert.ok(SKY_ALPHA_CUTOFF <= 0.01);
  for (let opacity = 0.0201; opacity <= 1; opacity += 0.001) assert.equal(skyPixelDiscarded(opacity), false, `${opacity}`);
  // Wisps at alpha 0.25 keep every texel whose own alpha is above 0.08.
  for (let texel = 0.081; texel <= 1; texel += 0.01) assert.equal(skyPixelDiscarded(texel * WISP_ALPHA), false);
  assert.equal(skyPixelDiscarded(0), true, 'fully clear pixels still go');
  // The materials use that cutoff: blended, no depth writes, drawn behind the field and plants.
  const sky = readFileSync(new URL('../src/render3d/sky-scene.js', import.meta.url), 'utf8');
  for (const name of ['driftMaterial', 'wispMaterial']) {
    const body = sky.match(new RegExp(`const ${name} = new THREE\\.MeshBasicMaterial\\(\\{([^}]*)\\}`))[1];
    assert.match(body, /transparent: true/);
    assert.match(body, /alphaTest: SKY_ALPHA_CUTOFF/);
    assert.match(body, /depthWrite: false/);
    assert.doesNotMatch(body, /SPRITE_ALPHA_TEST/);
  }
  assert.match(sky, /const SKY_RENDER_ORDER = -\d+/);
  assert.equal((sky.match(/mesh\.renderOrder = SKY_RENDER_ORDER/g) ?? []).length, 2);
});

test('wisps: 6, drifting with the far layer', () => {
  const wisps = planWisps();
  assert.equal(wisps.length, WISP_COUNT);
  assert.equal(WISP_HEIGHTS.length, WISP_COUNT);
  assert.equal(WISP_ALPHA, 0.25);
  for (const w of wisps) {
    assert.equal(w.speed, CLOUD_LAYERS.far.speed);
    assert.equal(w.depth, CLOUD_LAYERS.far.depth);
    assert.ok(w.width > w.height * 10, 'thin and horizontal');
    assert.ok(w.x >= w.range.min && w.x < w.range.min + w.range.span);
  }
});

test('sun rays: 3 of them breathe over 14 seconds, never above alpha 0.10', () => {
  assert.equal(SUN_RAY_COUNT, 3);
  assert.equal(SUN_RAY_PERIOD_MS, 14000);
  for (let i = 0; i < SUN_RAY_COUNT; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 14000; t += 50) {
      const a = sunRayAlpha(i, t);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      assert.ok(close(a, sunRayAlpha(i, t + 14000), 1e-12), 'one breath every 14 s');
    }
    assert.ok(hi <= 0.1 + 1e-12 && hi > 0.099, `top ${hi}`);
    assert.ok(lo > 0 && lo < 0.06, `bottom ${lo}`);
  }
  assert.notEqual(sunRayAlpha(0, 0), sunRayAlpha(1, 0), 'the rays breathe out of step');
});

test('wind lanes: far 0.6 at 0.6, mid 1.0 at 1.0, near 1.6 at 1.5, all along the wind', () => {
  assert.deepEqual(LANE_NAMES, ['far', 'mid', 'near']);
  const expect = { far: [0.6, 0.6], mid: [1.0, 1.0], near: [1.6, 1.5] };
  for (const lane of LANE_NAMES) {
    assert.equal(WIND_LANES[lane].scale, expect[lane][0]);
    assert.equal(WIND_LANES[lane].speed, expect[lane][1]);
    const v = laneVelocity(lane);
    assert.ok(close(Math.hypot(v.x, v.z), expect[lane][1]));
    assert.ok(close(v.x * WIND_GROUND.z - v.z * WIND_GROUND.x, 0), 'parallel to the wind');
    assert.ok(v.x > 0 && v.z > 0, 'toward the lower right');
  }
});

test('wind petals move downwind at their lane speed and wrap around invisibly', () => {
  const p = petalPoint();
  const q = petalPoint();
  for (const petal of planPetals()) {
    const { speed } = WIND_LANES[petal.lane];
    for (const t of [0, 2500, 40000]) {
      petalAt(petal, t, camera, p);
      petalAt(petal, t + 1000, camera, q);
      const moved = along(q) - along(p);
      if (moved > 0) assert.ok(close(moved, speed, 1e-6), `${petal.lane} moved ${moved}`);
      else assert.ok(p.alpha < 0.5 || q.alpha < 0.5 || p.alpha * q.alpha === 0, 'a wrap happens only while faded out');
    }
  }
  // Fully faded at the wrap point.
  const petal = planPetals()[0];
  const lane = WIND_LANES[petal.lane];
  const wrapMs = ((1 - petal.start) * lane.length * 1000) / lane.speed;
  assert.ok(petalAt(petal, wrapMs, camera, p).alpha < 1e-6);
});

test('wind petals: about 40 show in view at a time', () => {
  const p = petalPoint();
  const petals = planPetals();
  let total = 0;
  let samples = 0;
  for (let t = 0; t < 60000; t += 250, samples++) {
    for (const petal of petals) {
      petalAt(petal, t, camera, p);
      const ndc = projectToNdc(p, setup);
      if (ndc && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && p.alpha > 0.05) total++;
    }
  }
  const average = total / samples;
  assert.ok(average >= 35 && average <= 45, `average ${average}`);
  assert.deepEqual(planPetals(), petals, 'deterministic');
});

test('trail: 3 ghosts at 60, 120 and 180 ms behind with alpha 0.5, 0.3 and 0.15', () => {
  assert.deepEqual(PETAL_TRAIL_MS, [60, 120, 180]);
  assert.deepEqual(PETAL_TRAIL_ALPHA, [0.5, 0.3, 0.15]);
  const p = petalPoint();
  const g = petalPoint();
  const before = petalPoint();
  for (const petal of planPetals().filter((_, i) => i % 5 === 0)) {
    const t = 12345;
    petalAt(petal, t, camera, p);
    for (let k = 0; k < 3; k++) {
      assert.equal(trailAt(petal, t, k, camera, g), g, 'writes into out');
      petalAt(petal, t - PETAL_TRAIL_MS[k], camera, before);
      assert.deepEqual({ ...g }, { ...before, alpha: before.alpha * PETAL_TRAIL_ALPHA[k] });
      const behind = along(p) - along(g);
      if (behind > 0) assert.ok(close(behind, (WIND_LANES[petal.lane].speed * PETAL_TRAIL_MS[k]) / 1000, 1e-6), 'upwind by speed times delay');
    }
  }
});

test('near-lane petals fade out while over the field, other lanes do not', () => {
  assert.equal(fieldFade(0, 6, 4, camera), 0, 'in front of the field centre');
  assert.equal(fieldFade(-30, 6, 4, camera), 1, 'far beside the field');
  const p = petalPoint();
  const petals = planPetals();
  let hidden = 0;
  let shown = 0;
  let midOverField = 0;
  for (let t = 0; t < 30000; t += 500) {
    for (const petal of petals) {
      petalAt(petal, t, camera, p);
      const fade = fieldFade(p.x, p.y, p.z, camera);
      if (petal.lane === 'near') {
        assert.ok(p.alpha <= fade + 1e-12, 'never more than the field fade');
        if (fade === 0) hidden++;
        else shown++;
      } else if (petal.lane === 'mid' && fade === 0 && p.alpha > 0.5) {
        midOverField++;
      }
    }
  }
  assert.ok(hidden > 0 && shown > 0);
  assert.ok(midOverField > 0, 'mid-lane petals still cross the field');
});

test('render path: no old wind streaks or sprite clouds, no level names in the sky code', () => {
  const hill = readFileSync(new URL('../src/render3d/breeze-hill.js', import.meta.url), 'utf8');
  const sky = readFileSync(new URL('../src/render3d/sky-scene.js', import.meta.url), 'utf8');
  for (const source of [hill, sky]) {
    assert.doesNotMatch(source, /createWindStreaks|streakTexture|WIND3D_STREAK|ART\.cloud\b|CLOUD_COUNT/);
    assert.doesNotMatch(source, /THREE\.Line|LineSegments|LineBasicMaterial/);
    assert.doesNotMatch(source, /'(low|medium|high)'/);
  }
  assert.match(hill, /createSky\(/);
  assert.match(sky, /ART\.v3\.clouds/);
  assert.match(sky, /ART\.v3\.windBits/);
});

test('tumbling petals mirror their picture, not their quad, so front-face culling never hides them', () => {
  const sky = readFileSync(new URL('../src/render3d/sky-scene.js', import.meta.url), 'utf8');
  const vertex = sky.match(/const PETAL_VERTEX = [^`]*`([^`]*)`/)[1];
  // A quad scaled by -1 along x turns its back to the camera; ShaderMaterial
  // draws only front faces by default.
  assert.doesNotMatch(vertex, /position\.x[^;\n]*aFlip/);
  assert.match(vertex, /vUv = [^;]*aFlip/);
});

test('clouds have no outline, even the stand-in drawn while clouds.png is missing', () => {
  const styles = new Set();
  const ctx = { set fillStyle(v) { styles.add(v); }, fillRect() {} };
  PLACEHOLDERS_3D[ART.v3.clouds].paint(ctx);
  assert.ok(styles.size > 0);
  assert.ok(!styles.has('#2b1d3a'), 'no plum outline');
  // Other upright stand-ins keep theirs.
  const others = new Set();
  PLACEHOLDERS_3D[ART.v3.hayBale].paint({ set fillStyle(v) { others.add(v); }, fillRect() {} });
  assert.ok(others.has('#2b1d3a'));
});
