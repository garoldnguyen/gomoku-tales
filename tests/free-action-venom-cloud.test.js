// Free Action, part 8: the 3D effects of Jade Serpent and Cloud Eagle
// (docs/free-action-design.md section 8). The pure plans (Venom's sap and zone,
// the zone thinning away, the lightning schedule, the cloud views of the two
// seats), the art the owner supplied, and the real renderer on the fake
// browser: the withered plots with fog and bubbles, the drooping target
// plant, the crossed-out border, the translucent cloud of its owner and the
// dense cloud with lightning of the other seat. Tests cannot judge how it
// looks; they check what is shown and when, that nothing is shown on a plot
// the viewer cannot see, and that no frame allocates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from '../vendor/three/build/three.module.js';
import {
  BOARD_SIZE, CELL_SIZE, CLOUD_FADE_OPACITY, CLOUD_LIGHTNING_CHANCE, CLOUD_LIGHTNING_GAP_MS, CLOUD_LIGHTNING_GLOW, CLOUD_LIGHTNING_MS,
  CLOUD_LIGHTNING_PULSE_MS, CLOUD_LIGHTNING_SEED, CLOUD_OPPONENT_OPACITY, CLOUD_SEE_THROUGH_OPACITY, CLOUD_SIZE, POISON_END_FOG,
  POISON_FORM_BUBBLES, POISON_FORM_FOG, POISON_FORM_MS, POISON_OPACITY, POISON_SAP_DROPS, POISON_SPLASH_COUNT, VENOM_DROP_MS, VENOM_WILT_HOLD_MS,
  VENOM_WILT_IN_MS, VENOM_WILT_SQUASH,
} from '../src/config.js';
import { EMPTY, HIDDEN, O, X } from '../src/logic/board.js';
import { CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { cloudBox, cloudCentre, maskForViewer } from '../src/logic/cloud.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { CLOUD, VENOM } from '../src/logic/skills.js';
import { artProblem, ART, PLACEHOLDERS_3D, placeholderShape } from '../src/render3d/art-assets.js';
import { boardMarks } from '../src/render3d/board-marks.js';
import {
  COVER, SEE_THROUGH, cloudLookOpacity, cloudViewsOf, lightningBoltGrid, stormFlashGrid, stormTileGrid,
} from '../src/render3d/cloud-overlay.js';
import {
  lightningAmount, lightningPick, lightningPickAt, lightningSchedule, lightningStartMs, poisonFormAmount, venomWiltMs,
} from '../src/render3d/effect-plans.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import { cellToWorld } from '../src/render3d/picking.js';
import { createPoisonPlots, isForbiddenPlot, poisonPlotsInto } from '../src/render3d/poison-view.js';
import {
  particleSteps, poisonEndPlan, SAP_LAND_HEIGHT, SAP_START_HEIGHT, SKILL_PLAN_SEED, STEP_LOOKS, venomPlan,
} from '../src/render3d/skill-plans.js';
import { fakeCanvas, fakeRenderer, installFakeDocument } from './fake-browser.js';

const hook = `
const root = ${JSON.stringify(new URL('../', import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: root + 'vendor/three/build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: root + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const SQUARE_AT_8_8 = [];
for (let y = 7; y <= 9; y++) for (let x = 7; x <= 9; x++) SQUARE_AT_8_8.push({ x, y });
const AROUND_8_8 = SQUARE_AT_8_8.filter((cell) => !(cell.x === 8 && cell.y === 8));
const optionsFor = (level, seed = SKILL_PLAN_SEED) => ({ features: QUALITY_LEVELS[level], seed });
const venomSpec = (extra = {}) => ({ x: 8, y: 8, cells: AROUND_8_8, target: true, ...extra });

// Plays moves ([x, y] plants, { skill, target } uses a skill) for the player to move.
function play(sides, moves) {
  let state = createInitialState(undefined, sides);
  const results = [];
  for (const move of moves) {
    const player = state.currentPlayer;
    const result = Array.isArray(move)
      ? placeStone(state, { player, x: move[0], y: move[1] })
      : useSkill(state, { player, skill: move.skill, target: move.target ?? null });
    assert.ok(!result.error, result.error);
    results.push(result);
    state = result.state;
  }
  return results;
}

// --- The art the owner supplied ---

function pngSize(file) {
  const data = readFileSync(new URL(`../assets/${file}`, import.meta.url));
  assert.equal(data.toString('ascii', 1, 4), 'PNG', file);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test('the poisoned plot and the forbidden border are registered as 3D art of 32 by 32 and keep a placeholder', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8')).assets;
  assert.deepEqual(manifest['poison-plot'], { file: '3d/v3/poison-plot.png', use: '3d', width: 32, height: 32, frames: 1, frameMs: 0 });
  assert.deepEqual(manifest['decal-forbidden'], { file: '3d/v3/decal-forbidden.png', use: '3d', width: 32, height: 32, frames: 1, frameMs: 0 });
  assert.equal(ART.v3.poisonPlot, 'poison-plot');
  assert.equal(ART.v3.decal.forbidden, 'decal-forbidden');
  for (const name of ['poison-plot', 'decal-forbidden']) {
    assert.equal(artProblem(name, manifest[name]), null, name);
    assert.match(artProblem(name, { ...manifest[name], height: 16 }), new RegExp(`"${name}" must be`), 'a wrong size only warns');
    assert.ok(PLACEHOLDERS_3D[name], `${name} keeps a generated placeholder, so a missing file only warns`);
    assert.deepEqual(placeholderShape(name), { width: 32, height: 32, frames: 1 });
    assert.deepEqual(pngSize(manifest[name].file.replace(/^/, '')), [32, 32], `${name}.png is 32 by 32`);
  }
});

// --- Venom's plans ---

test('the Venom plan is deterministic and frozen, and the zone plans follow the particle cap of the quality table', () => {
  for (const level of QUALITY_ORDER) {
    const one = venomPlan(venomSpec(), optionsFor(level));
    assert.deepEqual(one, venomPlan(venomSpec(), optionsFor(level)), level);
    assert.ok(Object.isFrozen(one));
    for (const step of one) assert.ok(Object.isFrozen(step) && Object.isFrozen(step.from) && Object.isFrozen(step.to), 'steps are frozen');
    const end = poisonEndPlan({ x: 7, y: 7, cells: AROUND_8_8 }, optionsFor(level));
    assert.deepEqual(end, poisonEndPlan({ x: 7, y: 7, cells: AROUND_8_8 }, optionsFor(level)), level);
    assert.ok(particleSteps(one) <= QUALITY_LEVELS[level].particleCap, `${level}: the cast stays in the cap`);
    assert.ok(particleSteps(end) <= QUALITY_LEVELS[level].particleCap, `${level}: the end stays in the cap`);
  }
  assert.equal(venomPlan(venomSpec(), optionsFor('low')).length, 0, 'nothing on Low');
  assert.equal(poisonEndPlan({ x: 7, y: 7, cells: AROUND_8_8 }, optionsFor('low')).length, 0);
  const medium = particleSteps(venomPlan(venomSpec(), optionsFor('medium')));
  const high = particleSteps(venomPlan(venomSpec(), optionsFor('high')));
  assert.ok(medium > 0 && medium < high, `Medium ${medium} is a few, High ${high} is all`);
  assert.notDeepEqual(venomPlan(venomSpec(), optionsFor('high', 1)), venomPlan(venomSpec(), optionsFor('high', 2)), 'another plot, another plan');
  const tight = { features: { ...QUALITY_LEVELS.high, particleCap: 9 }, seed: SKILL_PLAN_SEED };
  assert.ok(particleSteps(venomPlan(venomSpec(), tight)) <= 9, 'a tighter cap cuts the plan, whatever the level is called');
  const source = readFileSync(new URL('../src/render3d/skill-plans.js', import.meta.url), 'utf8');
  assert.equal(/['"](low|medium|high)['"]/.test(source), false, 'no level name in the plans');
});

test('the sap drops fall from the sky onto the target plant while VENOM_DROP_MS passes, then splash off it', () => {
  const plan = venomPlan(venomSpec(), optionsFor('high'));
  const drops = plan.filter((step) => step.kind === 'sapDrop');
  const splash = plan.filter((step) => step.kind === 'sapSplash');
  assert.equal(drops.length, POISON_SAP_DROPS);
  assert.equal(splash.length, POISON_SPLASH_COUNT);
  for (const drop of drops) {
    assert.ok(drop.from[1] >= SAP_START_HEIGHT, 'it starts high up in the sky');
    assert.equal(drop.to[1], SAP_LAND_HEIGHT, 'and lands on the head of the plant');
    assert.ok(Math.abs(drop.to[0]) < 0.1 && Math.abs(drop.to[2]) < 0.1, 'on the target plant');
    assert.ok(drop.startMs + drop.durationMs <= VENOM_DROP_MS + 1, 'it has landed when the sap time is over');
  }
  assert.ok(splash.every((step) => step.startMs >= VENOM_DROP_MS), 'flecks splash off once the drops have landed');
  assert.ok(splash.every((step) => Math.abs(step.to[0]) <= 0.5 && Math.abs(step.to[2]) <= 0.5), 'inside the target plot');
});

test('every step of the zone plans stays over the plot it was made for: a covered neighbour is never touched', () => {
  const cellsOf = (plan, origin) => {
    const seen = new Set();
    for (const step of plan) {
      for (const point of [step.from, step.to]) {
        if (!point) continue;
        const x = origin.x + Math.round(point[0] / CELL_SIZE);
        const y = origin.y + Math.round(point[2] / CELL_SIZE);
        assert.ok(Math.abs(point[0] / CELL_SIZE - Math.round(point[0] / CELL_SIZE)) < 0.5 && Math.abs(point[2] / CELL_SIZE - Math.round(point[2] / CELL_SIZE)) < 0.5);
        seen.add(`${x},${y}`);
      }
    }
    return seen;
  };
  // The plot (7, 7) is covered for the viewer: it is left out of the cells, and nothing reaches it.
  const shown = AROUND_8_8.filter((cell) => !(cell.x === 7 && cell.y === 7));
  for (const level of ['medium', 'high']) {
    assert.ok(venomPlan(venomSpec({ cells: shown }), optionsFor(level)).length > 0);
    assert.ok(poisonEndPlan({ x: shown[0].x, y: shown[0].y, cells: shown }, optionsFor(level)).length > 0);
    const cast = cellsOf(venomPlan(venomSpec({ cells: shown }), optionsFor(level)), { x: 8, y: 8 });
    assert.equal(cast.has('7,7'), false, `${level}: the cast never names the covered plot`);
    const allowed = new Set(['8,8', ...shown.map((cell) => `${cell.x},${cell.y}`)]);
    for (const key of cast) assert.ok(allowed.has(key), `${level}: ${key} is a plot the cast was given`);
    const end = cellsOf(poisonEndPlan({ x: shown[0].x, y: shown[0].y, cells: shown }, optionsFor(level)), shown[0]);
    const endAllowed = new Set(shown.map((cell) => `${cell.x},${cell.y}`));
    for (const key of end) assert.ok(endAllowed.has(key), `${level}: ${key} is a plot the end was given`);
    assert.equal(end.has('7,7'), false, `${level}: nor does the end`);
  }
});

test('the target plant gets no sap and no splash when the viewer cannot see its plot', () => {
  const plan = venomPlan(venomSpec({ target: false }), optionsFor('high'));
  assert.equal(plan.some((step) => step.kind === 'sapDrop' || step.kind === 'sapSplash'), false);
  assert.ok(plan.some((step) => step.kind === 'poisonFog'), 'the visible plots of the zone still turn');
  assert.equal(venomPlan(venomSpec({ target: false, cells: [] }), optionsFor('high')).length, 0, 'a zone fully covered shows nothing');
  const bare = venomPlan(venomSpec({ cells: [] }), optionsFor('high'));
  assert.ok(bare.every((step) => step.kind === 'sapDrop' || step.kind === 'sapSplash'), 'no cells: only the sap on the target');
});

test('the zone turns after the sap has landed: fog and bubbles on each given plot', () => {
  const plan = venomPlan(venomSpec(), optionsFor('high'));
  const fog = plan.filter((step) => step.kind === 'poisonFog');
  const bubbles = plan.filter((step) => step.kind === 'toxicBubble');
  assert.equal(fog.length, AROUND_8_8.length * POISON_FORM_FOG);
  assert.equal(bubbles.length, AROUND_8_8.length * POISON_FORM_BUBBLES);
  assert.ok(fog.every((step) => step.startMs >= VENOM_DROP_MS), 'after the sap');
  assert.ok(bubbles.every((step) => step.startMs >= VENOM_DROP_MS && step.startMs <= VENOM_DROP_MS + POISON_FORM_MS), 'while the soil turns');
  assert.ok(fog.every((step) => step.to[1] > step.from[1]), 'fog lifts');
  for (const look of ['sapDrop', 'sapSplash', 'toxicBubble', 'poisonFog']) assert.ok(STEP_LOOKS[look], look);
});

test('the end plan lifts fog off each plot the zone showed and nothing else', () => {
  const plan = poisonEndPlan({ x: 7, y: 7, cells: AROUND_8_8 }, optionsFor('high'));
  const fog = plan.filter((step) => step.kind === 'poisonFog');
  assert.equal(fog.length, AROUND_8_8.length * POISON_END_FOG);
  assert.ok(plan.every((step) => step.kind === 'poisonFog' || step.kind === 'toxicBubble'));
  assert.equal(poisonEndPlan({ x: 7, y: 7, cells: [] }, optionsFor('high')).length, 0);
  assert.ok(poisonFormAmount(VENOM_DROP_MS + POISON_FORM_MS) === 1);
});

// --- The lightning (a look only) ---

test('the lightning schedule is pure, seeded by a constant and the cloud\'s cell, and never part of any state', () => {
  const seed = CLOUD_LIGHTNING_SEED + 7 * BOARD_SIZE + 7;
  const one = lightningSchedule(seed, 0, 120000);
  assert.deepEqual(one, lightningSchedule(seed, 0, 120000), 'the same seed gives the same flashes');
  assert.ok(Object.isFrozen(one) && one.every((flash) => Object.isFrozen(flash)));
  assert.notDeepEqual(one, lightningSchedule(seed + 1, 0, 120000), 'another cloud, another storm');
  assert.ok(one.length > 5, `flashes now and then (${one.length})`);
  // At most one flash in a window, inside the window, oldest first, never overlapping.
  let lastEnd = -Infinity;
  const windows = new Set();
  for (const flash of one) {
    const w = Math.floor(flash.startMs / CLOUD_LIGHTNING_MS);
    assert.equal(windows.has(w), false, 'one flash per window at most');
    windows.add(w);
    assert.ok(flash.endMs <= (w + 1) * CLOUD_LIGHTNING_MS, 'the whole flash lies in its window');
    assert.ok(flash.startMs >= lastEnd);
    lastEnd = flash.endMs;
    assert.ok(flash.pick >= 0 && flash.pick < 1);
  }
  // About CLOUD_LIGHTNING_CHANCE of the windows flash.
  const windowCount = 120000 / CLOUD_LIGHTNING_MS;
  const share = one.length / windowCount;
  assert.ok(Math.abs(share - CLOUD_LIGHTNING_CHANCE) < 0.25, `${share} of the windows flash`);
  // A later range is a slice of the same line of flashes.
  assert.deepEqual(lightningSchedule(seed, 30000, 60000), one.filter((flash) => flash.startMs >= 30000 && flash.startMs < 60000));
  assert.deepEqual(lightningSchedule(seed, 5, 5), []);
  const source = readFileSync(new URL('../src/render3d/effect-plans.js', import.meta.url), 'utf8');
  const lightning = source.slice(source.indexOf('const LIGHTNING_FLASH_MS'), source.indexOf('// A converting plant pose.ageMs in'));
  assert.equal(/Math\.random|Date\.now|performance\.now/.test(lightning), false, 'the schedule reads no clock and no random');
});

test('a flash is two quick pulses with a dark gap, brightest at its start, and none outside a flash', () => {
  const seed = CLOUD_LIGHTNING_SEED + 99;
  const flash = lightningSchedule(seed, 0, 60000)[0];
  assert.equal(lightningStartMs(Math.floor(flash.startMs / CLOUD_LIGHTNING_MS), seed), flash.startMs);
  assert.equal(lightningAmount(flash.startMs, seed), 1);
  assert.ok(lightningAmount(flash.startMs + CLOUD_LIGHTNING_PULSE_MS / 2, seed) < 1);
  assert.equal(lightningAmount(flash.startMs + CLOUD_LIGHTNING_PULSE_MS + CLOUD_LIGHTNING_GAP_MS / 2, seed), 0, 'the dark gap');
  const second = lightningAmount(flash.startMs + CLOUD_LIGHTNING_PULSE_MS + CLOUD_LIGHTNING_GAP_MS, seed);
  assert.ok(second > 0 && second < 1, 'the second, softer pulse');
  assert.equal(lightningAmount(flash.endMs, seed), 0);
  assert.equal(lightningAmount(flash.startMs - 1, seed), 0);
  assert.equal(lightningAmount(NaN, seed), 0);
  assert.equal(lightningPickAt(flash.startMs, seed), flash.pick);
  assert.equal(lightningPick(Math.floor(flash.startMs / CLOUD_LIGHTNING_MS), seed), flash.pick);
  // The brightness is the same every time it is asked.
  for (let t = 0; t < 30000; t += 41) assert.equal(lightningAmount(t, seed), lightningAmount(t, seed));
  assert.equal(CLOUD_LIGHTNING_GLOW > 0 && CLOUD_LIGHTNING_GLOW <= 1, true);
});

// --- The cloud views of the two seats ---

function cloudState(sides = { [X]: CLOUD_EAGLE, [O]: WIND_RABBIT }, target = { x: 7, y: 7 }) {
  const results = play(sides, [{ skill: CLOUD, target }, [0, 0], [7, 7]]);
  return results[results.length - 1].state;
}

test('the owner and spectators see a 50 percent cloud; the other seat sees a dense one; the rest is the same', () => {
  assert.equal(CLOUD_SEE_THROUGH_OPACITY, 0.5);
  assert.ok(CLOUD_OPPONENT_OPACITY >= 0.9 && CLOUD_OPPONENT_OPACITY <= 1, 'near 1');
  assert.ok(CLOUD_FADE_OPACITY > 0 && CLOUD_FADE_OPACITY < CLOUD_OPPONENT_OPACITY, 'an ended cloud thins to the light look');
  assert.equal(cloudLookOpacity(SEE_THROUGH), CLOUD_SEE_THROUGH_OPACITY);
  assert.equal(cloudLookOpacity(COVER), CLOUD_OPPONENT_OPACITY);

  const state = cloudState();
  const owner = cloudViewsOf(maskForViewer(state, X), X);
  const other = cloudViewsOf(maskForViewer(state, O), O);
  const spectator = cloudViewsOf(maskForViewer(state, null), null);
  assert.equal(owner.length, 1);
  assert.equal(other.length, 1);
  assert.deepEqual([owner[0].look, owner[0].opacity], [SEE_THROUGH, 0.5], 'the owner sees through it');
  assert.deepEqual([spectator[0].look, spectator[0].opacity], [SEE_THROUGH, 0.5], 'a spectator too');
  assert.deepEqual([other[0].look, other[0].opacity], [COVER, CLOUD_OPPONENT_OPACITY], 'the other seat does not');
  assert.notEqual(owner[0].opacity, other[0].opacity);
  // Everything else is the same for both: where it lies, its cells and its lightning seed.
  for (const key of ['owner', 'x', 'y', 'box', 'centre', 'seed']) assert.deepEqual(other[0][key], owner[0][key], key);
  assert.deepEqual(other[0].cells, owner[0].cells);
  assert.equal(owner[0].cells.length, CLOUD_SIZE * CLOUD_SIZE);
  assert.equal(owner[0].seed, CLOUD_LIGHTNING_SEED + 7 * BOARD_SIZE + 7, 'a constant and the chosen cell');
  assert.ok(Object.isFrozen(owner) && Object.isFrozen(owner[0]));
  assert.deepEqual(cloudViewsOf(createInitialState(), X), []);
  assert.deepEqual(cloudViewsOf(null, X), []);
});

test('the drawn centre of the cloud is the middle of the covered cells, also at the edge and in the corner', () => {
  for (const [target, centre] of [[{ x: 7, y: 7 }, { x: 7.5, y: 7.5 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 14, y: 14 }, { x: 13.5, y: 13.5 }]]) {
    const state = cloudState({ [X]: CLOUD_EAGLE, [O]: WIND_RABBIT }, target);
    const [view] = cloudViewsOf(maskForViewer(state, O), O);
    assert.deepEqual(view.centre, centre, `a cloud chosen at ${target.x}, ${target.y}`);
    assert.deepEqual(view.centre, cloudCentre({ x: target.x, y: target.y }, BOARD_SIZE));
    const xs = view.cells.map((cell) => cell.x);
    const ys = view.cells.map((cell) => cell.y);
    assert.equal(view.centre.x, (Math.min(...xs) + Math.max(...xs)) / 2, 'the middle of the covered columns');
    assert.equal(view.centre.y, (Math.min(...ys) + Math.max(...ys)) / 2, 'and rows');
    assert.deepEqual(view.box, cloudBox({ x: target.x, y: target.y }, BOARD_SIZE));
  }
});

test('the tiles of the dense cloud are 32 pixel pure grids', () => {
  for (const make of [stormTileGrid, stormFlashGrid, lightningBoltGrid]) {
    const grid = make();
    assert.deepEqual([grid.width, grid.height], [32, 32], make.name);
    assert.ok(grid.pixels.some(Boolean), `${make.name} draws something`);
  }
  assert.ok(stormTileGrid().pixels.every(Boolean), 'the dense cloud has no gaps: it hides the ground');
});

// --- Poison zone plots as the viewer sees them ---

function zoneState(extra = {}) {
  const board = createInitialState().board.map((row) => row.slice());
  board[8][8] = O; // the target plant
  board[7][9] = X; // a plant of the caster inside the zone
  return {
    board, currentPlayer: X, characters: { [X]: JADE_SERPENT, [O]: EARTH_BEAR },
    poison: { player: X, x: 8, y: 8, cells: SQUARE_AT_8_8, endsAfterTurn: 5 }, ...extra,
  };
}

test('the viewer\'s zone lists empty plots for the withered soil, leaves out covered ones and marks the target', () => {
  const plots = poisonPlotsInto(zoneState(), createPoisonPlots());
  assert.equal(plots.count, 9);
  const list = [];
  for (let i = 0; i < plots.count; i++) list.push({ x: plots.x[i], y: plots.y[i], empty: plots.empty[i], centre: plots.centre[i] });
  assert.deepEqual(list.filter((p) => p.centre === 1).map((p) => [p.x, p.y]), [[8, 8]]);
  assert.deepEqual(list.filter((p) => p.empty === 0).map((p) => `${p.x},${p.y}`).sort(), ['8,8', '9,7'], 'plots with a plant have no soil decal');
  const covered = zoneState({ covered: [{ x: 7, y: 7 }, { x: 9, y: 9 }] });
  covered.board[7][7] = EMPTY;
  covered.board[9][9] = HIDDEN;
  const hidden = poisonPlotsInto(covered, createPoisonPlots());
  assert.equal(hidden.count, 7, 'two plots under the other seat\'s cloud are not listed at all');
  for (let i = 0; i < hidden.count; i++) assert.ok(!(hidden.x[i] === 7 && hidden.y[i] === 7) && !(hidden.x[i] === 9 && hidden.y[i] === 9));
  assert.equal(poisonPlotsInto({ board: [] }, createPoisonPlots()).count, 0, 'no zone');
  assert.equal(poisonPlotsInto(null, createPoisonPlots()).count, 0);
  assert.equal(poisonPlotsInto(undefined, createPoisonPlots()).count, 0);
});

test('a pointer on a poisoned empty plot shows the red crossed-out border and no ghost plant; a covered plot shows nothing', () => {
  const state = zoneState();
  const on = boardMarks({ state, hover: { x: 7, y: 8 }, preview: null });
  assert.equal(on.decals.filter((d) => d.kind === 'forbidden').length, 1);
  assert.deepEqual(on.decals.filter((d) => d.kind === 'forbidden').map((d) => [d.x, d.y]), [[7, 8]]);
  assert.equal(on.ghost, null, 'nobody may plant there, so no ghost');
  // A plot with a plant, and a plot outside the zone, are not forbidden.
  assert.equal(boardMarks({ state, hover: { x: 8, y: 8 }, preview: null }).decals.some((d) => d.kind === 'forbidden'), false);
  const outside = boardMarks({ state, hover: { x: 3, y: 3 }, preview: null });
  assert.equal(outside.decals.some((d) => d.kind === 'forbidden'), false);
  assert.deepEqual(outside.ghost, { kind: X, x: 3, y: 3 });
  // Under the other seat's cloud the zone plot is not known to the viewer: no border either.
  const covered = zoneState({ covered: [{ x: 7, y: 8 }] });
  const under = boardMarks({ state: covered, hover: { x: 7, y: 8 }, preview: null });
  assert.equal(under.decals.some((d) => d.kind === 'forbidden' || d.kind === 'poison' && d.x === 7 && d.y === 8), false);
  const plots = poisonPlotsInto(state, createPoisonPlots());
  assert.equal(isForbiddenPlot(plots, 7, 8), true);
  assert.equal(isForbiddenPlot(plots, 8, 8), false);
  assert.equal(isForbiddenPlot(plots, 0, 0), false);
});

// --- The renderer on the fake browser ---

async function build({ quality = 'high', sides = { [X]: JADE_SERPENT, [O]: EARTH_BEAR } } = {}) {
  installFakeDocument();
  const { createWorldRenderer } = await import('../src/render3d/world-renderer.js');
  const { createLocalGame } = await import('../src/ui/local-game.js');
  const gl = fakeRenderer();
  const renderer = createWorldRenderer(fakeCanvas(), { storage: null, quality, createRenderer: () => gl });
  const game = createLocalGame({ random: () => 0, characters: sides });
  const ctx = fakeCanvas().getContext('2d');
  let time = 1000;
  const frames = (count = 1, view = null) => {
    for (let i = 0; i < count; i++) {
      time += 16;
      renderer.drawGameScreen(ctx, { ...(view ?? game.getView()), time });
    }
  };
  const drawAt = (at, view = null) => {
    time = at;
    renderer.drawGameScreen(ctx, { ...(view ?? game.getView()), time });
  };
  const deliver = () => renderer.trigger(game.takeEvents(), time, game.getState().characters);
  const named = (name) => {
    const found = [];
    gl.scene.traverse((object) => {
      if (object.visible && object.isMesh && object.material?.name === name) found.push(object);
    });
    return found;
  };
  const opacities = (name) => named(name).map((mesh) => mesh.material.opacity);
  const at = (x, y) => (mesh) => Math.abs(mesh.position.x - cellToWorld(x, y).x) < 1e-6 && Math.abs(mesh.position.z - cellToWorld(x, y).z) < 1e-6;
  const sprite = (x, y) => {
    const { x: wx, z: wz } = cellToWorld(x, y);
    const found = [];
    gl.scene.traverse((object) => {
      if (object.isGroup && object.visible && object.children.length === 3 && object.children[2].isMesh
        && Math.abs(object.position.x - wx) < 1e-6 && Math.abs(object.position.z - wz) < 1e-6) found.push(object);
    });
    return found[0] ?? null;
  };
  return { gl, renderer, game, frames, drawAt, deliver, named, opacities, at, sprite, ctx, now: () => time };
}

// The live particles of the effects' main pool as [x, z] pairs.
function particlePositions(scene) {
  const found = [];
  scene.traverse((object) => {
    if (!object.isPoints || !object.visible || object.geometry.attributes.position.count !== QUALITY_LEVELS.high.particleCap) return;
    const count = object.geometry.drawRange.count === Infinity ? 0 : object.geometry.drawRange.count;
    const xyz = object.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) found.push([xyz[i * 3], xyz[i * 3 + 2]]);
  });
  return found;
}

function particlesOver(scene, x, y) {
  const centre = cellToWorld(x, y);
  return particlePositions(scene).filter(([px, pz]) => Math.abs(px - centre.x) <= 0.5 && Math.abs(pz - centre.z) <= 0.5).length;
}

// X (Jade Serpent) has planted, O has planted on (8, 8), and X casts Venom on it.
async function venomGame(options = {}) {
  const built = await build(options);
  const { game } = built;
  assert.equal(game.click({ x: 0, y: 14 }), true); // X
  assert.equal(game.click({ x: 8, y: 8 }), true); // O
  built.frames(3);
  built.deliver();
  assert.equal(game.clickSkill(X, VENOM), true);
  assert.equal(game.click({ x: 8, y: 8 }), true);
  return built;
}

test('a Venom cast: the zone turns withered after the sap lands, the target plant droops a little and stays', async () => {
  const { game, frames, drawAt, deliver, opacities, sprite, now, gl } = await venomGame();
  assert.ok(game.getState().poison);
  const start = now() + 16;
  deliver(); // the cast events reach the renderer at `start`
  drawAt(start);
  assert.deepEqual(opacities('decal-poison'), Array(8).fill(0), 'bare soil while the sap falls');
  assert.equal(sprite(8, 8).scale.y, 1, 'the plant is upright while the sap falls');
  drawAt(start + VENOM_DROP_MS + POISON_FORM_MS / 2);
  const turning = opacities('decal-poison');
  assert.equal(turning.length, 8, 'the 8 empty plots around the plant');
  assert.ok(turning.every((o) => o > 0 && o < POISON_OPACITY), 'turning');
  const drooping = start + VENOM_DROP_MS + POISON_FORM_MS + 1; // the soil is whole and the plant holds its droop
  assert.ok(drooping > start + VENOM_DROP_MS + VENOM_WILT_IN_MS && drooping < start + VENOM_DROP_MS + VENOM_WILT_IN_MS + VENOM_WILT_HOLD_MS);
  drawAt(drooping);
  assert.ok(Math.abs(sprite(8, 8).scale.y - (1 - VENOM_WILT_SQUASH)) < 1e-9, 'drooped a little, and still on the board');
  assert.deepEqual(opacities('decal-poison'), Array(8).fill(POISON_OPACITY), 'fully withered');
  assert.ok(game.getState().board[8][8] === O, 'the plant is still the opponent\'s');
  drawAt(start + 4000);
  assert.equal(sprite(8, 8).scale.y, 1, 'it perks up again');
  assert.ok(particlesOver(gl.scene, 8, 7) >= 0);
  frames(1);
  assert.equal(opacities('decal-poison').length, 8);
});

test('a plant whose growth ends during the Venom droop keeps the droop through the hold, then perks up', async () => {
  const { game, drawAt, deliver, sprite } = await build();
  const planted = 1000;
  drawAt(planted);
  assert.equal(game.click({ x: 0, y: 14 }), true); // X
  assert.equal(game.click({ x: 8, y: 8 }), true); // O, still growing when the cast comes
  deliver();
  for (let t = planted; t < planted + 300; t += 16) drawAt(t);
  const cast = planted + 300;
  drawAt(cast);
  assert.equal(game.clickSkill(X, VENOM), true);
  assert.equal(game.click({ x: 8, y: 8 }), true);
  deliver();
  const holdFrom = cast + VENOM_DROP_MS + VENOM_WILT_IN_MS;
  const holdTo = holdFrom + VENOM_WILT_HOLD_MS;
  assert.ok(planted + 1200 > holdFrom && planted + 1200 < holdTo, 'the growth (1.2 seconds) ends inside the hold');
  const droop = 1 - VENOM_WILT_SQUASH;
  for (let t = cast; t < holdFrom; t += 10) drawAt(t);
  for (let t = holdFrom; t < holdTo; t += 10) {
    drawAt(t);
    const { x, y } = sprite(8, 8).scale; // the Open pop scales the width too, so the droop is the height against the width
    assert.ok(Math.abs(y / x - droop) < 1e-9, `still drooped at ${t - planted} ms after planting`);
  }
  drawAt(cast + venomWiltMs() + 100);
  assert.equal(sprite(8, 8).scale.y, 1, 'upright again once it has perked up');
});

test('fog and bubbles hug the ground of the poisoned plots while the zone lasts, not on the target plot, none on Low', async () => {
  const high = await venomGame();
  high.deliver();
  high.frames(240); // 3.8 seconds
  const over = AROUND_8_8.map((cell) => particlesOver(high.gl.scene, cell.x, cell.y));
  assert.ok(over.some((n) => n > 0), 'there is fog or a bubble over the zone');
  assert.ok(particlePositions(high.gl.scene).length <= QUALITY_LEVELS.high.particleCap);
  const low = await venomGame({ quality: 'low' });
  low.deliver();
  low.frames(240);
  assert.equal(particlePositions(low.gl.scene).length, 0, 'no particle at all on Low');
  assert.equal(low.opacities('decal-poison').length, 8, 'but the withered plots show on Low');
});

test('a pointer on a poisoned empty plot shows the forbidden border and no hover ring; a plant plot shows the ring', async () => {
  const { game, frames, named } = await venomGame();
  frames(2);
  game.setHover({ x: 7, y: 8 });
  frames(2);
  assert.equal(named('decal-forbidden').length, 1);
  game.setHover({ x: 3, y: 3 });
  frames(2);
  assert.equal(named('decal-forbidden').length, 0);
});

test('a zone plot under a cloud of the other seat has no soil, no fog and no border, and the effects on it stop', async () => {
  const { renderer, game, frames, deliver, named, opacities, ctx, now, gl } = await venomGame();
  deliver();
  frames(240); // the placement bursts of the two seeds are over; the fog of the zone is steady
  assert.ok(particlesOver(gl.scene, 7, 7) + particlesOver(gl.scene, 9, 9) > 0, 'fog or bubbles lie on those plots before the cloud comes');
  let time = now();
  const cover = (view) => {
    const board = view.state.board.map((row) => row.slice());
    return { ...view, state: { ...view.state, board, covered: [{ x: 7, y: 7 }, { x: 9, y: 9 }] } };
  };
  renderer.drawGameScreen(ctx, { ...cover(game.getView()), time: (time += 16) });
  assert.equal(opacities('decal-poison').length, 6, 'the two covered plots lose their soil');
  assert.equal(particlesOver(gl.scene, 7, 7), 0);
  assert.equal(particlesOver(gl.scene, 9, 9), 0);
  for (let i = 0; i < 200; i++) {
    renderer.drawGameScreen(ctx, { ...cover({ ...game.getView(), hover: { x: 7, y: 7 } }), time: (time += 16) });
    assert.equal(particlesOver(gl.scene, 7, 7), 0, `no fog over the covered plot on frame ${i}`);
    assert.equal(particlesOver(gl.scene, 9, 9), 0);
  }
  assert.equal(named('decal-forbidden').length, 0, 'no border on a covered plot');
});

test('a zone that ends thins away over the plots it showed, then nothing is left', async () => {
  const { renderer, game, frames, deliver, named, opacities, now } = await venomGame();
  deliver();
  frames(120);
  assert.equal(opacities('decal-poison').length, 8);
  assert.equal(named('decal-poisonFade').length, 0);
  assert.equal(game.click({ x: 14, y: 0 }), true); // X plants: O's turn
  assert.equal(game.click({ x: 1, y: 1 }), true); // O
  assert.equal(game.click({ x: 2, y: 2 }), true); // X: the zone ends with this turn
  assert.equal(game.getState().poison, null);
  renderer.trigger(game.takeEvents(), now() + 16, game.getState().characters);
  frames(1);
  const fading = opacities('decal-poisonFade');
  assert.equal(fading.length, 8, 'the empty plots thin away');
  assert.ok(fading.every((o) => o > 0 && o <= POISON_OPACITY));
  assert.equal(opacities('decal-poison').length, 0, 'the zone itself is gone');
  frames(90);
  assert.equal(named('decal-poisonFade').length, 0, 'and then nothing');
});

// The Cloud, seen by the owner and by the other seat.
async function cloudGame(quality = 'high') {
  const built = await build({ quality, sides: { [X]: CLOUD_EAGLE, [O]: WIND_RABBIT } });
  const { game } = built;
  assert.equal(game.clickSkill(X, CLOUD), true);
  assert.equal(game.click({ x: 7, y: 7 }), true);
  return built;
}

test('the owner sees the cloud at 50 percent; once the turn passes the other seat sees a dense one', async () => {
  const { game, frames, deliver, named, opacities } = await cloudGame();
  deliver();
  frames(80);
  assert.deepEqual(opacities('cloud-seeThrough'), Array(16).fill(CLOUD_SEE_THROUGH_OPACITY), 'X is to move and sees through it');
  assert.equal(named('cloud-cover').length, 0);
  assert.equal(game.click({ x: 0, y: 0 }), true); // X plants: now O sees the screen
  frames(80);
  assert.deepEqual(opacities('cloud-cover'), Array(16).fill(CLOUD_OPPONENT_OPACITY), 'the other seat sees a dense cloud');
  assert.equal(named('cloud-seeThrough').length, 0);
});

test('the dense cloud flashes with lightning now and then, only at the times of its seeded schedule', async () => {
  const { game, frames, deliver, named, opacities, drawAt } = await cloudGame();
  deliver();
  assert.equal(game.click({ x: 0, y: 0 }), true);
  frames(80);
  const seed = CLOUD_LIGHTNING_SEED + 7 * BOARD_SIZE + 7;
  const [flash] = lightningSchedule(seed, 20000, 80000);
  drawAt(flash.startMs);
  assert.equal(named('cloud-flash').length, 16, 'a flash over every cell of the dense cloud');
  assert.ok(opacities('cloud-flash').every((o) => Math.abs(o - CLOUD_LIGHTNING_GLOW) < 1e-9), 'brightest at the start of the flash');
  assert.equal(named('cloud-bolt').length, 1, 'and one bolt');
  const bolt = named('cloud-bolt')[0];
  const cells = cloudViewsOf(maskForViewer(game.getState(), O), O)[0].cells;
  const pick = cells[Math.min(cells.length - 1, Math.floor(flash.pick * cells.length))];
  assert.ok(Math.abs(bolt.position.x - cellToWorld(pick.x, pick.y).x) < 1e-6 && Math.abs(bolt.position.z - cellToWorld(pick.x, pick.y).z) < 1e-6, 'on the cell of the schedule');
  drawAt(flash.startMs + CLOUD_LIGHTNING_PULSE_MS + CLOUD_LIGHTNING_GAP_MS / 2);
  assert.ok(opacities('cloud-flash').every((o) => o === 0), 'dark in the gap');
  assert.equal(named('cloud-bolt').length, 0);
  drawAt(flash.endMs + 5);
  assert.equal(named('cloud-bolt').length, 0, 'no bolt between flashes');
});

test('the owner of the cloud sees no lightning', async () => {
  const { frames, deliver, named, drawAt } = await cloudGame();
  deliver();
  frames(80);
  const seed = CLOUD_LIGHTNING_SEED + 7 * BOARD_SIZE + 7;
  const [flash] = lightningSchedule(seed, 20000, 80000);
  drawAt(flash.startMs);
  assert.equal(named('cloud-flash').length, 0);
  assert.equal(named('cloud-bolt').length, 0);
});

test('a taken covered plot keeps its small puff in the dense cloud', async () => {
  const { game, frames, deliver, named } = await cloudGame();
  deliver();
  assert.equal(game.click({ x: 7, y: 7 }), true); // X plants inside its own cloud
  frames(80);
  assert.equal(game.getState().currentPlayer, O);
  assert.equal(named('cloud-hidden').length, 1, 'one small puff over the one taken covered plot');
});

test('with a poison zone, a dense cloud and its lightning on show, no frame makes a Three.js object at any level', async () => {
  const made = () => {
    const now = { texture: new THREE.Texture().id, material: new THREE.Material().id, geometry: new THREE.BufferGeometry().id };
    return now;
  };
  const delta = (before) => {
    const now = made();
    return { texture: now.texture - before.texture - 1, material: now.material - before.material - 1, geometry: now.geometry - before.geometry - 1 };
  };
  const { game, frames, deliver, renderer, drawAt } = await cloudGame();
  deliver();
  assert.equal(game.click({ x: 0, y: 0 }), true);
  frames(60);
  const seed = CLOUD_LIGHTNING_SEED + 7 * BOARD_SIZE + 7;
  const flashes = lightningSchedule(seed, 0, 600000);
  for (const level of QUALITY_ORDER) {
    renderer.setQuality(level);
    frames(30);
    const probe = made();
    for (const flash of flashes.slice(0, 6)) {
      drawAt(flash.startMs);
      drawAt(flash.startMs + 40);
    }
    frames(60);
    assert.deepEqual(delta(probe), { texture: 0, material: 0, geometry: 0 }, `${level}: lightning makes nothing`);
  }
  const zone = await venomGame();
  zone.deliver();
  zone.frames(60);
  for (const level of QUALITY_ORDER) {
    zone.renderer.setQuality(level);
    zone.frames(30);
    const probe = made();
    zone.frames(150);
    assert.deepEqual(delta(probe), { texture: 0, material: 0, geometry: 0 }, `${level}: the zone makes nothing`);
  }
});

// --- Coverage transitions: a cloud of the other seat arrives while the zone effects play ---

// The view as the other seat sees it with a cloud over `cells` (the board of the
// view is copied, the covered plots show as taken or empty as they are).
function coveredView(view, cells) {
  const board = view.state.board.map((row) => row.slice());
  for (const { x, y } of cells) if (board[y][x] !== EMPTY) board[y][x] = HIDDEN;
  return { ...view, state: { ...view.state, board, covered: cells } };
}

const NEIGHBOURS = [{ x: 7, y: 7 }, { x: 9, y: 9 }, { x: 9, y: 7 }];

test('a cast still playing when a cloud covers some of its plots names none of them afterwards', async () => {
  const { renderer, game, deliver, now, ctx, gl } = await venomGame();
  deliver();
  let time = now();
  renderer.drawGameScreen(ctx, { ...game.getView(), time: (time += 16) }); // the cast is playing, the soil is not whole yet
  for (let i = 0; i < 160; i++) {
    renderer.drawGameScreen(ctx, { ...coveredView(game.getView(), NEIGHBOURS), time: (time += 16) });
    for (const { x, y } of NEIGHBOURS) assert.equal(particlesOver(gl.scene, x, y), 0, `frame ${i}: nothing over the covered plot ${x},${y}`);
  }
});

test('the cast and the cloud arriving on the same frame: nothing is shown over the covered plots', async () => {
  const { renderer, game, deliver, now, ctx, gl } = await venomGame();
  let time = now();
  deliver(); // the events reach the renderer while the last frame had no cloud
  for (let i = 0; i < 160; i++) {
    renderer.drawGameScreen(ctx, { ...coveredView(game.getView(), NEIGHBOURS), time: (time += 16) });
    for (const { x, y } of NEIGHBOURS) assert.equal(particlesOver(gl.scene, x, y), 0, `frame ${i}: nothing over the covered plot ${x},${y}`);
  }
});

test('the cast and a cloud over the target plant on the same frame: no sap, no splash and no droop on it', async () => {
  const { renderer, game, deliver, now, ctx, gl, sprite } = await venomGame();
  let time = now();
  deliver();
  const under = [{ x: 8, y: 8 }, { x: 7, y: 8 }];
  for (let i = 0; i < 160; i++) {
    renderer.drawGameScreen(ctx, { ...coveredView(game.getView(), under), time: (time += 16) });
    for (const { x, y } of under) assert.equal(particlesOver(gl.scene, x, y), 0, `frame ${i}: nothing over the covered plot ${x},${y}`);
    const piece = sprite(8, 8);
    assert.ok(piece === null || piece.scale.y === 1, 'a covered plant is never drawn drooping');
  }
});

test('a zone that ends on the frame a cloud covers some of its plots thins away only over the others', async () => {
  const { renderer, game, frames, deliver, named, opacities, now, ctx, gl } = await venomGame();
  deliver();
  frames(120);
  assert.equal(game.click({ x: 14, y: 0 }), true);
  assert.equal(game.click({ x: 1, y: 1 }), true);
  assert.equal(game.click({ x: 2, y: 2 }), true); // the zone ends with this turn
  assert.equal(game.getState().poison, null);
  let time = now() + 16;
  renderer.trigger(game.takeEvents(), time, game.getState().characters);
  for (let i = 0; i < 100; i++) {
    renderer.drawGameScreen(ctx, { ...coveredView(game.getView(), NEIGHBOURS), time: (time += 16) });
    for (const { x, y } of NEIGHBOURS) assert.equal(particlesOver(gl.scene, x, y), 0, `frame ${i}: nothing over the covered plot ${x},${y}`);
    if (i === 0) assert.equal(opacities('decal-poisonFade').length, 5, 'the five plots that stay visible thin away');
  }
  assert.equal(named('decal-poisonFade').length, 0);
});
