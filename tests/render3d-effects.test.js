import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_DISTANCE, CAMERA_FOV, CONVERT_SPARK_MS, DASH_LIFT, DASH_STREAK_MS, PLANT_DROP_PX, REVERSE_GROWTH_SPEED,
  SHAKE3D_HEAVY, SHAKE3D_LIGHT, SHAKE3D_MS, THROW_ARC_HEIGHT, THROW_DELAY_MS, THROW_MS,
} from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { PETRIFICATION, MUD_TRAP, TORNADO_ZONE, WIND_DASH } from '../src/logic/skills.js';
import { bannerTexts } from '../src/render/effects.js';
import {
  convertMs, convertPose, convertWiltMs, dashCurveInto, dashFoldMs, dashPose, heldCell, petrifyMs, regrowCell,
  reverseGrowthInto, reverseGrowthMs, shakeLeft, shakeOffset3d, shakeStrength, snapToStep,
  SPARK_REACH, sparkPathInto, throwPose, visualsForEvents, worldUnitsPerPixel,
} from '../src/render3d/effect-plans.js';
import { growthStage, STAGE_DROP, STAGE_LAND, STAGE_OPEN, STAGE_REST, STAGE_SPROUT } from '../src/render3d/growth.js';
import { DEFAULT_V3_META, stageStartMs } from '../src/render3d/v3-meta.js';
import { bendRowPx, bendTowardPx } from '../src/render3d/wind.js';
import {
  createParticlePool, createSpawnParams, emit, FLOOR_Y, scaledCount, SHAPE_PLUS, SHAPE_SQUARE,
} from '../src/render3d/particle-pool.js';
import { particleScale, plainSlides, QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import { effectRandom } from '../src/render3d/seeded-random.js';

function ok(result) {
  assert.equal(result.ok, true, result.error);
  return result;
}

const kinds = (specs) => specs.map((spec) => spec.kind);
const STAGES = stageStartMs(DEFAULT_V3_META, 'plant-x'); // [0, 150, 450, 850, 1200]

// Plays moves from the start; each move is [x, y] for a stone or
// { skill, target } for a skill. A skill does not end the turn (Free
// Action), so the same player plants next. Returns the results.
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

test('a planted seed is a place visual on its cell and never shakes the camera', () => {
  const [placed] = play([[3, 4]]);
  assert.deepEqual(visualsForEvents(placed.events), [{ kind: 'place', x: 3, y: 4, player: X }]);
  assert.equal(shakeStrength({ kind: 'place' }), 0);
});

test('only a plant shattering into a rock shakes the camera, and only lightly', () => {
  // Changed with Free Action part 7: the old rockFall spec (and the rockCrumble
  // one, which no event starts any more) is the petrify spec of the new effect.
  for (const kind of ['place', 'dashStreak', 'throw', 'convert', 'mudForm', 'seedSink', 'seedSurface', 'mudDry', 'dashMark', 'banner']) {
    assert.equal(shakeStrength({ kind }), 0, kind);
  }
  assert.equal(shakeStrength({ kind: 'petrify' }), SHAKE3D_LIGHT);
});

test('Wind Dash: the announcement marks source and target, then the seed rides a gust across', () => {
  const results = play([
    [7, 7], [0, 0],
    { skill: WIND_DASH, target: { from: { x: 7, y: 7 }, to: { x: 9, y: 9 } } },
    [13, 13], // the rabbit plants, which ends its turn
    [14, 14], // the bear's turn ends and the dash resolves
  ]);
  const announced = visualsForEvents(results[2].events);
  assert.deepEqual(kinds(announced), ['castRing', 'dashMark', 'banner']);
  assert.deepEqual(announced[0], { kind: 'castRing', x: 7, y: 7, player: X }, 'the cast ring spreads from the source plant');
  assert.deepEqual(announced[1], { kind: 'dashMark', from: { x: 7, y: 7 }, to: { x: 9, y: 9 }, player: X });
  assert.equal(announced[2].text, 'Wind Dash!');

  const resolved = visualsForEvents(results[4].events);
  assert.deepEqual(kinds(resolved), ['place', 'dashStreak', 'banner']);
  assert.deepEqual(resolved[1], { kind: 'dashStreak', from: { x: 7, y: 7 }, to: { x: 9, y: 9 }, player: X });
  const holdMs = dashFoldMs(STAGES) + DASH_STREAK_MS;
  assert.deepEqual(heldCell(resolved[1], STAGES), { x: 9, y: 9, ms: holdMs });
  assert.deepEqual(regrowCell(resolved[1], STAGES), { x: 9, y: 9, player: X, startMs: holdMs - STAGES[STAGE_LAND] },
    'the plant regrows at the target from Land as the seed arrives');
});

test('a failed Wind Dash fizzles and ends the marks', () => {
  const results = play([
    [7, 7], [0, 0],
    { skill: WIND_DASH, target: { from: { x: 7, y: 7 }, to: { x: 9, y: 9 } } },
    [13, 13], // the rabbit plants, which ends its turn
    [9, 9], // the bear takes the target
  ]);
  const specs = visualsForEvents(results[4].events);
  assert.deepEqual(kinds(specs), ['place', 'dashFizzle', 'banner']);
  assert.deepEqual(specs[1], { kind: 'dashFizzle', from: { x: 7, y: 7 }, to: { x: 9, y: 9 } });
  assert.equal(heldCell(specs[1], STAGES), null);
  assert.equal(regrowCell(specs[1], STAGES), null);
});

test('Tornado Zone: the caster sees the cross; a seed planted on it reveals a whirlwind and is spun up and thrown to a neighbour plot in an arc', () => {
  const results = play([
    { skill: TORNADO_ZONE, target: { x: 7, y: 7 } },
    [14, 14], // the rabbit plants, which ends its turn
    [7, 7], // the bear plants on the cross; random 0 throws it to the first free neighbour, (6, 6)
  ], { random: () => 0 });
  const announced = visualsForEvents(results[0].events);
  // Changed with the Free Action rework (part 1): a secret zone plays no cast
  // ring, whose twinkles would still be round the secret centre when the turn
  // passes to the other seat; the swirl alone shows it and follows the state.
  assert.equal(kinds(announced).includes('castRing'), false, 'no cast ring at the secret centre');
  assert.equal(announced[0].kind, 'tornado');
  assert.equal(announced[0].cells.length, 5, 'the cross');

  const thrown = visualsForEvents(results[2].events);
  // The fired trap is used up at once: no tornadoEnded event, no tornadoEnd spec.
  assert.deepEqual(kinds(thrown), ['place', 'storm', 'throw', 'banner']);
  assert.deepEqual(thrown[1], { kind: 'storm', x: 7, y: 7, cells: [{ x: 7, y: 6 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 7, y: 8 }] });
  assert.deepEqual(thrown[2], { kind: 'throw', from: { x: 7, y: 7 }, to: { x: 6, y: 6 }, player: O });
  assert.deepEqual(heldCell(thrown[2], STAGES), { x: 6, y: 6, ms: THROW_DELAY_MS + THROW_MS });
  assert.deepEqual(regrowCell(thrown[2], STAGES), { x: 6, y: 6, player: O, startMs: THROW_DELAY_MS + THROW_MS - STAGES[STAGE_LAND] });
  assert.equal(shakeStrength(thrown[2]), 0);
});

test('Petrification: earth energy wraps the plant, it shatters into a rock with a light shake, and nothing ever crumbles', () => {
  const results = play([
    [7, 7],
    { skill: PETRIFICATION, target: { x: 7, y: 7 } },
    [14, 14], // the bear plants, which ends the turn the plant was turned to stone in
    [1, 0], [2, 0], [3, 0], [4, 5], [5, 0], [6, 5],
  ]);
  const fell = visualsForEvents(results[1].events);
  assert.deepEqual(kinds(fell), ['castRing', 'petrify', 'banner']);
  assert.deepEqual(fell[1], { kind: 'petrify', x: 7, y: 7, player: O, from: X }, 'the plant of the other side turns to stone');
  assert.equal(heldCell(fell[0], STAGES), null, 'a cast ring holds nothing');
  assert.deepEqual(heldCell(fell[1], STAGES), { x: 7, y: 7, ms: petrifyMs() }, 'the real rock stays hidden while the plant becomes it');
  assert.equal(regrowCell(fell[1], STAGES), null, 'a rock does not grow');
  assert.equal(shakeStrength(fell[1]), SHAKE3D_LIGHT);

  for (const result of results.slice(2)) {
    const later = kinds(visualsForEvents(result.events));
    assert.ok(!later.includes('petrify') && !later.includes('rockCrumble'), 'rocks are permanent: nothing breaks later');
  }
});

test('Mud Trap: the puddle forms, a seed sinks into it and surfaces; none of it holds a plant hidden', () => {
  // Changed with Free Action part 7: the events mudPlaced, stoneSunk and
  // stoneSurfaced used to plan nothing (the state alone drew the puddle).
  const results = play([
    [0, 0],
    { skill: MUD_TRAP, target: { x: 7, y: 7 } },
    [14, 14],
    [7, 7], // X plants into the puddle: the seed sinks
    [1, 1], // the end of the next turn: the seed surfaces
  ]);
  assert.deepEqual(kinds(visualsForEvents(results[1].events)), ['castRing', 'mudForm', 'banner'], 'the cast ring, the puddle and the name');
  assert.deepEqual(visualsForEvents(results[1].events)[1], { kind: 'mudForm', x: 7, y: 7, player: O });
  assert.deepEqual(results[3].events.map((e) => e.type), ['stonePlaced', 'stoneSunk', 'turnEnded']);
  assert.deepEqual(kinds(visualsForEvents(results[3].events)), ['place', 'seedSink']);
  assert.deepEqual(visualsForEvents(results[3].events)[1], { kind: 'seedSink', x: 7, y: 7, player: X });
  assert.deepEqual(results[4].events.map((e) => e.type), ['stonePlaced', 'stoneSurfaced', 'turnEnded']);
  assert.deepEqual(kinds(visualsForEvents(results[4].events)), ['place', 'seedSurface']);
  assert.deepEqual(visualsForEvents(results[4].events)[1], { kind: 'seedSurface', x: 7, y: 7, player: X });
  for (const result of results) for (const spec of visualsForEvents(result.events)) assert.equal(heldCell(spec, STAGES), null, spec.kind);
});

test('a win ends the lingering marks, since it drops a pending dash and the zone without events', () => {
  const results = play([
    [0, 0], [0, 5], [1, 0], [1, 5], [2, 0], [2, 5], [3, 0],
    { skill: MUD_TRAP, target: { x: 10, y: 10 } },
    [14, 14],
    { skill: TORNADO_ZONE, target: { x: 12, y: 12 } },
    [14, 0],
    [9, 9],
    [4, 0], // five in a row
  ]);
  const specs = visualsForEvents(results.at(-1).events);
  assert.deepEqual(kinds(specs), ['place', 'winBloom', 'endLingering']);
  assert.deepEqual(specs[1].line.length, 5, 'every winning plant celebrates');
  assert.equal(specs[1].player, X);
  assert.ok(kinds(visualsForEvents([{ type: 'draw' }])).includes('endLingering'));
});

test('skill banners in 3D use the same texts as the 2D game', () => {
  const results = play([
    [7, 7],
    { skill: MUD_TRAP, target: { x: 3, y: 3 } },
    [14, 14],
    { skill: TORNADO_ZONE, target: { x: 10, y: 10 } },
    [13, 0],
    { skill: PETRIFICATION, target: { x: 7, y: 7 } },
  ]);
  for (const result of results) {
    const texts = visualsForEvents(result.events).filter((s) => s.kind === 'banner').map((s) => s.text);
    assert.deepEqual(texts, bannerTexts(result.events));
  }
  assert.deepEqual(bannerTexts(results[1].events), ['Mud Trap!']);
});

test('planning visuals never changes the events', () => {
  const results = play([[7, 7], { skill: PETRIFICATION, target: { x: 7, y: 7 } }]);
  for (const result of results) {
    const copy = structuredClone(result.events);
    visualsForEvents(deepFreeze(result.events));
    assert.deepEqual(result.events, copy);
  }
  assert.deepEqual(visualsForEvents([]), []);
  assert.deepEqual(visualsForEvents([{ type: 'turnEnded', player: X, turn: 0 }, { type: 'skillUsed', player: X, skill: 'nope' }]), []);
});

test('only pieces that arrive by flying are held hidden', () => {
  for (const kind of ['place', 'dashMark', 'dashFizzle', 'tornado', 'tornadoEnd', 'throwBlocked', 'mudForm', 'seedSink', 'seedSurface', 'mudDry', 'endLingering', 'banner']) {
    const spec = { kind, x: 1, y: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    assert.equal(heldCell(spec, STAGES), null, kind);
    assert.equal(regrowCell(spec, STAGES), null, kind);
  }
});

// --- Animation timelines ---

// Sets the time a pose function reads.
function at(pose, ageMs) {
  pose.ageMs = ageMs;
  return pose;
}

test('reverse growth plays the stages backwards at 2.5 times speed', () => {
  assert.equal(REVERSE_GROWTH_SPEED, 2.5);
  assert.equal(reverseGrowthMs(STAGES, STAGE_REST, STAGE_DROP), 1200 / 2.5);
  assert.equal(reverseGrowthMs(STAGES, STAGE_REST, STAGE_SPROUT), (1200 - 450) / 2.5);
  assert.equal(dashFoldMs(STAGES), 480);
  assert.equal(convertWiltMs(STAGES), 300);
  assert.equal(convertMs(STAGES), 300 + CONVERT_SPARK_MS);

  const out = {};
  assert.deepEqual(reverseGrowthInto(at(out, 0), STAGES, STAGE_REST, STAGE_DROP), { ageMs: 0, frame: STAGE_REST, done: false });
  let last = STAGE_REST;
  for (let t = 0; t <= 600; t += 5) {
    reverseGrowthInto(at(out, t), STAGES, STAGE_REST, STAGE_DROP);
    assert.ok(out.frame <= last && last - out.frame <= 1, 'one stage back at a time, never forward');
    // The mirror of growth: the stage shown is the stage growth shows at
    // the same point of the timeline counted back from Rest.
    if (t > 0 && t < 480) assert.equal(out.frame, growthStage(1200 - t * 2.5, STAGES).frame, `t=${t}`);
    last = out.frame;
  }
  assert.equal(out.frame, STAGE_DROP);
  assert.equal(out.done, true);
  // Each stage lasts its growing time divided by 2.5: Open shows for (1200 - 850) / 2.5 ms.
  reverseGrowthInto(at(out, 139), STAGES, STAGE_REST, STAGE_DROP);
  assert.equal(out.frame, STAGE_OPEN);
  reverseGrowthInto(at(out, 141), STAGES, STAGE_REST, STAGE_DROP);
  assert.equal(out.frame, STAGE_SPROUT);

  reverseGrowthInto(at(out, 10_000), STAGES, STAGE_REST, STAGE_SPROUT);
  assert.deepEqual([out.frame, out.done], [STAGE_SPROUT, true], 'a wilt stops at Sprout');
  reverseGrowthInto(at(out, -50), STAGES, STAGE_REST, STAGE_SPROUT);
  assert.deepEqual([out.frame, out.done], [STAGE_REST, false]);
});

test('the Wind Dash gust is a curve from source to target that bows sideways and lifts', () => {
  const out = {};
  const p = (t, fx, fz, tx, tz) => {
    out.progress = t;
    const { x, z, lift } = dashCurveInto(out, fx, fz, tx, tz);
    return { x, z, lift };
  };
  assert.deepEqual(p(0, 1, 2, 5, 2), { x: 1, z: 2, lift: 0 });
  const end = p(1, 1, 2, 5, 2);
  assert.ok(Math.abs(end.x - 5) < 1e-9 && Math.abs(end.z - 2) < 1e-9 && Math.abs(end.lift) < 1e-9);
  const mid = p(0.5, 1, 2, 5, 2);
  assert.ok(Math.abs(mid.x - 3) < 1e-9, 'halfway across');
  assert.ok(Math.abs(mid.z - 2) > 0.2, 'it bows off the straight line');
  assert.ok(Math.abs(mid.lift - DASH_LIFT) < 1e-9, 'highest halfway');
  // Continuous: small steps make small moves.
  let prev = p(0, 0, 0, 3, 4);
  for (let t = 0.01; t <= 1; t += 0.01) {
    const next = p(t, 0, 0, 3, 4);
    assert.ok(Math.hypot(next.x - prev.x, next.z - prev.z) < 0.15);
    prev = next;
  }
  assert.deepEqual(p(-1, 0, 0, 3, 4), p(0, 0, 0, 3, 4), 'clamped');
});

test('on plain-slide levels the Wind Dash seed slides straight along the ground', () => {
  const out = {};
  for (let t = 0; t <= 1; t += 0.05) {
    out.progress = t;
    dashCurveInto(out, 1, 2, 5, 6, true);
    assert.equal(out.lift, 0, 'it never leaves the ground');
    assert.ok(Math.abs((out.x - 1) - (out.z - 2)) < 1e-9, 'it stays on the straight line');
  }
  out.progress = 1;
  dashCurveInto(out, 1, 2, 5, 6, true);
  assert.ok(Math.abs(out.x - 5) < 1e-9 && Math.abs(out.z - 6) < 1e-9, 'it ends on the target');
});

test('only Low uses plain slides; Medium and High keep the curves and arcs', () => {
  assert.equal(plainSlides(QUALITY_LEVELS.low), true);
  assert.equal(plainSlides(QUALITY_LEVELS.medium), false);
  assert.equal(plainSlides(QUALITY_LEVELS.high), false);
});

test('a dashing plant folds into a seed, then the seed rides the gust and lands', () => {
  const fold = dashFoldMs(STAGES);
  const out = {};
  dashPose(at(out, 0), STAGES);
  assert.deepEqual([out.frame, out.flying, out.progress, out.done], [STAGE_REST, false, 0, false]);
  dashPose(at(out, fold / 2), STAGES);
  assert.equal(out.flying, false, 'it does not move while it folds');
  assert.ok(out.frame < STAGE_REST && out.frame > STAGE_DROP);
  let last = 0;
  for (let t = fold + 1; t <= fold + DASH_STREAK_MS; t += 10) {
    dashPose(at(out, t), STAGES);
    assert.equal(out.frame, STAGE_DROP, 'a seed while it flies');
    assert.equal(out.flying, true);
    assert.ok(out.progress >= last, 'never moves back');
    last = out.progress;
  }
  dashPose(at(out, fold + DASH_STREAK_MS), STAGES);
  assert.deepEqual([out.progress, out.done], [1, true]);
  assert.equal(out.ageMs, fold + DASH_STREAK_MS, 'the time it read is left alone');
});

test('a thrown seed drops onto its plot, then flies in an arc and lands', () => {
  const out = {};
  throwPose(at(out, 0));
  assert.equal(out.dropPx, PLANT_DROP_PX, 'it starts above its plot like a planted seed');
  throwPose(at(out, THROW_DELAY_MS / 2));
  assert.equal(out.progress, 0, 'it waits on the cell where it was planted');
  assert.equal(out.height, 0);
  throwPose(at(out, THROW_DELAY_MS));
  assert.equal(out.dropPx, 0, 'it has landed before it is thrown');
  let lastProgress = 0;
  for (let t = THROW_DELAY_MS; t <= THROW_DELAY_MS + THROW_MS; t += 10) {
    throwPose(at(out, t));
    assert.ok(out.progress >= lastProgress);
    assert.ok(out.height >= 0 && out.height <= THROW_ARC_HEIGHT + 1e-9);
    lastProgress = out.progress;
  }
  throwPose(at(out, THROW_DELAY_MS + THROW_MS / 2));
  assert.ok(Math.abs(out.height - THROW_ARC_HEIGHT) < 1e-9, 'highest halfway');
  throwPose(at(out, THROW_DELAY_MS + THROW_MS));
  assert.equal(out.progress, 1);
  assert.equal(out.height, 0);
  assert.equal(out.done, true);
});

test('on plain-slide levels a thrown seed slides along the ground', () => {
  const out = {};
  for (let t = 0; t <= THROW_DELAY_MS + THROW_MS; t += 10) {
    throwPose(at(out, t), true);
    assert.equal(out.height, 0);
  }
  assert.deepEqual([out.progress, out.done], [1, true]);
});

test('a converted plant wilts back to Sprout, then a spark runs through the soil to it', () => {
  const wilt = convertWiltMs(STAGES);
  const out = {};
  convertPose(at(out, 0), STAGES);
  assert.deepEqual([out.frame, out.spark, out.done], [STAGE_REST, -1, false]);
  let last = STAGE_REST;
  for (let t = 0; t < wilt; t += 5) {
    convertPose(at(out, t), STAGES);
    assert.ok(out.frame <= last && out.frame >= STAGE_SPROUT, 'it only wilts, down to Sprout');
    assert.equal(out.spark, -1, 'no spark while it wilts');
    last = out.frame;
  }
  let lastSpark = 0;
  for (let t = wilt; t <= wilt + CONVERT_SPARK_MS; t += 5) {
    convertPose(at(out, t), STAGES);
    assert.equal(out.frame, STAGE_SPROUT);
    assert.ok(out.spark >= lastSpark && out.spark <= 1);
    lastSpark = out.spark;
  }
  convertPose(at(out, wilt + CONVERT_SPARK_MS), STAGES);
  assert.deepEqual([out.spark, out.done], [1, true]);
});

test('the conversion spark enters at the plot\'s upper left and ends under the plant', () => {
  const out = {};
  const p = (spark) => {
    out.spark = spark;
    const { x, z } = sparkPathInto(out, 4, -2);
    return { x, z };
  };
  assert.deepEqual(p(0), { x: 4 - SPARK_REACH, z: -2 - SPARK_REACH });
  const end = p(1);
  assert.ok(Math.abs(end.x - 4) < 1e-9 && Math.abs(end.z + 2) < 1e-9);
  for (let t = 0; t <= 1; t += 0.05) {
    const { x, z } = p(t);
    assert.ok(Math.abs(x - 4) < 0.5 && Math.abs(z + 2) < 0.5, 'it stays inside its plot');
  }
});

test('plants in a Tornado Zone bend towards it by whole pixels, across the view only', () => {
  // A sprite facing the camera straight on (yaw 0): its width runs along world x.
  assert.equal(bendTowardPx(0, 0, 1, 0, 1, 0, 3), 3, 'swirl to the right: lean right');
  assert.equal(bendTowardPx(2, 0, 1, 0, 1, 0, 3), -3, 'swirl to the left: lean left');
  assert.equal(bendTowardPx(0, 0, 0, 1, 1, 0, 3), 0, 'swirl straight behind: no sideways lean');
  assert.equal(bendTowardPx(1, 1, 1, 1, 1, 0, 3), 0, 'the plant under the swirl stands straight');
  assert.equal(bendTowardPx(0, 0, 1, 1, 1, 0, 3), 2, 'diagonal: the part across the view');
  assert.equal(bendTowardPx(0, 0, 1, 0, 1, 0, 0), 0);
  // Turned half round, its width runs the other way.
  assert.equal(bendTowardPx(0, 0, 1, 0, -1, 0, 3), -3);
  for (let i = 0; i < 50; i++) {
    const v = bendTowardPx(Math.sin(i), Math.cos(i * 3), 0.3, -0.2, Math.cos(i), Math.sin(i), 2.6);
    assert.ok(Number.isInteger(v) && Math.abs(v) <= 3);
  }
  // Along the height the lean grows with its square, in whole pixels, root still.
  assert.equal(bendRowPx(3, 0), 0);
  assert.equal(bendRowPx(3, 1), 3);
  assert.equal(bendRowPx(-3, 1), -3);
  assert.equal(bendRowPx(3, 0.5), 1);
  let last = 0;
  for (let h = 0; h <= 1; h += 0.05) {
    const lean = bendRowPx(3, h);
    assert.ok(Number.isInteger(lean) && lean >= last);
    last = lean;
  }
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

test('the quality level scales particle counts down, to none on low', () => {
  const scales = QUALITY_ORDER.map((level) => particleScale(QUALITY_LEVELS[level]));
  assert.equal(scales[0], 1, 'high has the full counts');
  for (let i = 1; i < scales.length; i++) assert.ok(scales[i] < scales[i - 1]);
  assert.equal(particleScale(QUALITY_LEVELS.low), 0);
  assert.equal(scaledCount(12, 1), 12);
  const medium = particleScale(QUALITY_LEVELS.medium);
  assert.equal(scaledCount(12, medium), Math.max(1, Math.round(12 * medium)));
  assert.equal(scaledCount(1, 0.01), 1, 'never fewer than one while particles are on');
  assert.equal(scaledCount(12, 0), 0, 'none at all on low');
});

test('the pool never holds more live particles than its limit (the particle cap)', () => {
  const pool = createParticlePool(220);
  const p = createSpawnParams();
  pool.limit = 60;
  for (let i = 0; i < 100; i++) pool.spawnFall(p);
  assert.equal(pool.count, 60);
  pool.limit = 0;
  assert.equal(pool.spawnFall(p), -1, 'a limit of 0 spawns nothing');
  assert.equal(pool.count, 60, 'lowering the limit keeps the live particles');
  pool.limit = 220;
  for (let i = 0; i < 500; i++) pool.spawnFall(p);
  assert.equal(pool.count, 220);
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
