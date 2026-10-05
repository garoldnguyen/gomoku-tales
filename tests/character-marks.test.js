// Character look, part 2 (the look in the 3D game): the marks of a seat
// take the colour of the character that seat picked, tinted from the art's
// source colours with paletteSwap, and every planted seed plays its
// character's placement effect exactly once. Pure helpers first, then the
// renderer on the Three.js stand-ins of fake-browser.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PLACEMENT_SLOTS, VINE_POINTS } from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { DEFAULT_SIDES, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { createInitialState } from '../src/logic/game.js';
import { createSeats, pickCharacter, seatSides, seatStone } from '../src/logic/seats.js';
import {
  CHARACTER_LOOK, MARK_SOURCE, SOIL_BURST, VINE_COIL, WIND_DANDELION, hexToRgb, placementCues, placementPlan,
  seatColour, shadeFor, sideColour, sideEffect, tintPairs, tintPixels,
} from '../src/render3d/character-look.js';
import {
  clearPlacementRuns, createPlacementRuns, startPlacementRun, stepPlacementRuns, vinePointsInto,
} from '../src/render3d/placement-runs.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const pick = (seats, seat, character) => {
  const result = pickCharacter(seats, seat, character);
  assert.ok(result.ok, result.error);
  return result.seats;
};

// --- The colour of a seat ---

test('the colour of a seat comes from the character that seat picked', () => {
  let seats = createSeats(['host', 'guest']);
  assert.equal(seatColour(seats, 'host'), null, 'no pick, no colour');
  seats = pick(seats, 'guest', JADE_SERPENT);
  seats = pick(seats, 'host', EARTH_BEAR);
  assert.equal(seatColour(seats, 'guest'), CHARACTER_LOOK[JADE_SERPENT].colour);
  assert.equal(seatColour(seats, 'host'), CHARACTER_LOOK[EARTH_BEAR].colour);
  // The game's sides follow the pick order; each side shows its seat's colour.
  const sides = seatSides(seats);
  for (const seat of seats.names) assert.equal(sideColour(sides, seatStone(seats, seat)), seatColour(seats, seat), seat);
  assert.equal(sideColour(sides, X), '#2fbf7a', 'the guest picked first: Jade Serpent plays X in jade green');
  assert.equal(sideColour(sides, O), '#c9703a', 'Earth Bear plays O in ochre red');
  // A seat changes its pick: its colour changes with it.
  seats = pick(seats, 'guest', WIND_RABBIT);
  assert.equal(seatColour(seats, 'guest'), '#3b8cff');
});

test('the colour belongs to the character, whichever side it plays', () => {
  for (const id of [WIND_RABBIT, EARTH_BEAR, JADE_SERPENT]) {
    const other = id === WIND_RABBIT ? EARTH_BEAR : WIND_RABBIT;
    assert.equal(sideColour({ [X]: id, [O]: other }, X), CHARACTER_LOOK[id].colour);
    assert.equal(sideColour({ [X]: other, [O]: id }, O), CHARACTER_LOOK[id].colour);
    assert.equal(sideEffect({ [X]: other, [O]: id }, O), CHARACTER_LOOK[id].effect);
  }
  assert.equal(sideColour(null, X), CHARACTER_LOOK[DEFAULT_SIDES[X]].colour, 'no sides: the default sides');
  assert.equal(sideColour({ [X]: 'nobody', [O]: EARTH_BEAR }, X), MARK_SOURCE[X].main, 'no look: the art keeps its colour');
});

// --- Tinting ---

test('a tint swaps the source colour and its shades, and nothing else', () => {
  assert.deepEqual(tintPairs(MARK_SOURCE[X].main, MARK_SOURCE[X].shades, CHARACTER_LOOK[WIND_RABBIT].colour), [],
    'Wind Rabbit on X: the art already is its blue');
  const pairs = tintPairs(MARK_SOURCE[X].main, MARK_SOURCE[X].shades, '#2fbf7a');
  assert.equal(pairs.length, 1 + MARK_SOURCE[X].shades.length);
  assert.deepEqual(pairs[0], [hexToRgb('#3b8cff'), hexToRgb('#2fbf7a')]);
  // A darker shade stays darker, a lighter one lighter.
  const dark = shadeFor(hexToRgb('#3b8cff'), hexToRgb('#2f63b0'), hexToRgb('#2fbf7a'));
  const light = shadeFor(hexToRgb('#3b8cff'), hexToRgb('#9ccaff'), hexToRgb('#2fbf7a'));
  const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];
  assert.ok(sum(dark) < sum(hexToRgb('#2fbf7a')) && sum(light) > sum(hexToRgb('#2fbf7a')));
  for (const c of [...dark, ...light]) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255);

  const outline = [0x2b, 0x1d, 0x3a, 255];
  const pixels = new Uint8ClampedArray([59, 140, 255, 255, 47, 99, 176, 255, ...outline, 0, 0, 0, 0]);
  const out = tintPixels(pixels, pairs);
  assert.deepEqual([...out.slice(0, 4)], [47, 191, 122, 255], 'the main blue is jade');
  assert.deepEqual([...out.slice(4, 8)], [...dark, 255], 'the dark blue is dark jade');
  assert.deepEqual([...out.slice(8)], [...outline, 0, 0, 0, 0], 'the outline and transparent pixels stay');
  // A swap never feeds the next one: to-colour of one pair is the from-colour of another.
  const chain = [[[1, 1, 1], [2, 2, 2]], [[2, 2, 2], [3, 3, 3]]];
  assert.deepEqual([...tintPixels(new Uint8ClampedArray([1, 1, 1, 255]), chain)], [2, 2, 2, 255]);
});

// --- Placement effects ---

test('every planted seed gets one cue with the effect of its side\'s character', () => {
  const sides = { [X]: JADE_SERPENT, [O]: WIND_RABBIT };
  const events = [
    { type: 'stonePlaced', x: 3, y: 4, player: X },
    { type: 'skillUsed', player: O, skill: 'windDash' },
    { type: 'stoneMoved', from: { x: 3, y: 4 }, to: { x: 5, y: 4 }, player: X },
    { type: 'stonePlaced', x: 7, y: 7, player: O },
  ];
  assert.deepEqual(placementCues(events, sides), [
    { x: 3, y: 4, player: X, effect: VINE_COIL },
    { x: 7, y: 7, player: O, effect: WIND_DANDELION },
  ]);
  assert.deepEqual(placementCues([{ type: 'stonePlaced', x: 0, y: 0, player: O }], null), [
    { x: 0, y: 0, player: O, effect: SOIL_BURST },
  ], 'the default sides: Earth Bear plays O');
  assert.deepEqual(placementCues([], sides), []);
});

test('a placement plays each step of its plan exactly once, at any frame rate', () => {
  for (const effect of [WIND_DANDELION, SOIL_BURST, VINE_COIL]) {
    for (const frameMs of [7, 16, 33, 100, 250]) {
      const runs = createPlacementRuns(PLACEMENT_SLOTS);
      const plan = placementPlan(effect, { features: QUALITY_LEVELS.high });
      const counts = new Map();
      const onStep = (step) => counts.set(step, (counts.get(step) ?? 0) + 1);
      const run = startPlacementRun(runs, plan, 1, 2, 1000);
      assert.equal(run.x, 1);
      for (let time = 990; time < 4000; time += frameMs) stepPlacementRuns(runs, time, onStep);
      assert.equal(counts.size, plan.length, `${effect} at ${frameMs} ms: every step`);
      for (const [step, count] of counts) assert.equal(count, 1, `${effect} ${step.kind} once`);
      assert.equal(run.active, false, 'the run ends once its plan played out');
    }
  }
});

test('placements on several plots play side by side, and a new game stops them', () => {
  const runs = createPlacementRuns(PLACEMENT_SLOTS);
  const plan = placementPlan(SOIL_BURST, { features: QUALITY_LEVELS.medium });
  const calls = [];
  const onStep = (step, run) => calls.push(run.x);
  startPlacementRun(runs, plan, 1, 0, 0);
  startPlacementRun(runs, plan, 2, 0, 0);
  stepPlacementRuns(runs, 5000, onStep);
  assert.equal(calls.filter((x) => x === 1).length, plan.length);
  assert.equal(calls.filter((x) => x === 2).length, plan.length);
  startPlacementRun(runs, plan, 3, 0, 6000);
  clearPlacementRuns(runs);
  calls.length = 0;
  stepPlacementRuns(runs, 7000, onStep);
  assert.deepEqual(calls, []);
  // More placements than slots: the oldest gives way.
  for (let i = 0; i < PLACEMENT_SLOTS + 1; i++) startPlacementRun(runs, plan, i, 0, 8000 + i);
  assert.equal(runs.filter((run) => run.active).length, PLACEMENT_SLOTS);
  assert.ok(!runs.some((run) => run.x === 0), 'the first one was replaced');
});

test('the vine of the vine coil grows from the soil, coils and sinks back', () => {
  for (const level of QUALITY_ORDER) {
    const plan = placementPlan(VINE_COIL, { features: QUALITY_LEVELS[level] });
    const out = new Float32Array(VINE_POINTS * 3);
    assert.equal(vinePointsInto(plan, -1, out), 0);
    let most = 0;
    let previous = 0;
    for (let age = 0; age < 900; age += 50) {
      const n = vinePointsInto(plan, age, out);
      assert.ok(n >= previous, `${level}: it grows (${age} ms)`);
      previous = n;
      most = Math.max(most, n);
      for (let i = 0; i < n; i++) assert.ok(out[i * 3 + 1] >= 0, 'never below the ground');
    }
    assert.ok(most > VINE_POINTS / 2, `${level}: the whole vine shows (${most} dots)`);
    assert.ok(vinePointsInto(plan, 1150, out) < most, 'sinking');
    assert.equal(vinePointsInto(plan, 1200, out), 0, 'gone after 1.2 s');
  }
  assert.equal(vinePointsInto(placementPlan(SOIL_BURST), 300, new Float32Array(VINE_POINTS * 3)), 0, 'no vine in a soil burst');
});

// --- In the renderer ---

async function buildRenderer(quality, characters) {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality, createRenderer: () => gl });
  const ctx = fakeCanvas().getContext('2d');
  let state = createInitialState(15, characters);
  let time = 1000;
  return {
    gl,
    renderer,
    get time() {
      return time;
    },
    get characters() {
      return state.characters;
    },
    setState(next) {
      state = next;
    },
    frame() {
      time += 16;
      renderer.drawGameScreen(ctx, { state, hover: { x: 2, y: 2 }, preview: null, time });
    },
  };
}

// The Points meshes of the scene that draw something this frame.
function drawnPoints(scene) {
  let dots = 0;
  scene.traverse((object) => {
    if (object.isPoints && object.visible) dots += object.geometry.drawRange.count === Infinity ? 0 : object.geometry.drawRange.count;
  });
  return dots;
}

test('the renderer tints the marks once per match and again on a quality change, disposing the old ones', async () => {
  const sides = { [X]: JADE_SERPENT, [O]: EARTH_BEAR };
  const game = await buildRenderer('medium', sides);
  game.frame();
  const first = game.renderer.markTints;
  assert.equal(first.colour[X], '#2fbf7a');
  assert.equal(first.colour[O], '#c9703a');
  for (let i = 0; i < 20; i++) game.frame();
  assert.equal(game.renderer.markTints, first, 'not rebuilt while the match goes on');

  const disposed = [];
  for (const texture of [first.last[X], first.hover[O], first.select[X]]) texture.addEventListener('dispose', () => disposed.push(texture));
  game.renderer.setQuality('high');
  game.frame();
  const second = game.renderer.markTints;
  assert.notEqual(second, first, 'rebuilt on a quality change');
  assert.equal(disposed.length, 3, 'the old textures are disposed');

  game.setState(createInitialState(15, { [X]: WIND_RABBIT, [O]: JADE_SERPENT }));
  game.frame();
  assert.notEqual(game.renderer.markTints, second, 'rebuilt when a match with other characters starts');
  assert.equal(game.renderer.markTints.colour[O], '#2fbf7a', 'Jade Serpent now plays O, still jade');
});

test('the renderer plays the placement effect once per planted seed', async () => {
  // Low: no particles, only the vine (a mesh of its own) of Jade Serpent.
  const game = await buildRenderer('low', { [X]: JADE_SERPENT, [O]: EARTH_BEAR });
  game.frame();
  assert.equal(drawnPoints(game.gl.scene), 0, 'nothing before a seed');
  game.renderer.trigger([{ type: 'stonePlaced', x: 7, y: 7, player: X }], game.time, game.characters);
  let most = 0;
  for (let i = 0; i < 40; i++) {
    game.frame();
    most = Math.max(most, drawnPoints(game.gl.scene));
  }
  assert.ok(most > 0 && most <= VINE_POINTS, `one vine (${most} dots)`);
  for (let i = 0; i < 60; i++) game.frame();
  assert.equal(drawnPoints(game.gl.scene), 0, 'the vine sank back: it played once');
  // Events without a planted seed play none; Earth Bear's soil burst has no vine.
  game.renderer.trigger([{ type: 'skillUsed', player: X, skill: 'none' }], game.time, game.characters);
  game.renderer.trigger([{ type: 'stonePlaced', x: 8, y: 8, player: O }], game.time, game.characters);
  for (let i = 0; i < 20; i++) {
    game.frame();
    assert.equal(drawnPoints(game.gl.scene), 0);
  }
});

test('the first seed of a new match plays the effect of the new characters, before a frame is drawn', async () => {
  // Earth Bear's soil burst has no vine on Low, Jade Serpent's seed does.
  const game = await buildRenderer('low', { [X]: EARTH_BEAR, [O]: WIND_RABBIT });
  game.frame();
  game.setState(createInitialState(15, { [X]: JADE_SERPENT, [O]: EARTH_BEAR }));
  // The events are shown before the frame of the new match is drawn.
  game.renderer.trigger([{ type: 'stonePlaced', x: 7, y: 7, player: X }], game.time, game.characters);
  let most = 0;
  for (let i = 0; i < 40; i++) {
    game.frame();
    most = Math.max(most, drawnPoints(game.gl.scene));
  }
  assert.ok(most > 0, 'the vine of Jade Serpent, not the soil burst of the last match');
});
