import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_DISTANCE, CAMERA_FOV, CONVERT_LIFT, CONVERT_MS, DASH_STREAK_MS, ROCK_CRUMBLE_MS, ROCK_FALL_HEIGHT,
  ROCK_FALL_MS, ROCK_SETTLE_MS, SHAKE3D_HEAVY, SHAKE3D_LIGHT, SHAKE3D_MS, THROW_ARC_HEIGHT, THROW_DELAY_MS, THROW_MS,
} from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { STONE_CONVERSION, TERRAIN_CREATION, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { bannerTexts } from '../src/render/effects.js';
import {
  convertPose, crumblePose, dashPose, heldCell, rockFallPose, shakeLeft, shakeOffset3d, shakeStrength,
  snapToStep, throwPose, visualsForEvents, worldUnitsPerPixel,
} from '../src/render3d/effect-plans.js';
import {
  createParticlePool, createSpawnParams, emit, FLOOR_Y, scaledCount, SHAPE_PLUS, SHAPE_SQUARE,
} from '../src/render3d/particle-pool.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import { effectRandom } from '../src/render3d/seeded-random.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

const kinds = (specs) => specs.map((spec) => spec.kind);

// Plays moves from the start; each move is [x, y] for a stone or
// { skill, target } for a skill. Returns the results.
function play(moves, options = {}) {
  let state = createInitialState();
  const results = [];
  for (const move of moves) {
    const player = state.currentPlayer;
    const result = Array.isArray(move)
      ? ok(placeStone(state, { player, x: move[0], y: move[1] }, options))
      : ok(useSkill(state, { player, skill: move.skill, target: move.target }));
    results.push(result);
    state = result.state;
  }
  return results;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// --- Event to visual mapping ---

test('a placed stone shows sparkles, dust and a light shake on its cell', () => {
  const [placed] = play([[3, 4]]);
  assert.deepEqual(visualsForEvents(placed.events), [{ kind: 'place', x: 3, y: 4, player: X }]);
  assert.equal(shakeStrength({ kind: 'place' }), SHAKE3D_LIGHT);
});

test('Wind Dash: the announcement marks source and target, then the stone streaks across', () => {
  const results = play([
    [7, 7], [0, 0],
    { skill: WIND_DASH, target: { from: { x: 7, y: 7 }, to: { x: 9, y: 9 } } },
    [14, 14], // the bear's turn ends and the dash resolves
  ]);
  const announced = visualsForEvents(results[2].events);
  assert.deepEqual(kinds(announced), ['dashMark', 'banner']);
  assert.deepEqual(announced[0], { kind: 'dashMark', from: { x: 7, y: 7 }, to: { x: 9, y: 9 }, player: X });
  assert.equal(announced[1].text, 'Wind Dash!');

  const resolved = visualsForEvents(results[3].events);
  assert.deepEqual(kinds(resolved), ['place', 'dashStreak', 'banner']);
  assert.deepEqual(resolved[1], { kind: 'dashStreak', from: { x: 7, y: 7 }, to: { x: 9, y: 9 }, player: X });
  assert.deepEqual(heldCell(resolved[1]), { x: 9, y: 9, ms: DASH_STREAK_MS });
});

test('a failed Wind Dash fizzles and ends the marks', () => {
  const results = play([
    [7, 7], [0, 0],
    { skill: WIND_DASH, target: { from: { x: 7, y: 7 }, to: { x: 9, y: 9 } } },
    [9, 9], // the bear takes the target
  ]);
  const specs = visualsForEvents(results[3].events);
  assert.deepEqual(kinds(specs), ['place', 'dashFizzle', 'banner']);
  assert.deepEqual(specs[1], { kind: 'dashFizzle', from: { x: 7, y: 7 }, to: { x: 9, y: 9 } });
  assert.equal(heldCell(specs[1]), null);
});

test('Tornado Zone: the column shows over the zone and a thrown stone flies in an arc', () => {
  const results = play([
    { skill: TORNADO_ZONE, target: { x: 7, y: 7 } },
    [7, 7], // the bear places inside the zone; random 0 throws it to (6, 6)
  ], { random: () => 0 });
  const announced = visualsForEvents(results[0].events);
  assert.equal(announced[0].kind, 'tornado');
  assert.equal(announced[0].cells.length, 9);
  assert.deepEqual([announced[0].x, announced[0].y], [7, 7]);

  const thrown = visualsForEvents(results[1].events);
  assert.deepEqual(kinds(thrown), ['place', 'throw', 'tornadoEnd', 'banner']);
  assert.deepEqual(thrown[1], { kind: 'throw', from: { x: 7, y: 7 }, to: { x: 6, y: 6 }, player: O });
  assert.deepEqual(heldCell(thrown[1]), { x: 6, y: 6, ms: THROW_DELAY_MS + THROW_MS });
  assert.equal(shakeStrength(thrown[1]), SHAKE3D_LIGHT);
});

test('Terrain Creation: the rock falls with a heavy shake and crumbles when it breaks', () => {
  const results = play([
    [0, 0],
    { skill: TERRAIN_CREATION, target: { x: 7, y: 7 } },
    [1, 0], [2, 0], [3, 0], [4, 5], // the rock breaks at the end of the 4th turn after it fell
  ]);
  const fell = visualsForEvents(results[1].events);
  assert.deepEqual(kinds(fell), ['rockFall', 'banner']);
  assert.deepEqual(heldCell(fell[0]), { x: 7, y: 7, ms: ROCK_FALL_MS + ROCK_SETTLE_MS });
  assert.equal(shakeStrength(fell[0]), SHAKE3D_HEAVY);
  assert.ok(SHAKE3D_HEAVY > SHAKE3D_LIGHT);

  for (const result of results.slice(2, 5)) assert.ok(!kinds(visualsForEvents(result.events)).includes('rockCrumble'));
  const broke = visualsForEvents(results[5].events);
  assert.deepEqual(broke.filter((s) => s.kind === 'rockCrumble'), [{ kind: 'rockCrumble', x: 7, y: 7 }]);
});

test('Stone Conversion: the stone flips from the old colour to the new one', () => {
  const results = play([
    [7, 7],
    { skill: STONE_CONVERSION, target: { x: 7, y: 7 } },
  ]);
  const specs = visualsForEvents(results[1].events);
  assert.deepEqual(specs[0], { kind: 'convert', x: 7, y: 7, from: X, to: O });
  assert.deepEqual(heldCell(specs[0]), { x: 7, y: 7, ms: CONVERT_MS });
});

test('a win ends the lingering marks, since it drops a pending dash and the zone without events', () => {
  const results = play([
    [0, 0], [0, 5], [1, 0], [1, 5], [2, 0], [2, 5], [3, 0],
    { skill: TERRAIN_CREATION, target: { x: 10, y: 10 } },
    { skill: TORNADO_ZONE, target: { x: 12, y: 12 } },
    [9, 9],
    [4, 0], // five in a row
  ]);
  const specs = visualsForEvents(results.at(-1).events);
  assert.deepEqual(kinds(specs), ['place', 'endLingering']);
  assert.ok(kinds(visualsForEvents([{ type: 'draw' }])).includes('endLingering'));
});

test('skill banners in 3D use the same texts as the 2D game', () => {
  const results = play([
    [7, 7],
    { skill: TERRAIN_CREATION, target: { x: 3, y: 3 } },
    { skill: TORNADO_ZONE, target: { x: 10, y: 10 } },
    { skill: STONE_CONVERSION, target: { x: 7, y: 7 } },
  ]);
  for (const result of results) {
    const texts = visualsForEvents(result.events).filter((s) => s.kind === 'banner').map((s) => s.text);
    assert.deepEqual(texts, bannerTexts(result.events));
  }
  assert.deepEqual(bannerTexts(results[1].events), ['Terrain Creation!']);
});

test('planning visuals never changes the events', () => {
  const results = play([[7, 7], { skill: STONE_CONVERSION, target: { x: 7, y: 7 } }]);
  for (const result of results) {
    const copy = structuredClone(result.events);
    visualsForEvents(deepFreeze(result.events));
    assert.deepEqual(result.events, copy);
  }
  assert.deepEqual(visualsForEvents([]), []);
  assert.deepEqual(visualsForEvents([{ type: 'turnEnded', player: X, turn: 0 }, { type: 'skillUsed', player: X, skill: 'nope' }]), []);
});

test('only pieces that arrive by flying are held hidden', () => {
  for (const kind of ['place', 'dashMark', 'dashFizzle', 'tornado', 'tornadoEnd', 'throwBlocked', 'rockCrumble', 'endLingering', 'banner']) {
    assert.equal(heldCell({ kind, x: 1, y: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }), null, kind);
  }
});

// --- Animation timelines ---

// Sets the time a pose function reads.
function at(pose, ageMs) {
  pose.ageMs = ageMs;
  return pose;
}

test('a dashing stone eases from source to target with a small lift', () => {
  const out = {};
  assert.equal(dashPose(at(out, 0)).progress, 0);
  assert.equal(out.lift, 0);
  assert.equal(out.done, false);
  let last = 0;
  for (let t = 0; t <= DASH_STREAK_MS; t += 10) {
    dashPose(at(out, t));
    assert.ok(out.progress >= last, 'never moves back');
    assert.ok(out.lift >= 0 && out.lift < 0.5);
    last = out.progress;
  }
  dashPose(at(out, DASH_STREAK_MS));
  assert.equal(out.progress, 1);
  assert.ok(Math.abs(out.lift) < 1e-9);
  assert.equal(out.done, true);
});

test('a thrown stone pops in on its cell, then flies in an arc and lands', () => {
  const out = {};
  throwPose(at(out, THROW_DELAY_MS / 2));
  assert.equal(out.progress, 0, 'it waits on the cell where it was placed');
  assert.equal(out.height, 0);
  throwPose(at(out, THROW_DELAY_MS + THROW_MS / 2));
  assert.ok(Math.abs(out.height - THROW_ARC_HEIGHT) < 1e-9, 'highest halfway');
  assert.deepEqual([out.scaleX, out.scaleY], [1, 1]);
  throwPose(at(out, THROW_DELAY_MS + THROW_MS));
  assert.equal(out.progress, 1);
  assert.equal(out.height, 0);
  assert.equal(out.done, true);
});

test('a falling rock speeds up, its shadow grows, and it squashes on impact', () => {
  const out = {};
  rockFallPose(at(out, 0));
  assert.equal(out.height, ROCK_FALL_HEIGHT);
  assert.equal(out.landed, false);
  let lastHeight = Infinity;
  let lastShadow = 0;
  let lastDrop = 0;
  for (let t = 0; t < ROCK_FALL_MS; t += 20) {
    rockFallPose(at(out, t));
    const drop = lastHeight === Infinity ? 0 : lastHeight - out.height;
    assert.ok(out.height < lastHeight, 'falls');
    assert.ok(drop >= lastDrop - 1e-9, 'speeds up');
    assert.ok(out.shadow >= lastShadow && out.shadow <= 1, 'the shadow grows');
    assert.deepEqual([out.scaleX, out.scaleY], [1, 1], 'no squash in the air');
    lastDrop = drop;
    lastHeight = out.height;
    lastShadow = out.shadow;
  }
  rockFallPose(at(out, ROCK_FALL_MS));
  assert.equal(out.height, 0);
  assert.equal(out.shadow, 1);
  assert.equal(out.landed, true);
  assert.ok(out.scaleX > 1 && out.scaleY < 1, 'squashed on impact');
  rockFallPose(at(out, ROCK_FALL_MS + ROCK_SETTLE_MS));
  assert.deepEqual([out.scaleX, out.scaleY, out.done], [1, 1, true]);
});

test('a breaking rock sinks into rubble', () => {
  const out = {};
  assert.deepEqual(crumblePose(at(out, 0)), { ageMs: 0, scaleX: 1, scaleY: 1, done: false });
  crumblePose(at(out, ROCK_CRUMBLE_MS));
  assert.ok(out.scaleY > 0 && out.scaleY < 0.1);
  assert.ok(out.scaleX > 1);
  assert.equal(out.done, true);
});

test('a converted stone glows, lifts, flips once to the new colour and lands', () => {
  const out = {};
  convertPose(at(out, 0));
  assert.deepEqual([out.glow, out.lift, out.width, out.showNew, out.done], [0, 0, 1, false, false]);
  let flips = 0;
  let shown = false;
  let peakLift = 0;
  let peakGlow = 0;
  for (let t = 0; t <= CONVERT_MS; t += 5) {
    convertPose(at(out, t));
    if (out.showNew !== shown) flips++;
    shown = out.showNew;
    peakLift = Math.max(peakLift, out.lift);
    peakGlow = Math.max(peakGlow, out.glow);
    assert.ok(out.width > 0 && out.width <= 1, 'never zero width');
    if (out.width < 0.2) assert.ok(out.lift === CONVERT_LIFT, 'it turns edge-on while lifted');
  }
  assert.equal(flips, 1, 'the colour changes exactly once');
  assert.equal(peakLift, CONVERT_LIFT);
  assert.equal(peakGlow, 1);
  convertPose(at(out, CONVERT_MS));
  assert.equal(out.showNew, true);
  assert.equal(out.lift, 0);
  assert.equal(out.glow, 0);
  assert.ok(Math.abs(out.width - 1) < 1e-9);
  assert.equal(out.done, true);
});

// --- Camera shake ---

test('the camera shake stays within its strength and dies out on time', () => {
  const offset = (ageMs, strength) => {
    const { x, y } = shakeOffset3d({ ageMs, strength });
    return { x, y };
  };
  for (let t = 0; t < SHAKE3D_MS; t += 7) {
    const { x, y } = offset(t, SHAKE3D_HEAVY);
    assert.ok(Math.abs(x) <= SHAKE3D_HEAVY && Math.abs(y) <= SHAKE3D_HEAVY);
  }
  assert.ok(offset(10, SHAKE3D_HEAVY).x !== 0, 'it moves while it lasts');
  assert.deepEqual(offset(SHAKE3D_MS, SHAKE3D_HEAVY), { x: 0, y: 0 });
  assert.deepEqual(offset(-5, SHAKE3D_HEAVY), { x: 0, y: 0 });
  assert.deepEqual(offset(Infinity, 0), { x: 0, y: 0 }, 'no shake yet');
  assert.equal(shakeLeft(0, SHAKE3D_LIGHT), SHAKE3D_LIGHT);
  assert.ok(shakeLeft(SHAKE3D_MS / 2, SHAKE3D_LIGHT) < SHAKE3D_LIGHT);
  assert.equal(shakeLeft(SHAKE3D_MS, SHAKE3D_LIGHT), 0);
});

test('shake offsets snap to whole screen pixels at the board', () => {
  const step = worldUnitsPerPixel(CAMERA_DISTANCE, CAMERA_FOV, 1080);
  const visible = 2 * CAMERA_DISTANCE * Math.tan((CAMERA_FOV * Math.PI) / 360);
  assert.ok(Math.abs(step * 1080 - visible) < 1e-9);
  assert.ok(SHAKE3D_LIGHT / step >= 1, 'a light shake moves at least one pixel at 1080p');
  assert.equal(snapToStep(step * 2.4, step), step * 2);
  assert.equal(snapToStep(-step * 0.6, step), -step);
  assert.equal(snapToStep(0.3, 0), 0.3);
});

// --- Particle pool and quality ---

// Spawns through one reused parameter object, like effects3d.js does.
const params = createSpawnParams();
function fall(pool, [x, y, z], [vx, vy, vz], { gravity = 0, drag = 0, life = 1, size = 0.1, grow = 0, color = 0xffffff, alpha = 1, shape = SHAPE_SQUARE } = {}) {
  Object.assign(params, { x, y, z, vx, vy, vz, gravity, drag, life, size, grow, color, alpha, shape });
  return pool.spawnFall(params);
}
function spiral(pool, [x, y, z], { radius, angle = 0, spin, rise, widen = 0, life = 1, size = 0.1, color = 0xffffff, alpha = 1, shape = SHAPE_SQUARE }) {
  Object.assign(params, { x, y, z, radius, angle, spin, rise, widen, life, size, grow: 0, color, alpha, shape });
  return pool.spawnSpiral(params);
}

test('the particle pool has a fixed capacity and drops particles when full', () => {
  const pool = createParticlePool(3);
  for (let i = 0; i < 3; i++) assert.equal(fall(pool, [0, 1, 0], [0, 0, 0]), i);
  assert.equal(fall(pool, [0, 1, 0], [0, 0, 0]), -1);
  assert.equal(pool.count, 3);
  pool.clear();
  assert.equal(pool.count, 0);
  assert.equal(spiral(pool, [0, 0, 0], { radius: 1, spin: 1, rise: 1, shape: SHAPE_PLUS }), 0);
});

test('dead particles are recycled and the live ones stay packed at the front', () => {
  const pool = createParticlePool(8);
  fall(pool, [0, 1, 0], [0, 0, 0], { life: 0.1, color: 0xff0000 }); // short
  fall(pool, [5, 1, 0], [0, 0, 0], { life: 1, color: 0x00ff00, shape: SHAPE_PLUS }); // long
  fall(pool, [0, 1, 0], [0, 0, 0], { life: 0.1, color: 0xff0000 }); // short
  pool.step({ dtS: 0.2 });
  assert.equal(pool.count, 1);
  assert.equal(pool.x[0], 5);
  assert.equal(pool.g[0], 1);
  assert.equal(pool.shape[0], SHAPE_PLUS);
  pool.step({ dtS: 1 });
  assert.equal(pool.count, 0);
});

test('falling particles feel gravity and stop on the board; spiral ones circle and rise', () => {
  const pool = createParticlePool(4);
  fall(pool, [0, 0.5, 0], [1, 0, 0], { gravity: 10, life: 5 });
  pool.step({ dtS: 0.1 });
  assert.ok(pool.y[0] < 0.5 && pool.x[0] > 0);
  for (let i = 0; i < 50; i++) pool.step({ dtS: 0.05 });
  assert.ok(Math.abs(pool.y[0] - FLOOR_Y) < 0.01, 'rests on the board');

  pool.clear();
  spiral(pool, [2, 0, 3], { radius: 0.5, spin: Math.PI, rise: 1, widen: 0.2, life: 5 });
  pool.step({ dtS: 0.5 });
  const radius = Math.hypot(pool.x[0] - 2, pool.z[0] - 3);
  assert.ok(Math.abs(radius - 0.6) < 1e-5, 'the circle widens');
  assert.ok(Math.abs(pool.y[0] - 0.5) < 1e-6, 'it rises');
  assert.ok(Math.abs(pool.x[0] - 2) < 1e-5 && pool.z[0] > 3, 'a quarter turn round the centre');
});

test('particles fade in, then out by the end of their life, and dust grows', () => {
  const pool = createParticlePool(1);
  fall(pool, [0, 1, 0], [0, 0, 0], { size: 0.1, grow: 0.2, alpha: 0.8 });
  assert.equal(pool.alphaAt(0), 0);
  pool.step({ dtS: 0.5 });
  assert.ok(Math.abs(pool.alphaAt(0) - 0.8) < 1e-6);
  assert.ok(Math.abs(pool.sizeAt(0) - 0.2) < 1e-6, 'half of the growth on top of the start size');
  pool.step({ dtS: 0.49 });
  assert.ok(pool.alphaAt(0) < 0.05);
});

test('emission spreads a rate over frames without losing particles', () => {
  const emitter = { carry: 0 };
  let total = 0;
  for (let frame = 0; frame < 600; frame++) total += emit(emitter, 37, 1 / 60);
  assert.equal(total, 370);
  assert.ok(emitter.carry >= 0 && emitter.carry < 1);
  assert.equal(emit({ carry: 0 }, 100, 0), 0);
  assert.equal(emit({ carry: 0.5 }, 30, 1 / 60), 1, 'the carried fraction adds up');
});

test('the quality level scales particle counts down, never to zero', () => {
  const scales = QUALITY_ORDER.map((level) => QUALITY_LEVELS[level].particles);
  assert.equal(scales[0], 1, 'HIGH has the full counts');
  for (let i = 1; i < scales.length; i++) assert.ok(scales[i] < scales[i - 1] && scales[i] > 0);
  assert.equal(scaledCount(12, 1), 12);
  assert.equal(scaledCount(12, QUALITY_LEVELS.LOW.particles), Math.round(12 * QUALITY_LEVELS.LOW.particles));
  assert.equal(scaledCount(1, 0.01), 1);
});

test('the effect random is deterministic, in [0, 1) and well spread', () => {
  const a = effectRandom(42);
  const b = effectRandom(42);
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
    sum += value;
  }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
  assert.ok(effectRandom(0)() >= 0, 'a zero seed still works');
});
