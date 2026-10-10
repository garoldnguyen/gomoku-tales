// Free Action, part 7: the 3D effects of Earth Bear and Wind Rabbit
// (docs/free-action-design.md section 8). The pure plans and poses, the art
// the owner supplied, and the real renderer on the fake browser: the puddle
// spreading, a seed sinking into it and surfacing, a Petrification, the secret
// Tornado cross (the caster's reminder, nothing for the other seat) and the
// whirlwind that reveals it. Tests cannot judge how it looks; they check what
// is shown and when, and that no frame allocates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { inflateSync } from 'node:zlib';
import * as THREE from '../vendor/three/build/three.module.js';
import * as config from '../src/config.js';
import {
  CELL_SIZE, DRY_MS, MARK_FADE_MS, MUD_FORM_FROM, MUD_FORM_MS, PETRIFY_FLICKER_FROM, PETRIFY_GREY_FROM, PETRIFY_SETTLE_MS,
  PETRIFY_SHATTER_MS, PETRIFY_SQUASH, PETRIFY_WRAP_MS, SINK_DELAY_MS, SINK_MS, STORM_MS, SUNK_DEPTH_PX, SUNK_DIM, SURFACE_MS,
  SURFACE_OVERSHOOT, SURFACE_POP_AT, THROW_DELAY_MS, THROW_DROP_MS, THROW_MS, THROW_SPIN_LIFT, THROW_SPIN_MS, TORNADO_PETAL_OPACITY,
} from '../src/config.js';
import { EMPTY, HIDDEN, O, X } from '../src/logic/board.js';
import { maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { MUD_TRAP, PETRIFICATION, TORNADO_ZONE } from '../src/logic/skills.js';
import { artProblem, ART, PLACEHOLDERS_3D, placeholderShape } from '../src/render3d/art-assets.js';
import {
  dryAmount, heldCell, mudSpread, PETRIFY_STAGE_ROCK, PETRIFY_STAGE_SHATTER, PETRIFY_STAGE_WRAP, petrifyGrey, petrifyMs, petrifyPose,
  shakeStrength, sinkAmount, surfaceDepth, throwPose, visualsForEvents,
} from '../src/render3d/effect-plans.js';
import { dryMudTileGrid, DRY_TILE_PX } from '../src/render3d/mud-dry-art.js';
import { mudTileGrid } from '../src/render3d/mud-art.js';
import { cellToWorld } from '../src/render3d/picking.js';
import { createParticlePool, createSpawnParams } from '../src/render3d/particle-pool.js';
import { createPlacementRuns, startPlacementRun, stopRunsAt } from '../src/render3d/placement-runs.js';
import { createRings, startRing, stopRingsAt } from '../src/render3d/skill-rings.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import {
  CROSS_PETAL_COLOURS, mudDryPlan, mudFormPlan, particleSteps, petrifyPlan, planStats, seedSinkPlan, seedSurfacePlan, SKILL_PLAN_SEED,
  STEP_LOOKS, stormPlan, tornadoCrossPlan,
} from '../src/render3d/skill-plans.js';
import { STONE_DARK, STONE_LIGHT, stonePixels } from '../src/render3d/stone-grey.js';
import { DEFAULT_V3_META, metaAnchor } from '../src/render3d/v3-meta.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const kinds = (specs) => specs.map((spec) => spec.kind);

// --- The PNG files the owner supplied (8 bit RGBA) ---

function readPng(file) {
  const data = readFileSync(new URL(`../assets/${file}`, import.meta.url));
  let pos = 8;
  let header = null;
  const parts = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9] };
    if (type === 'IDAT') parts.push(body);
    pos += 12 + length;
  }
  assert.deepEqual([header.depth, header.colour], [8, 6], `${file} is 8 bit RGBA`);
  const raw = inflateSync(Buffer.concat(parts));
  const stride = header.width * 4;
  const out = Buffer.alloc(header.height * stride);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? out[y * stride + x - 4] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [dl, du, dul] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      }
      out[y * stride + x] = (value + predictor) & 255;
    }
  }
  return { width: header.width, height: header.height, alpha: (x, y) => out[(y * header.width + x) * 4 + 3] };
}

// The lowest row with an opaque pixel in the frame at x offset `left`.
function lowestRow(png, left, width) {
  for (let y = png.height - 1; y >= 0; y--) {
    for (let x = left; x < left + width; x++) if (png.alpha(x, y) > 0) return y;
  }
  return -1;
}

// --- The art ---

test('the puddle and the cross are registered as 3D art of the owner\'s sizes; the retired zone art is gone', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8')).assets;
  assert.deepEqual(manifest['mud-puddle'], { file: '3d/v3/mud-puddle.png', use: '3d', width: 32, height: 32, frames: 1, frameMs: 0 });
  assert.deepEqual(manifest['decal-zone-cross'], { file: '3d/v3/decal-zone-cross.png', use: '3d', width: 96, height: 96, frames: 1, frameMs: 0 });
  assert.equal(ART.v3.mudPuddle, 'mud-puddle');
  assert.equal(ART.v3.decal.zoneCross, 'decal-zone-cross');
  assert.equal(ART.v3.decal.zone, undefined, 'nothing draws decal-zone-v3 any more');
  assert.equal(manifest['decal-zone-v3'], undefined, 'the old 3 by 3 zone decal is retired from the manifest');
  assert.equal(PLACEHOLDERS_3D['decal-zone-v3'], undefined);
  for (const name of ['mud-puddle', 'decal-zone-cross']) {
    assert.equal(artProblem(name, manifest[name]), null, name);
    assert.match(artProblem(name, { ...manifest[name], width: 64 }), new RegExp(`"${name}" must be`), 'a wrong size only warns');
    assert.ok(PLACEHOLDERS_3D[name], `${name} keeps a generated placeholder`);
  }
  assert.deepEqual(placeholderShape('mud-puddle'), { width: 32, height: 32, frames: 1 });
  assert.deepEqual(placeholderShape('decal-zone-cross'), { width: 96, height: 96, frames: 1 });
  assert.deepEqual(PLACEHOLDERS_3D['mud-puddle'].frames(), [mudTileGrid()], 'the puddle placeholder stays the generated mud-art.js tile');
  assert.equal(JSON.stringify(readFileSync(new URL('../src/render3d/mud-art.js', import.meta.url))).includes('png'), false, 'mud-art.js stays a pure placeholder');
});

test('the supplied files have their sizes, real alpha, and the 5 cross cells where the zone pieces look', () => {
  const puddle = readPng('3d/v3/mud-puddle.png');
  assert.deepEqual([puddle.width, puddle.height], [32, 32]);
  assert.equal(puddle.alpha(16, 16), 255, 'the puddle is solid in the middle');
  assert.equal(puddle.alpha(0, 0), 0, 'and see-through at the corner');
  const cross = readPng('3d/v3/decal-zone-cross.png');
  assert.deepEqual([cross.width, cross.height], [96, 96]);
  // The piece of the cross cell (dx, dy) shows the 32 px cell (dx + 1, dy + 1) of the file.
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    assert.ok(cross.alpha((dx + 1) * 32 + 16, (dy + 1) * 32 + 16) > 0, `the cross cell (${dx}, ${dy}) has its tile`);
  }
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    assert.equal(cross.alpha((dx + 1) * 32 + 16, (dy + 1) * 32 + 16), 0, `the corner cell (${dx}, ${dy}) is see-through in the middle`);
  }
  const rock = readPng('3d/v3/rock.png');
  assert.deepEqual([rock.width, rock.height], [32, 32]);
});

test('a petrified rock sits right on its plot: its base is on the same ground line as the plants', () => {
  const plant = readPng('3d/v3/plant-x.png');
  const rock = readPng('3d/v3/rock.png');
  const plantAnchor = metaAnchor(DEFAULT_V3_META, 'plant-x');
  const rockAnchor = metaAnchor(DEFAULT_V3_META, 'rock-v3');
  assert.deepEqual(rockAnchor, { x: 16, y: 27 });
  const plantFeet = lowestRow(plant, 4 * 36, 36) - plantAnchor.y; // rows below the anchor row
  const rockFeet = lowestRow(rock, 0, 32) - rockAnchor.y;
  assert.equal(rockFeet, plantFeet, 'the rock\'s lowest pixel row is as far under the plot centre as a plant\'s');
  const meta = JSON.parse(readFileSync(new URL('../assets/v3-meta.json', import.meta.url), 'utf8'));
  assert.deepEqual(meta['rock-v3'].anchor, [rockAnchor.x, rockAnchor.y], 'the file and the default agree');
  // The boulder is centred on its anchor column.
  let left = 31;
  let right = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (rock.alpha(x, y) > 0) [left, right] = [Math.min(left, x), Math.max(right, x)];
  assert.equal((left + right + 1) / 2, rockAnchor.x);
});

test('the dried crust tile and the stone grey map are pure pixel work', () => {
  const grid = dryMudTileGrid();
  assert.deepEqual([grid.width, grid.height], [DRY_TILE_PX, DRY_TILE_PX]);
  assert.deepEqual(dryMudTileGrid(), grid, 'the same tile every time');
  const colours = new Set(grid.pixels.filter(Boolean));
  assert.ok(colours.size >= 4, 'rim, earth, highlight and cracks');
  assert.equal(grid.pixels[0], null, 'see-through at the corner');
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 9, 9, 9, 0]);
  const stone = stonePixels(pixels);
  assert.equal(stone[3], 255, 'alpha stays');
  assert.equal(stone[7], 255);
  assert.equal(stone[15], 0, 'a see-through pixel stays see-through');
  for (let i = 0; i < 12; i += 4) assert.ok(stone[i] > 0 && Math.abs(stone[i] - stone[i + 1]) < 20, 'no colour left: red, green and blue are close');
  assert.deepEqual([...stone.slice(4, 7)], [...STONE_DARK], 'black becomes the dark stone');
  assert.deepEqual([...stone.slice(8, 11)], [...STONE_LIGHT], 'white becomes the light stone');
  assert.ok(stone[0] > STONE_DARK[0] && stone[0] < STONE_LIGHT[0], 'red keeps a mid brightness');
});

test('the constants are named, the retired ones are gone', () => {
  assert.equal(THROW_DELAY_MS, THROW_DROP_MS + THROW_SPIN_MS, 'the flight starts when the spin-up ends');
  assert.equal(TORNADO_PETAL_OPACITY, 0.4, 'the caster\'s petals are 40 percent');
  for (const removed of ['FIELD_GUST_COUNT', 'ROCK_FALL_MS', 'ROCK_FALL_HEIGHT', 'ROCK_SETTLE_MS', 'ROCK_CRUMBLE_MS', 'TORNADO_PARTICLE_RATE']) {
    assert.equal(config[removed], undefined, `${removed} is retired`);
  }
  assert.ok(MUD_FORM_FROM > 0 && MUD_FORM_FROM < 1);
  assert.ok(SURFACE_POP_AT > 0 && SURFACE_POP_AT < 1);
  assert.ok(PETRIFY_FLICKER_FROM < PETRIFY_GREY_FROM && PETRIFY_GREY_FROM < 1);
  assert.ok(PETRIFY_SQUASH > 0 && PETRIFY_SQUASH < 1);
});

// --- The events: what each shows ---

// A game with the sides of the default match; each move is [x, y] or { skill, target }.
function play(moves, options = {}) {
  let state = createInitialState();
  const results = [];
  for (const move of moves) {
    const player = state.currentPlayer;
    const result = Array.isArray(move)
      ? placeStone(state, { player, x: move[0], y: move[1] }, options)
      : useSkill(state, { player, skill: move.skill, target: move.target });
    assert.equal(result.ok, true, result.error);
    results.push(result);
    state = result.state;
  }
  return results;
}

test('an unused puddle that dries shows the dried crust; a puddle only dries on its own cell', () => {
  const specs = visualsForEvents([{ type: 'mudDried', player: O, x: 3, y: 4 }]);
  assert.deepEqual(specs, [{ kind: 'mudDry', x: 3, y: 4, player: O }]);
  assert.equal(heldCell(specs[0], [0, 150, 450, 850, 1200]), null, 'no plant is hidden for it');
});

test('the other seat sees NOTHING of a Tornado Zone on the board, only the banner; the caster sees the cross', () => {
  const [cast] = play([{ skill: TORNADO_ZONE, target: { x: 7, y: 7 } }]);
  const own = visualsForEvents(cast.events);
  assert.deepEqual(kinds(own).filter((kind) => kind !== 'banner'), ['tornado'], 'the caster\'s reminder of the cross');
  const masked = maskForViewer(cast.state, O);
  const theirs = visualsForEvents(maskEventsForViewer(masked, cast.events));
  assert.deepEqual(kinds(theirs).filter((kind) => kind !== 'banner'), [], 'no gust over the field, no ring, no swirl');
  assert.equal(JSON.stringify(theirs).includes('"x":7'), false, 'and no coordinate of the cross');
});

test('no effect names a plot that is covered for the viewer', () => {
  const events = [
    { type: 'mudPlaced', player: O, x: 3, y: 3, driesAfterTurn: 6 },
    { type: 'stonePlaced', player: X, x: 3, y: 3 },
    { type: 'stoneSunk', player: X, x: 3, y: 3, surfacesAfterTurn: 5 },
    { type: 'stoneSurfaced', player: X, x: 3, y: 3 },
    { type: 'mudDried', player: O, x: 3, y: 3 },
    { type: 'stonePetrified', player: O, x: 3, y: 3, from: X },
    { type: 'mudPlaced', player: O, x: 9, y: 9, driesAfterTurn: 6 },
    { type: 'stonePetrified', player: O, x: 9, y: 8, from: X },
  ];
  const masked = { covered: [{ x: 3, y: 3 }], tornado: null };
  const specs = visualsForEvents(maskEventsForViewer(masked, events));
  assert.ok(specs.length > 0);
  for (const spec of specs) assert.ok(!(spec.x === 3 && spec.y === 3), `${spec.kind} names the covered plot`);
  assert.deepEqual(kinds(specs), ['mudForm', 'petrify']);
});

// --- Poses ---

test('a new puddle spreads out from a part of its size, swells a little and settles at exactly 1', () => {
  assert.equal(mudSpread(0), MUD_FORM_FROM);
  assert.equal(mudSpread(-50), MUD_FORM_FROM);
  let last = 0;
  let most = 0;
  for (let t = 0; t <= MUD_FORM_MS; t += 5) {
    const size = mudSpread(t);
    most = Math.max(most, size);
    if (t < MUD_FORM_MS / 2) assert.ok(size >= last, 'grows at first');
    last = size;
  }
  assert.ok(most > 1 && most < 1.15, `a small overshoot (${most})`);
  assert.equal(mudSpread(MUD_FORM_MS), 1);
  assert.equal(mudSpread(Infinity), 1, 'a puddle nobody saw form is full size');
  assert.equal(mudSpread(NaN), 1);
});

test('a seed in mud lands, then sinks all the way, smoothly; one that was sunk on load is fully sunk', () => {
  assert.equal(sinkAmount(0), 0);
  assert.equal(sinkAmount(SINK_DELAY_MS), 0, 'it lands first');
  let last = 0;
  for (let t = SINK_DELAY_MS; t <= SINK_DELAY_MS + SINK_MS; t += 10) {
    const depth = sinkAmount(t);
    assert.ok(depth >= last && depth <= 1);
    last = depth;
  }
  assert.equal(sinkAmount(SINK_DELAY_MS + SINK_MS), 1);
  assert.equal(sinkAmount(Infinity), 1);
  assert.ok(SUNK_DEPTH_PX > 0 && SUNK_DIM < 1);
});

test('a surfacing sprout rises, pops a little above its plot and settles exactly on it', () => {
  assert.equal(surfaceDepth(0), 1, 'it starts sunk');
  assert.equal(surfaceDepth(-5), 1);
  let lowest = 1;
  let lowestAt = 0;
  for (let t = 0; t <= SURFACE_MS; t += 2) {
    const depth = surfaceDepth(t);
    if (depth < lowest) [lowest, lowestAt] = [depth, t];
  }
  assert.ok(Math.abs(lowest + SURFACE_OVERSHOOT) < 1e-3, `it pops ${SURFACE_OVERSHOOT} of its depth above its plot (${lowest})`);
  assert.ok(Math.abs(lowestAt - SURFACE_POP_AT * SURFACE_MS) <= 4, 'at the pop moment');
  assert.equal(surfaceDepth(SURFACE_MS), 0, 'settled on its plot');
  assert.equal(surfaceDepth(Infinity), 0, 'a seed that surfaced long ago stands on its plot');
  assert.equal(surfaceDepth(NaN), 0);
});

test('the dried crust fades from solid to gone over DRY_MS', () => {
  assert.equal(dryAmount(0), 1);
  assert.equal(dryAmount(DRY_MS), 0);
  assert.equal(dryAmount(Infinity), 0);
  let last = 1;
  for (let t = 0; t <= DRY_MS; t += 25) {
    const amount = dryAmount(t);
    assert.ok(amount <= last + 1e-12);
    last = amount;
  }
});

test('a Petrification wraps and drains the plant, shatters it, and pops the rock in squashed', () => {
  const out = {};
  const at = (ageMs) => petrifyPose(Object.assign(out, { ageMs }));
  assert.equal(at(0).stage, PETRIFY_STAGE_WRAP);
  assert.equal(out.grey, 0, 'it starts in its colours');
  assert.equal(petrifyGrey(PETRIFY_WRAP_MS * (PETRIFY_FLICKER_FROM - 0.05)), false);
  assert.equal(petrifyGrey(PETRIFY_WRAP_MS * PETRIFY_GREY_FROM), true, 'grey for good from PETRIFY_GREY_FROM');
  assert.equal(petrifyGrey(PETRIFY_WRAP_MS), true);
  let swaps = 0;
  let before = false;
  for (let t = 0; t < PETRIFY_WRAP_MS; t += 4) {
    const grey = petrifyGrey(t);
    if (grey !== before) swaps++;
    before = grey;
  }
  assert.ok(swaps >= 4 && swaps <= 9, `the colour flickers to grey and back before it stays grey (${swaps} swaps)`);
  assert.equal(at(PETRIFY_WRAP_MS).stage, PETRIFY_STAGE_SHATTER);
  assert.equal(out.grey, 1, 'the plant that shatters is the grey one');
  at(PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS / 2);
  assert.ok(out.scaleX > 1 && out.scaleY < 1, 'it bursts wide and flat');
  const rockAt = PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS;
  assert.equal(at(rockAt - 1).stage, PETRIFY_STAGE_SHATTER);
  assert.equal(at(rockAt).stage, PETRIFY_STAGE_ROCK);
  assert.equal(out.grey, 0);
  assert.ok(Math.abs(out.scaleX - (1 + PETRIFY_SQUASH)) < 1e-9 && Math.abs(out.scaleY - (1 - PETRIFY_SQUASH)) < 1e-9, 'the rock pops in squashed');
  assert.equal(out.done, false);
  at(rockAt + PETRIFY_SETTLE_MS);
  assert.deepEqual([out.scaleX, out.scaleY, out.done], [1, 1, true], 'and settles at its true size');
  assert.equal(petrifyMs(), rockAt + PETRIFY_SETTLE_MS);
  assert.equal(shakeStrength({ kind: 'petrify' }) > 0, true);
});

test('a thrown seed is spun up off its plot, turning round, before it flies', () => {
  const out = {};
  const at = (ageMs, plain = false) => throwPose(Object.assign(out, { ageMs }), plain);
  at(THROW_DROP_MS);
  assert.deepEqual([out.lift, out.spinScale], [0, 1], 'it has dropped and has not started to spin');
  at(THROW_DROP_MS + THROW_SPIN_MS / 2);
  assert.ok(out.lift > 0 && out.lift < THROW_SPIN_LIFT, 'rising');
  let thin = 1;
  let last = 0;
  for (let t = THROW_DROP_MS; t <= THROW_DELAY_MS; t += 5) {
    at(t);
    assert.ok(out.lift >= last - 1e-12, 'only rises');
    assert.ok(out.spinScale >= 0.1 && out.spinScale <= 1, 'never thinner than a sliver');
    thin = Math.min(thin, out.spinScale);
    last = out.lift;
  }
  assert.ok(thin < 0.3, `it turns edge on (${thin})`);
  at(THROW_DELAY_MS);
  assert.equal(out.lift, THROW_SPIN_LIFT, 'at the top when the flight starts');
  assert.equal(out.progress, 0);
  assert.equal(out.spinScale, 1, 'flat again');
  at(THROW_DELAY_MS + THROW_MS);
  assert.deepEqual([out.progress, out.height, out.done], [1, 0, true]);
  at(THROW_DROP_MS + THROW_SPIN_MS / 2, true);
  assert.equal(out.lift, 0, 'plain slides are not lifted');
});

// --- Plans ---

const PLAN_BUILDERS = {
  mudForm: (options) => mudFormPlan(options),
  seedSink: (options) => seedSinkPlan(options),
  seedSurface: (options) => seedSurfacePlan(options),
  mudDry: (options) => mudDryPlan(options),
  petrify: (options) => petrifyPlan(options),
  storm: (options) => stormPlan({ x: 7, y: 7, cells: CROSS_AT_7_7 }, options),
};
const CROSS_AT_7_7 = [{ x: 7, y: 6 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 7, y: 8 }];
const optionsFor = (level, seed = SKILL_PLAN_SEED) => ({ features: QUALITY_LEVELS[level], seed });

test('every plan is deterministic and frozen', () => {
  for (const [name, build] of Object.entries(PLAN_BUILDERS)) {
    for (const level of QUALITY_ORDER) {
      const one = build(optionsFor(level));
      const two = build(optionsFor(level));
      assert.deepEqual(one, two, `${name} on ${level}`);
      assert.ok(Object.isFrozen(one), `${name} is frozen`);
      for (const step of one) {
        assert.ok(Object.isFrozen(step) && Object.isFrozen(step.from), `${name} steps are frozen`);
      }
    }
    assert.notDeepEqual(build(optionsFor('high', 1)), build(optionsFor('high', 2)), `${name}: another plot, another plan`);
  }
});

test('plans follow the particle cap of the quality table: Low none, Medium few, High full', () => {
  for (const [name, build] of Object.entries(PLAN_BUILDERS)) {
    const counts = Object.fromEntries(QUALITY_ORDER.map((level) => [level, particleSteps(build(optionsFor(level)))]));
    assert.equal(counts.low, 0, `${name}: nothing on Low`);
    assert.ok(counts.medium > 0, `${name}: a few on Medium`);
    assert.ok(counts.medium < counts.high, `${name}: Medium ${counts.medium} < High ${counts.high}`);
    for (const level of QUALITY_ORDER) assert.ok(counts[level] <= QUALITY_LEVELS[level].particleCap, `${name} on ${level} stays in the cap`);
    assert.equal(build(optionsFor('low')).length, 0, `${name}: no step at all on Low`);
  }
  // A smaller cap than the full counts cuts the plan, whatever the level is called.
  const tight = { features: { ...QUALITY_LEVELS.high, particleCap: 7 }, seed: SKILL_PLAN_SEED };
  for (const [name, build] of Object.entries(PLAN_BUILDERS)) assert.ok(particleSteps(build(tight)) <= 7, name);
  const source = readFileSync(new URL('../src/render3d/skill-plans.js', import.meta.url), 'utf8');
  assert.equal(/['"](low|medium|high)['"]/.test(source), false, 'no level name in the plans');
});

test('plan steps are well formed and every kind has a look', () => {
  for (const [name, build] of Object.entries(PLAN_BUILDERS)) {
    for (const step of build(optionsFor('high'))) {
      const look = STEP_LOOKS[step.kind];
      assert.ok(look, `${name}: ${step.kind} has a look`);
      assert.ok(Number.isInteger(step.tone) && step.tone >= 0 && step.tone < look.colours.length, `${name}: tone`);
      assert.ok(step.startMs >= 0 && step.durationMs > 0, `${name}: times`);
      assert.equal(step.particle, true);
      assert.equal(step.from.length, 3);
      if (step.spiral) {
        for (const key of ['radius', 'angle', 'spin', 'rise', 'widen']) assert.ok(Number.isFinite(step[key]), `${name}: ${key}`);
      } else {
        assert.equal(step.to.length, 3);
        assert.ok(step.height >= 0);
      }
    }
  }
});

test('each plan is built once per event: plans() counts one build and a frame builds none', () => {
  const before = planStats.built;
  mudFormPlan(optionsFor('high'));
  assert.equal(planStats.built, before + 1);
  petrifyPlan(optionsFor('high'));
  stormPlan({ x: 7, y: 7, cells: CROSS_AT_7_7 }, optionsFor('medium'));
  assert.equal(planStats.built, before + 3);
});

test('the petrify plan winds energy before the shatter, throws chips at it and raises dust after it', () => {
  const plan = petrifyPlan(optionsFor('high'));
  const motes = plan.filter((step) => step.kind === 'earthMote' || step.kind === 'mossMote');
  const chips = plan.filter((step) => step.kind === 'stoneChip');
  const dust = plan.filter((step) => step.kind === 'dust');
  assert.ok(motes.length > 0 && chips.length > 0 && dust.length > 0);
  assert.ok(motes.every((step) => step.spiral && step.startMs < PETRIFY_WRAP_MS), 'the energy winds round the plant while its colour drains');
  assert.ok(motes.some((step) => step.kind === 'earthMote') && motes.some((step) => step.kind === 'mossMote'), 'gold and green');
  assert.ok(chips.every((step) => step.startMs >= PETRIFY_WRAP_MS && step.startMs < PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS), 'chips fly as it shatters');
  assert.ok(dust.every((step) => step.startMs >= PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS), 'dust rises off the new rock');
  assert.ok(dust.every((step) => step.to[1] > step.from[1]), 'rising');
});

test('the storm plan whirls only over the cells of the revealed cross', () => {
  const plan = stormPlan({ x: 7, y: 7, cells: CROSS_AT_7_7 }, optionsFor('high'));
  const allowed = new Set(CROSS_AT_7_7.map((cell) => `${(cell.x - 7) * CELL_SIZE},${(cell.y - 7) * CELL_SIZE}`));
  const seen = new Set();
  for (const step of plan) {
    assert.ok(step.spiral, 'a whirlwind');
    seen.add(`${step.from[0]},${step.from[2]}`);
  }
  for (const centre of seen) assert.ok(allowed.has(centre), `a whirl round ${centre} is over a cross cell`);
  assert.equal(seen.size, 5, 'every cell of the cross has its whirl');
  const clipped = stormPlan({ x: 0, y: 0, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, optionsFor('high'));
  for (const step of clipped) assert.ok(step.from[0] >= 0 && step.from[2] >= 0, 'a cross clipped at the corner has no whirl off the field');
});

test('the secret cross plan exists only for a viewer who may see the cross', () => {
  const zone = { player: X, x: 7, y: 7, cells: CROSS_AT_7_7, armedAfterTurn: 0, endsAfterTurn: 2 };
  const plan = tornadoCrossPlan(zone);
  assert.ok(plan, 'the owner');
  assert.deepEqual(plan.pieces.map((piece) => [piece.x, piece.y, piece.dx, piece.dy]), CROSS_AT_7_7.map((cell) => [cell.x, cell.y, cell.x - 7, cell.y - 7]));
  assert.equal(plan.petalOpacity, TORNADO_PETAL_OPACITY);
  assert.ok(plan.petalRate > 0 && plan.opacity > 0 && plan.opacity <= 1);
  assert.ok(Object.isFrozen(plan));
  // The other seat's copy of the zone, a null zone and a zone with no cells give nothing.
  assert.equal(tornadoCrossPlan({ player: X, hidden: true, endsAfterTurn: 2 }), null);
  assert.equal(tornadoCrossPlan(null), null);
  assert.equal(tornadoCrossPlan(undefined), null);
  assert.equal(tornadoCrossPlan({ player: X, x: 7, y: 7 }), null);
  const [cast] = play([{ skill: TORNADO_ZONE, target: { x: 7, y: 7 } }]);
  assert.ok(tornadoCrossPlan(maskForViewer(cast.state, X).tornado), 'the caster\'s own state');
  assert.ok(tornadoCrossPlan(maskForViewer(cast.state, null).tornado), 'a spectator sees the full state');
  assert.equal(tornadoCrossPlan(maskForViewer(cast.state, O).tornado), null, 'the other seat\'s state has no cross');
  // Drawn pieces are 5 of the 3 by 3 cells of the art: the corners are never used.
  for (const piece of plan.pieces) assert.ok(Math.abs(piece.dx) + Math.abs(piece.dy) <= 1);
});

test('the caster\'s petals are blue and faint; the Tornado code draws only what a plan says', () => {
  assert.ok(CROSS_PETAL_COLOURS.length >= 2);
  for (const colour of CROSS_PETAL_COLOURS) assert.ok((colour & 0xff) > (colour >> 16), 'blue beats red');
  const effects = readFileSync(new URL('../src/render3d/effects3d.js', import.meta.url), 'utf8');
  assert.equal(/FIELD_GUST|fieldGust|tornadoHidden/.test(effects), false, 'the field wide gust is gone');
  assert.equal(/rockFall|rockCrumble|crumbs\(/.test(effects), false, 'the rock fall and crumble code is gone');
});

// --- The renderer (the fake browser) ---

async function build(quality = 'high') {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const { createLocalGame } = await import('../src/ui/local-game.js');
  const { artSource } = await import('../src/render3d/art.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality, createRenderer: () => gl });
  const game = createLocalGame({ random: () => 0 });
  const ctx = fakeCanvas().getContext('2d');
  let time = 1000;
  const frames = (count = 1, each = null) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...game.getView(), time });
      if (each) each(i);
    }
  };
  const deliver = () => renderer.trigger(game.takeEvents(), time, game.getState().characters);
  const meshes = (predicate) => {
    const found = [];
    gl.scene.traverse((object) => {
      if (object.visible && object.isMesh && predicate(object)) found.push(object);
    });
    return found;
  };
  // The sprites standing on cell (x, y): each is a group of a blob shadow, a sun shadow and its plane.
  const sprites = (x, y) => {
    const { x: wx, z: wz } = cellToWorld(x, y);
    const found = [];
    gl.scene.traverse((object) => {
      if (object.isGroup && object.children.length === 3 && object.children[2].isMesh
        && Math.abs(object.position.x - wx) < 1e-6 && Math.abs(object.position.z - wz) < 1e-6) found.push(object);
    });
    return found;
  };
  const standing = (x, y) => sprites(x, y).filter((group) => group.visible);
  const rockSource = artSource(ART.v3.rock);
  const isRock = (group) => group.children[2].material.map?.image === rockSource;
  const zoneSource = artSource(ART.v3.decal.zoneCross);
  const mudSource = artSource(ART.v3.mudPuddle);
  const zoneDecals = (name = null) => meshes((m) => m.material.map?.image === zoneSource && (name === null || m.name === name)).length;
  const puddles = () => meshes((m) => m.material.map?.image === mudSource);
  const crustsAt = (x, y) => meshes((m) => m.name === 'mud-crust' && Math.abs(m.position.x - cellToWorld(x, y).x) < 1e-6
    && Math.abs(m.position.z - cellToWorld(x, y).z) < 1e-6);
  return { gl, renderer, game, frames, deliver, meshes, standing, isRock, zoneDecals, puddles, crustsAt, ctx, now: () => time };
}

// The live particles of the effects' main pool (the Points mesh with its
// capacity; the vines and the rings have pools of their own).
function mainParticles(scene) {
  const live = [];
  scene.traverse((object) => {
    if (!object.isPoints || !object.visible || object.geometry.attributes.position.count !== QUALITY_LEVELS.high.particleCap) return;
    const count = object.geometry.drawRange.count === Infinity ? 0 : object.geometry.drawRange.count;
    const { aColor, aAlpha } = object.geometry.attributes;
    for (let i = 0; i < count; i++) live.push({ r: aColor.array[i * 3], g: aColor.array[i * 3 + 1], b: aColor.array[i * 3 + 2], alpha: aAlpha.array[i] });
  });
  return live;
}

const isPetal = ({ r, g, b }) => CROSS_PETAL_COLOURS.some((colour) => (
  Math.abs(r - ((colour >> 16) & 255) / 255) < 0.01 && Math.abs(g - ((colour >> 8) & 255) / 255) < 0.01 && Math.abs(b - (colour & 255) / 255) < 0.01));

function castZone(game, x = 7, y = 7) {
  assert.equal(game.clickSkill(X, TORNADO_ZONE), true);
  assert.equal(game.click({ x, y }), true);
}

test('the caster sees the cross and faint blue petals over its cells; the bear sees none of it', async () => {
  const { game, frames, deliver, zoneDecals, gl } = await build('high');
  frames(3);
  castZone(game);
  deliver();
  frames(80);
  assert.equal(zoneDecals('tornado-cross'), 5, 'the cross: one decal piece for each of the 5 cells');
  const petals = mainParticles(gl.scene).filter(isPetal);
  assert.ok(petals.length > 0, 'petals drift over the cross');
  assert.ok(petals.every((p) => p.alpha <= TORNADO_PETAL_OPACITY + 1e-6), `no petal is more than ${TORNADO_PETAL_OPACITY} opaque`);

  assert.equal(game.click({ x: 0, y: 0 }), true); // the planting hands the turn to the bear
  deliver();
  frames(1);
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(zoneDecals(), 0, 'no cross decal for the bear');
  assert.equal(mainParticles(gl.scene).filter(isPetal).length, 0, 'no petal for the bear, on the very first frame');
  frames(120);
  assert.equal(mainParticles(gl.scene).filter(isPetal).length, 0, 'and none later');
});

test('the other seat\'s renderer draws nothing at all of a cast Tornado Zone: no cross, no petals, no gust', async () => {
  const { renderer, gl, zoneDecals, ctx } = await build('high');
  const { createLocalGame } = await import('../src/ui/local-game.js');
  const caster = createLocalGame({ random: () => 0 });
  castZone(caster);
  const state = caster.getState();
  const masked = maskForViewer(state, O);
  assert.equal(masked.tornado.hidden, true);
  const events = maskEventsForViewer(masked, caster.takeEvents());
  renderer.trigger(events, 2000, state.characters);
  for (let i = 0; i < 90; i++) {
    renderer.drawGameScreen(ctx, { state: masked, hover: null, preview: null, time: 2000 + (i + 1) * 16 });
    assert.equal(mainParticles(gl.scene).length, 0, `no particle on frame ${i}`);
  }
  assert.equal(zoneDecals(), 0);
});

test('a new puddle spreads out under its plot and then stays full size, drawn from mud-puddle', async () => {
  const { game, frames, deliver, puddles } = await build('high');
  frames(2);
  assert.equal(game.click({ x: 0, y: 0 }), true);
  deliver();
  assert.equal(game.clickSkill(O, MUD_TRAP), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  const sizes = [];
  frames(60, () => {
    assert.equal(puddles().length, 1, 'the puddle shows');
    sizes.push(puddles()[0].scale.x);
  });
  assert.ok(sizes[0] < 0.55, `it starts small (${sizes[0]})`);
  assert.ok(sizes.slice(0, 10).every((size, i, all) => i === 0 || size >= all[i - 1] - 1e-9), 'it spreads out');
  assert.equal(sizes.at(-1), 1, 'and is full size once it has formed');
});

// X plants (0, 0); O casts Mud Trap on (7, 7) and plants; the next turn is X's.
async function mudGame(quality) {
  const scene = await build(quality);
  const { game, frames, deliver } = scene;
  frames(2);
  assert.equal(game.click({ x: 0, y: 0 }), true);
  deliver();
  assert.equal(game.clickSkill(O, MUD_TRAP), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  assert.equal(game.click({ x: 14, y: 14 }), true);
  deliver();
  frames(40);
  return scene;
}

const dimOf = (group) => group.children[2].material.color.r;

test('a seed planted in the puddle sinks below the ground and goes dim, then the sprout pops up out of it', async () => {
  const { game, frames, deliver, standing, puddles, crustsAt, now } = await mudGame('high');
  assert.equal(game.click({ x: 9, y: 9 }), true); // X plants into the puddle: the seed sinks
  assert.equal(game.getState().sunk.length, 1);
  deliver();
  const planted = now();
  const dims = [];
  frames(100, () => dims.push(dimOf(standing(9, 9)[0])));
  assert.equal(dims[0], 1, 'it drops in bright');
  for (let i = 1; i < dims.length; i++) assert.ok(dims[i] <= dims[i - 1] + 1e-9, 'only goes darker while it sinks');
  assert.ok(Math.abs(dims.at(-1) - SUNK_DIM) < 1e-9, `fully sunk it is drawn at ${SUNK_DIM}`);
  assert.ok(dims.some((dim) => dim < 1 && dim > SUNK_DIM), 'it sank over time, not in one step');
  const lift = -SUNK_DEPTH_PX * config.PX_WORLD * config.SPRITE_STRETCH_Y;
  assert.ok(Math.abs(standing(9, 9)[0].children[2].position.y - lift) < 1e-9, 'pushed down into its plot');
  assert.equal(puddles().length, 1, 'the puddle stays under it');
  assert.ok(now() - planted > SINK_DELAY_MS + SINK_MS);

  // The end of O's next turn: the seed surfaces. It pops a little above its plot, then stands on it.
  assert.equal(game.click({ x: 1, y: 1 }), true);
  assert.equal(game.getState().sunk.length, 0);
  deliver();
  const heights = [];
  frames(Math.ceil(SURFACE_MS / 16) + 6, () => heights.push(standing(9, 9)[0].children[2].position.y));
  assert.ok(heights[0] < 0, 'it starts below its plot');
  assert.ok(Math.max(...heights) > 0.005, 'it pops above its plot');
  assert.ok(Math.abs(heights.at(-1)) < 1e-12, 'and settles exactly on it');
  assert.equal(dimOf(standing(9, 9)[0]), 1, 'bright again');
  assert.equal(puddles().length, 0, 'the wet puddle is gone');
  assert.ok(crustsAt(9, 9).length >= 1, 'the dried, cracked crust shows over the plot');
  frames(Math.ceil(DRY_MS / 16) + 4);
  assert.equal(crustsAt(9, 9).length, 0, 'and fades away');
});

test('an unused puddle that dries shows the cracked crust and then bare soil', async () => {
  const { game, frames, deliver, puddles, crustsAt } = await build('high');
  frames(2);
  assert.equal(game.click({ x: 0, y: 0 }), true);
  deliver();
  assert.equal(game.clickSkill(O, MUD_TRAP), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  frames(2);
  assert.equal(puddles().length, 1);
  let cell = 0;
  while (game.getState().mud.length > 0) {
    assert.equal(game.click({ x: cell % 15, y: 12 + Math.floor(cell / 15) }), true);
    cell++;
    deliver();
    frames(2);
    assert.ok(cell < 10, 'the puddle dries after MUD_LIFETIME_TURNS turns');
  }
  assert.equal(puddles().length, 0, 'no wet puddle is drawn on it');
  assert.ok(crustsAt(9, 9).length >= 1, 'the dried crust shows');
  frames(Math.ceil(DRY_MS / 16) + 4);
  assert.equal(crustsAt(9, 9).length, 0, 'and fades to bare soil');
});

// The live particles of the main pool over plot (x, y).
function particlesOver(scene, x, y) {
  const at = cellToWorld(x, y);
  let found = 0;
  scene.traverse((object) => {
    if (!object.isPoints || !object.visible || object.geometry.attributes.position.count !== QUALITY_LEVELS.high.particleCap) return;
    const count = object.geometry.drawRange.count === Infinity ? 0 : object.geometry.drawRange.count;
    const xyz = object.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      if (Math.abs(xyz[i * 3] - at.x) <= 0.5 && Math.abs(xyz[i * 3 + 2] - at.z) <= 0.5) found++;
    }
  });
  return found;
}

// The viewer's view with plot (x, y) under a cloud of the other seat, in the shape maskForViewer makes: a taken plot is
// HIDDEN, and the puddle and the sunk seed of the plot are left out.
function coveredView(view, x, y) {
  const board = view.state.board.map((row) => row.slice());
  if (board[y][x] !== EMPTY) board[y][x] = HIDDEN;
  const elsewhere = (cell) => !(cell.x === x && cell.y === y);
  return { ...view, state: { ...view.state, board, covered: [{ x, y }], mud: view.state.mud.filter(elsewhere), sunk: view.state.sunk.filter(elsewhere) } };
}

test('stopRunsAt, stopRingsAt and removeInBox end only what plays on that plot', () => {
  const plan = [{ kind: 'dust', startMs: 0, durationMs: 400 }];
  const runs = createPlacementRuns(3);
  startPlacementRun(runs, plan, 1.5, 2.5, 0);
  startPlacementRun(runs, plan, 4.5, 2.5, 0);
  stopRunsAt(runs, 1.5, 2.5);
  assert.deepEqual(runs.map((run) => run.active), [false, true, false], 'the run on that plot ends, the other plays on');

  const ring = { z: 2.5, from: 0.2, to: 1, ms: 500, dots: 8, color: 0xffffff };
  const rings = createRings(4);
  startRing(rings, { ...ring, x: 1.5 }, 0);
  startRing(rings, { ...ring, x: 4.5 }, 0);
  startRing(rings, { ...ring, x: 1.5, wobble: 0.1, waves: 3 }, 0); // a Hiss sound wave is not about a plot
  stopRingsAt(rings, 1.5, 2.5);
  assert.deepEqual(rings.map((r) => r.active), [false, true, true, false]);

  const pool = createParticlePool(16);
  const p = createSpawnParams();
  p.life = 5;
  p.size = 0.1;
  p.y = 0.1;
  for (const [x, z] of [[1.4, 2.6], [1.9, 2.1], [2.3, 2.5], [1.5, 3.4], [4.5, 2.5]]) {
    p.x = x;
    p.z = z;
    pool.spawnFall(p);
  }
  pool.removeInBox(1, 2, 2, 3); // the plot 1.5, 2.5 with its edge
  assert.equal(pool.count, 3, 'the two inside are gone');
  const left = [];
  for (let i = 0; i < pool.count; i++) left.push(Math.round(pool.x[i] * 10) / 10);
  assert.deepEqual(left.sort(), [2.3, 1.5, 4.5].sort());
});

test('a plot that becomes covered while its mud effects play shows none of them on the next frame, nor later', async () => {
  const { game, renderer, frames, crustsAt, gl, ctx, now } = await mudGame('high');
  renderer.trigger([{ type: 'mudDried', player: O, x: 9, y: 9 }], now(), game.getState().characters);
  frames(8);
  assert.ok(crustsAt(9, 9).length >= 1, 'the crust shows');
  assert.ok(particlesOver(gl.scene, 9, 9) > 0, 'dust rises off the puddle');

  let time = now();
  const draw = (view) => renderer.drawGameScreen(ctx, { ...view, time: (time += 16) });
  draw(coveredView(game.getView(), 9, 9));
  assert.equal(crustsAt(9, 9).length, 0, 'the crust is gone');
  assert.equal(particlesOver(gl.scene, 9, 9), 0, 'and the dust');
  for (let i = 0; i < 90; i++) {
    draw(coveredView(game.getView(), 9, 9));
    assert.equal(crustsAt(9, 9).length, 0, `no crust on frame ${i}`);
    assert.equal(particlesOver(gl.scene, 9, 9), 0, `no later step of the plan reaches the covered plot (frame ${i})`);
  }
});

test('a puddle that formed while covered is full size when it is seen again; the bear\'s sunk seed leaves no effect behind', async () => {
  const { game, renderer, frames, deliver, puddles, standing, gl, ctx, now } = await build('high');
  frames(2);
  assert.equal(game.click({ x: 0, y: 0 }), true);
  deliver();
  assert.equal(game.clickSkill(O, MUD_TRAP), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  frames(2);
  assert.ok(puddles()[0].scale.x < 0.55, 'the puddle is still spreading out');
  let time = now();
  const draw = (view) => renderer.drawGameScreen(ctx, { ...view, time: (time += 16) });
  draw(coveredView(game.getView(), 9, 9));
  assert.equal(puddles().length, 0, 'covered: no puddle');
  assert.equal(particlesOver(gl.scene, 9, 9), 0, 'and no burst over it');
  draw(game.getView());
  assert.equal(puddles()[0].scale.x, 1, 'seen again, the puddle is simply there');
  assert.equal(standing(9, 9).length, 0);
});

test('Petrification: when its plot becomes covered the plant, the grey copy, the rock and the chips are gone at once', async () => {
  const { game, renderer, frames, deliver, standing, gl, ctx, now } = await build('high');
  frames(2);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  frames(90);
  assert.equal(game.clickSkill(O, PETRIFICATION), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  frames(Math.ceil(PETRIFY_WRAP_MS / 16) - 4); // mid wrap: the earth energy winds round the plant
  assert.ok(standing(9, 9).length >= 1);
  assert.ok(particlesOver(gl.scene, 9, 9) > 0);

  let time = now();
  const draw = (view) => renderer.drawGameScreen(ctx, { ...view, time: (time += 16) });
  for (let i = 0; i < 60; i++) {
    draw(coveredView(game.getView(), 9, 9));
    assert.equal(standing(9, 9).length, 0, `nothing stands on the covered plot (frame ${i})`);
    assert.equal(particlesOver(gl.scene, 9, 9), 0, `no particle over it (frame ${i})`);
  }
});

// Every visible sprite group (a plant, a grey copy or a rock) anywhere in the scene: on an empty board these are the
// flying and wilting copies of the effects alone.
function visibleSprites(scene) {
  let found = 0;
  scene.traverse((object) => {
    if (object.isGroup && object.visible && object.children.length === 3 && object.children[2].isMesh) found++;
  });
  return found;
}

test('a thrown seed in the air ends at once when its start or its landing plot becomes covered', async () => {
  for (const covered of [{ x: 10, y: 10 }, { x: 9, y: 9 }]) {
    const { renderer, frames, gl, ctx, game, now } = await build('high');
    frames(3);
    const idle = visibleSprites(gl.scene); // the sprites that stand about anyway
    renderer.trigger([{ type: 'stoneThrown', player: O, from: { x: 10, y: 10 }, to: { x: 9, y: 9 } }], now(), game.getState().characters);
    frames(Math.ceil(config.THROW_DELAY_MS / 16) + 6);
    assert.equal(visibleSprites(gl.scene), idle + 1, 'the seed is in the air');
    let time = now();
    const draw = () => renderer.drawGameScreen(ctx, { ...coveredView(game.getView(), covered.x, covered.y), time: (time += 16) });
    draw();
    assert.equal(visibleSprites(gl.scene), idle, `covering (${covered.x}, ${covered.y}) takes the seed away on the next frame`);
    for (let i = 0; i < 90; i++) {
      draw();
      assert.equal(visibleSprites(gl.scene), idle, `and it never comes back (frame ${i})`);
    }
  }
});

test('a seed placement still playing on a plot that becomes covered stops at once and plays no later step', async () => {
  const { game, frames, deliver, gl, renderer, ctx, now } = await build('high');
  frames(2);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  frames(6);
  assert.ok(particlesOver(gl.scene, 9, 9) > 0, 'the planted seed has its effect going');
  let time = now();
  for (let i = 0; i < 90; i++) {
    renderer.drawGameScreen(ctx, { ...coveredView(game.getView(), 9, 9), time: (time += 16) });
    assert.equal(particlesOver(gl.scene, 9, 9), 0, `no particle over the covered plot (frame ${i})`);
  }
});

test('Petrification: the plant flickers to grey, shatters, and the rock the board holds takes its place', async () => {
  const { game, frames, deliver, standing, isRock, now } = await build('high');
  frames(2);
  assert.equal(game.click({ x: 9, y: 9 }), true); // X plants
  deliver();
  frames(90); // it has grown
  assert.equal(game.clickSkill(O, PETRIFICATION), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  const start = now();
  const shown = [];
  frames(Math.ceil((petrifyMs() + 200) / 16), () => {
    const visible = standing(9, 9);
    assert.equal(visible.length, 1, `exactly one thing stands on the plot (${now() - start} ms)`);
    shown.push(isRock(visible[0]) ? 'rock' : 'plant');
  });
  assert.equal(shown[0], 'plant', 'the plant is still there when the skill is cast');
  assert.equal(shown.at(-1), 'rock', 'the rock stays');
  const firstRock = shown.indexOf('rock');
  assert.ok((firstRock + 1) * 16 >= PETRIFY_WRAP_MS + PETRIFY_SHATTER_MS - 16, `the rock appears after the wrap and the shatter (frame ${firstRock})`);
  assert.ok(shown.slice(firstRock).every((kind) => kind === 'rock'), 'and never goes back');
  frames(40);
  assert.equal(standing(9, 9).length, 1, 'only the board\'s own rock is left, the effect sprites are put away');
  assert.ok(isRock(standing(9, 9)[0]));
});

test('the whirlwind reveals the cross to everybody and spins the seed up before it is thrown; nothing is left afterwards', async () => {
  const { game, frames, deliver, zoneDecals, standing, gl } = await build('high');
  frames(2);
  castZone(game, 9, 9);
  deliver();
  assert.equal(game.click({ x: 14, y: 14 }), true); // the rabbit plants, which arms the trap
  deliver();
  frames(5);
  assert.equal(game.click({ x: 9, y: 9 }), true); // the bear plants on the cross: random 0 throws the seed to (8, 8)
  deliver();
  assert.equal(game.getState().tornado, null, 'the trap is used up');
  let thinnest = 1;
  let highest = 0;
  let particles = 0;
  frames(Math.ceil(THROW_DELAY_MS / 16) + 1, () => {
    assert.equal(zoneDecals('storm-cross'), 5, 'the cross is revealed, all 5 cells');
    assert.equal(zoneDecals('tornado-cross'), 0, 'the caster\'s reminder is gone: the trap is used up');
    for (const group of standing(9, 9)) {
      thinnest = Math.min(thinnest, group.children[2].scale.x);
      highest = Math.max(highest, group.children[2].position.y);
    }
    particles = Math.max(particles, mainParticles(gl.scene).length);
  });
  assert.ok(highest > THROW_SPIN_LIFT * 0.85, `the seed is lifted off its plot (${highest})`);
  assert.ok(thinnest < 0.3, `and turns edge on as it spins (${thinnest})`);
  assert.ok(particles > 0, 'the whirlwind has its particles');
  frames(Math.ceil((THROW_MS + STORM_MS + MARK_FADE_MS) / 16) + 6);
  assert.equal(zoneDecals(), 0, 'the revealed cross fades away');
  assert.equal(standing(9, 9).length, 0, 'the seed has left its plot');
  assert.equal(standing(8, 8).length, 1, 'and grows on the plot it was thrown to');
  assert.equal(mainParticles(gl.scene).length, 0, 'every particle is gone');
});

test('on Low the same events show their marks but no particle at all', async () => {
  const low = await mudGame('low');
  assert.equal(low.game.click({ x: 9, y: 9 }), true);
  low.deliver();
  low.frames(120, () => assert.equal(mainParticles(low.gl.scene).length, 0, 'no particle on Low'));
  assert.equal(low.puddles().length, 1, 'but the puddle is drawn');
  assert.ok(dimOf(low.standing(9, 9)[0]) < 1, 'and the seed still sinks and goes dim');
});

test('particles of all these events stay in the cap of each level', async () => {
  for (const level of QUALITY_ORDER) {
    const { renderer, frames, gl, ctx, game, now } = await build(level);
    frames(3);
    const events = [
      { type: 'mudPlaced', player: O, x: 3, y: 3, driesAfterTurn: 6 },
      { type: 'stoneSunk', player: X, x: 4, y: 4, surfacesAfterTurn: 5 },
      { type: 'stoneSurfaced', player: X, x: 5, y: 5 },
      { type: 'mudDried', player: O, x: 6, y: 6 },
      { type: 'stonePetrified', player: O, x: 7, y: 7, from: X },
      { type: 'tornadoStorm', player: X, x: 10, y: 10, cells: [{ x: 10, y: 9 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }] },
      { type: 'stoneThrown', player: O, from: { x: 10, y: 10 }, to: { x: 9, y: 9 } },
    ];
    renderer.trigger(events, now(), game.getState().characters);
    let most = 0;
    frames(100, () => {
      most = Math.max(most, mainParticles(gl.scene).length);
    });
    void ctx;
    assert.ok(most <= QUALITY_LEVELS[level].particleCap, `${level}: ${most} live particles`);
    if (level === 'low') assert.equal(most, 0);
    else assert.ok(most > 0, `${level} has particles`);
  }
});

// A probe of the Three.js id counters: every texture, material and geometry made takes the next id.
function madeSince(before) {
  const now = { texture: new THREE.Texture().id, material: new THREE.Material().id, geometry: new THREE.BufferGeometry().id };
  if (!before) return now;
  return { texture: now.texture - before.texture - 1, material: now.material - before.material - 1, geometry: now.geometry - before.geometry - 1 };
}

test('with a puddle, a secret cross and then a sunk seed on show, no frame makes a Three.js object at any level', async () => {
  const { game, frames, deliver, renderer, puddles, zoneDecals } = await mudGame('high');
  castZone(game, 3, 3); // X casts the zone and is still to move: the puddle bubbles, the petals drift
  deliver();
  frames(90);
  assert.equal(puddles().length, 1);
  assert.equal(zoneDecals('tornado-cross'), 5);
  const quiet = (what) => {
    for (const level of QUALITY_ORDER) {
      renderer.setQuality(level);
      frames(30);
      const probe = madeSince();
      frames(150);
      assert.deepEqual(madeSince(probe), { texture: 0, material: 0, geometry: 0 }, `${what}, ${level}: 150 frames`);
    }
  };
  quiet('puddle and cross');
  assert.equal(game.click({ x: 9, y: 9 }), true); // X plants into the puddle: a sunk seed, and the turn passes
  deliver();
  frames(90);
  assert.equal(game.getState().sunk.length, 1);
  assert.equal(zoneDecals(), 0, 'the bear sees no cross');
  quiet('sunk seed');
});

test('the second time an effect plays it reuses its pooled sprites, decals and particles: no Three.js object is made', async () => {
  const { renderer, frames, game, now } = await build('high');
  frames(3);
  const round = (dx) => [
    { type: 'mudPlaced', player: O, x: 3 + dx, y: 3, driesAfterTurn: 6 },
    { type: 'stoneSunk', player: X, x: 4 + dx, y: 4, surfacesAfterTurn: 5 },
    { type: 'stoneSurfaced', player: X, x: 5 + dx, y: 5 },
    { type: 'mudDried', player: O, x: 6 + dx, y: 6 },
    { type: 'stonePetrified', player: O, x: 11 + dx, y: 11, from: X },
    { type: 'tornadoStorm', player: X, x: 10, y: 10, cells: [{ x: 10, y: 9 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }] },
    { type: 'stoneThrown', player: O, from: { x: 10, y: 10 }, to: { x: 9 + dx, y: 9 } },
  ];
  renderer.trigger(round(0), now(), game.getState().characters);
  frames(120);
  const probe = madeSince();
  renderer.trigger(round(1), now(), game.getState().characters);
  frames(150);
  assert.deepEqual(madeSince(probe), { texture: 0, material: 0, geometry: 0 }, 'a second round of every effect makes nothing');
});

test('a plan is built once per event and a frame builds none', async () => {
  const { game, frames, deliver } = await build('high');
  frames(2);
  const before = planStats.built;
  assert.equal(game.click({ x: 0, y: 0 }), true);
  deliver();
  assert.equal(planStats.built, before, 'a plain planting plans no skill effect');
  assert.equal(game.clickSkill(O, MUD_TRAP), true);
  assert.equal(game.click({ x: 9, y: 9 }), true);
  deliver();
  assert.equal(planStats.built, before + 1, 'the puddle plan, once');
  frames(120);
  assert.equal(planStats.built, before + 1, 'no frame builds a plan');
  assert.equal(game.click({ x: 14, y: 14 }), true);
  deliver();
  assert.equal(game.click({ x: 9, y: 9 }), true); // X plants into the puddle: the seed sinks
  deliver();
  assert.equal(planStats.built, before + 2, 'the sinking plan, once');
  frames(120);
  assert.equal(planStats.built, before + 2);

  const zone = await build('high');
  zone.frames(2);
  const zoneBefore = planStats.built;
  castZone(zone.game);
  zone.deliver();
  zone.frames(200);
  assert.equal(planStats.built, zoneBefore + 1, 'the cross plan is made once when the caster\'s cross appears and kept while it shows');
});

// --- Secrecy and covered plots, the last two reviewer findings of part 7 ---

test('an expired secret cross is not left fading on the screen of the seat that never saw it', async () => {
  const { game, frames, deliver, zoneDecals } = await build('high');
  frames(2);
  castZone(game, 7, 7); // turn 1: the rabbit sets the trap
  deliver();
  assert.equal(game.click({ x: 14, y: 14 }), true); // the rabbit plants: armed from now on
  deliver();
  frames(3);
  assert.equal(zoneDecals(), 0, 'turn 2, the bear\'s turn: it never sees the cross');
  assert.equal(game.click({ x: 0, y: 0 }), true); // the bear plants outside the cross
  deliver();
  frames(3);
  assert.equal(zoneDecals('tornado-cross'), 5, 'turn 3, back to the rabbit: its own cross is there again');
  assert.equal(game.click({ x: 14, y: 12 }), true); // the rabbit plants outside the cross and the trap expires
  deliver();
  frames(1); // the first frame the bear looks at
  assert.equal(game.getState().tornado, null, 'the trap expired');
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(zoneDecals(), 0, 'not one piece of the expired cross fades on the bear\'s screen');
  frames(40);
  assert.equal(zoneDecals(), 0);
});

// A game in which the bear plants on the cross at (7, 7) and fires the trap.
async function stormGame() {
  const ctx = await build('high');
  const { game, frames, deliver } = ctx;
  frames(2);
  castZone(game, 7, 7);
  deliver();
  assert.equal(game.click({ x: 14, y: 14 }), true);
  deliver();
  frames(3);
  return ctx;
}

function stormPieces(meshes) {
  return meshes((m) => m.name === 'storm-cross');
}

test('a storm whose arm is already covered for the viewer shows no piece and no particle over that plot', async () => {
  const { game, renderer, ctx, deliver, meshes, gl, now } = await stormGame();
  const covered = (view) => coveredView(view, 8, 7);
  let time = now();
  const draw = (count, check) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...covered(game.getView()), time });
      if (check) check(i);
    }
  };
  draw(2); // the plot is covered before the storm starts
  assert.equal(game.click({ x: 7, y: 7 }), true); // the bear fires the trap
  renderer.trigger(game.takeEvents(), time, game.getState().characters);
  const at = cellToWorld(8, 7);
  let shown = 0;
  draw(Math.ceil(THROW_DELAY_MS / 16) + 4, () => {
    shown = Math.max(shown, stormPieces(meshes).length);
    assert.equal(stormPieces(meshes).filter((m) => Math.abs(m.position.x - at.x) < 1e-6 && Math.abs(m.position.z - at.z) < 1e-6).length, 0, 'no piece on the covered arm');
    assert.equal(particlesOver(gl.scene, 8, 7), 0, 'no particle over the covered arm');
  });
  assert.equal(shown, 4, 'the other 4 cells of the cross are still revealed');
});

test('an arm that becomes covered while the storm plays loses its piece and its particles on that frame', async () => {
  const { game, renderer, ctx, deliver, meshes, gl, now } = await stormGame();
  let time = now();
  assert.equal(game.click({ x: 7, y: 7 }), true);
  renderer.trigger(game.takeEvents(), time, game.getState().characters);
  const view = () => game.getView();
  let over = 0;
  for (let i = 0; i < 12; i++) {
    time += 16;
    renderer.drawGameScreen(ctx, { ...view(), time });
    over = Math.max(over, particlesOver(gl.scene, 8, 7));
  }
  assert.equal(stormPieces(meshes).length, 5, 'all 5 cells are revealed while nothing is covered');
  assert.ok(over > 0, 'the whirlwind does reach the arm, so the next check means something');
  const at = cellToWorld(8, 7);
  for (let i = 0; i < 12; i++) {
    time += 16;
    renderer.drawGameScreen(ctx, { ...coveredView(view(), 8, 7), time });
    assert.equal(stormPieces(meshes).filter((m) => Math.abs(m.position.x - at.x) < 1e-6 && Math.abs(m.position.z - at.z) < 1e-6).length, 0, `no piece on frame ${i}`);
    assert.equal(particlesOver(gl.scene, 8, 7), 0, `no particle on frame ${i}`);
  }
});

test('the owner of the trap (a seat looking at its own screen) still sees the cross fade away when it expires', async () => {
  const { game, renderer, ctx, deliver, zoneDecals, now } = await build('high');
  let time = now();
  const draw = (count, viewer) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...game.getView(), viewer, time });
    }
  };
  draw(2, X);
  castZone(game, 7, 7);
  deliver();
  assert.equal(game.click({ x: 14, y: 14 }), true);
  deliver();
  draw(3, X);
  assert.equal(game.click({ x: 0, y: 0 }), true);
  deliver();
  draw(3, X);
  assert.equal(zoneDecals('tornado-cross'), 5, 'the owner sees its own cross');
  assert.equal(game.click({ x: 14, y: 12 }), true); // the trap expires
  deliver();
  draw(1, X); // the rabbit's own screen (online): the zone is gone from the state, the fade goes on
  assert.equal(game.getState().tornado, null);
  assert.ok(zoneDecals('tornado-cross') > 0, 'the cross is still fading on its owner\'s screen');
  draw(Math.ceil(MARK_FADE_MS / 16) + 4, X);
  assert.equal(zoneDecals(), 0, 'and gone when the fade is over');
});
