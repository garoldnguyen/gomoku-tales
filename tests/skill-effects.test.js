// The skill effects of every character (src/render3d/effect-plans.js and
// skill-rings.js): which visuals the Jade Serpent and Cloud Eagle events
// show, the cast ring of every skill, the win celebration, and the pure
// timing of the rings, the Venom wilt, the cloud forming and fading and
// the Sky Watch pulse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAST_RING_FROM, CAST_RING_MS, CAST_RING_TO, CLOUD_FADE_MS, CLOUD_FORM_MS, HISS_WOBBLE, RING_MAX_DOTS,
  SKY_WATCH_PULSE_LOW, SKY_WATCH_PULSE_MS, VENOM_DROP_MS, VENOM_SINK_MS,
} from '../src/config.js';
import { O, X } from '../src/logic/board.js';
import { CLOUD_EAGLE, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { maskEventsForViewer, maskForViewer } from '../src/logic/cloud.js';
import { createInitialState, placeStone, useSkill } from '../src/logic/game.js';
import { CLOUD, HISS, VENOM } from '../src/logic/skills.js';
import {
  cloudFadeAmount, cloudFormAmount, skyWatchPulse, venomMs, venomPose, venomWiltMs, visualsForEvents,
} from '../src/render3d/effect-plans.js';
import { STAGE_REST, STAGE_SPROUT } from '../src/render3d/growth.js';
import {
  clearRings, createRings, ringAlpha, ringDotsInto, ringProgress, ringRadius, startRing, stepRings,
} from '../src/render3d/skill-rings.js';

// The pack's default stage start times (v3-meta.json): drop, land, sprout, open, rest.
const STAGES = [0, 250, 500, 800, 1000];
const kinds = (specs) => specs.map((spec) => spec.kind);

// Plays moves ([x, y] plants, { skill, target } uses a skill) for the
// player to move, from a game of the given sides.
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

test('Hiss sends wavy jade rings across the field and names who it silences', () => {
  const [hissed] = play({ [X]: JADE_SERPENT, [O]: CLOUD_EAGLE }, [{ skill: HISS }]);
  const specs = visualsForEvents(hissed.events);
  assert.ok(!kinds(specs).includes('castRing'), 'Hiss has no target plot');
  assert.deepEqual(specs.find((spec) => spec.kind === 'hiss'), { kind: 'hiss', player: X, locked: O });
});

test('Venom: a cast ring on the target; the plant stays, so it no longer wilts away (the zone is drawn from the state)', () => {
  const results = play({ [X]: WIND_RABBIT, [O]: JADE_SERPENT }, [[7, 7], { skill: VENOM, target: { x: 7, y: 7 } }]);
  const specs = visualsForEvents(results[1].events);
  assert.deepEqual(specs[0], { kind: 'castRing', x: 7, y: 7, player: O });
  assert.equal(specs.some((spec) => spec.kind === 'venom'), false, 'no wilt-and-sink: Venom removes nothing');
});

test('Cloud: the cloud forms where it is placed and fades where it ended', () => {
  const results = play({ [X]: CLOUD_EAGLE, [O]: WIND_RABBIT }, [
    { skill: CLOUD, target: { x: 7, y: 7 } }, [0, 0], [1, 1], [0, 1], [2, 2], [0, 2],
  ]);
  const placed = visualsForEvents(results[0].events);
  assert.deepEqual(placed.find((spec) => spec.kind === 'cloudForm'), { kind: 'cloudForm', x: 7, y: 7, player: X });
  const ended = results.flatMap((result) => visualsForEvents(result.events)).filter((spec) => spec.kind === 'cloudFade');
  assert.deepEqual(ended, [{ kind: 'cloudFade', x: 7, y: 7, player: X }]);
});

test('a skill aimed under the viewer\'s hidden cloud shows no cast ring there', () => {
  // Cloud Eagle (X) clouds the middle, the rabbit plants outside it, the
  // eagle plants under its own cloud; the rabbit's view of that never names the plot.
  const results = play({ [X]: CLOUD_EAGLE, [O]: WIND_RABBIT }, [{ skill: CLOUD, target: { x: 7, y: 7 } }, [0, 0], [7, 7]]);
  const last = results.at(-1);
  const masked = maskForViewer(last.state, O);
  const seen = visualsForEvents(maskEventsForViewer(masked, last.events));
  for (const spec of seen) {
    assert.ok(!(spec.x === 7 && spec.y === 7), `${spec.kind} shows the covered plot`);
  }
});

test('every winning plant celebrates in the winner\'s turn of the line', () => {
  const specs = visualsForEvents([{ type: 'win', player: O, line: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }] }]);
  assert.deepEqual(kinds(specs), ['winBloom', 'endLingering']);
  assert.equal(specs[0].player, O);
  assert.equal(specs[0].line.length, 5);
  assert.deepEqual(kinds(visualsForEvents([{ type: 'win', player: O, line: [] }])), ['endLingering'], 'a fully covered line shows nothing');
});

test('venomPose: drops fall, the plant wilts green back to Sprout, then sinks', () => {
  const pose = { ageMs: 0 };
  venomPose(pose, STAGES);
  assert.deepEqual([pose.frame, pose.tint, pose.sink, pose.done], [STAGE_REST, 0, 0, false], 'still whole while the drops fall');

  pose.ageMs = VENOM_DROP_MS + venomWiltMs(STAGES) / 2;
  venomPose(pose, STAGES);
  assert.ok(pose.tint > 0.4 && pose.tint < 0.6, 'half green halfway through the wilt');
  assert.equal(pose.sink, 0);

  pose.ageMs = VENOM_DROP_MS + venomWiltMs(STAGES) + 1;
  venomPose(pose, STAGES);
  assert.equal(pose.frame, STAGE_SPROUT);
  assert.equal(pose.tint, 1);

  pose.ageMs = venomMs(STAGES);
  venomPose(pose, STAGES);
  assert.equal(pose.sink, 1);
  assert.equal(pose.done, true);
  assert.equal(venomMs(STAGES), VENOM_DROP_MS + venomWiltMs(STAGES) + VENOM_SINK_MS);
});

test('a cloud thickens from nothing and an ended one thins away', () => {
  assert.equal(cloudFormAmount(0), 0);
  assert.equal(cloudFormAmount(CLOUD_FORM_MS), 1);
  assert.equal(cloudFormAmount(-Infinity), 1, 'a cloud never seen forming is whole');
  assert.ok(cloudFormAmount(CLOUD_FORM_MS / 2) > 0 && cloudFormAmount(CLOUD_FORM_MS / 2) < 1);
  assert.equal(cloudFadeAmount(0), 1);
  assert.equal(cloudFadeAmount(CLOUD_FADE_MS), 0);
  assert.equal(cloudFadeAmount(-Infinity), 0, 'nothing fades before a cloud ends');
});

test('the Sky Watch outlines breathe between SKY_WATCH_PULSE_LOW and full', () => {
  assert.equal(skyWatchPulse(0), 1);
  assert.ok(Math.abs(skyWatchPulse(SKY_WATCH_PULSE_MS / 2) - SKY_WATCH_PULSE_LOW) < 1e-9);
  for (let t = 0; t < SKY_WATCH_PULSE_MS; t += 37) {
    const v = skyWatchPulse(t);
    assert.ok(v >= SKY_WATCH_PULSE_LOW - 1e-9 && v <= 1 + 1e-9, String(t));
  }
});

test('a ring spreads from its start width to its end width and fades out', () => {
  const rings = createRings(2);
  const ring = startRing(rings, { x: 1, z: 2, from: CAST_RING_FROM, to: CAST_RING_TO, ms: CAST_RING_MS, dots: 12, color: 0xff00ff }, 1000);
  const xyz = new Float32Array(RING_MAX_DOTS * 3);
  assert.equal(ringDotsInto(ring, 999, xyz), 0, 'not before it leaves');
  assert.equal(ringDotsInto(ring, 1000, xyz), 12);
  assert.equal(ring.alpha, 1);
  for (let i = 0; i < 12; i++) {
    const r = Math.hypot(xyz[i * 3] - 1, xyz[i * 3 + 2] - 2);
    assert.ok(Math.abs(r - CAST_RING_FROM) < 1e-5, 'every dot on the starting circle');
  }
  assert.equal(ringRadius(ring, 1), CAST_RING_TO);
  assert.ok(ringRadius(ring, 0.5) > (CAST_RING_FROM + CAST_RING_TO) / 2, 'fast at first, slowing down');
  assert.ok(ringAlpha(0.5) > 0 && ringAlpha(0.5) < 1);
  assert.equal(ringAlpha(1), 0);
  stepRings(rings, 1000 + CAST_RING_MS);
  assert.equal(ring.active, false, 'gone at the end');
  assert.equal(ringDotsInto(ring, 1000 + CAST_RING_MS, xyz), 0);
});

test('a Hiss ring wobbles like a sound wave, a delayed ring waits, the oldest ring is reused', () => {
  const rings = createRings(2);
  const xyz = new Float32Array(RING_MAX_DOTS * 3);
  const wavy = startRing(rings, { x: 0, z: 0, from: 2, to: 2, ms: 100, dots: 40, color: 1, wobble: HISS_WOBBLE, waves: 6 }, 0);
  ringDotsInto(wavy, 10, xyz);
  const radii = [];
  for (let i = 0; i < 40; i++) radii.push(Math.hypot(xyz[i * 3], xyz[i * 3 + 2]));
  assert.ok(Math.max(...radii) - Math.min(...radii) > HISS_WOBBLE, 'the radius wobbles');
  assert.ok(Math.max(...radii) <= 2 + HISS_WOBBLE + 1e-5);

  const later = startRing(rings, { x: 0, z: 0, from: 1, to: 2, ms: 100, dots: 8, color: 2, delay: 50 }, 0);
  assert.ok(ringProgress(later, 40) < 0);
  assert.equal(ringDotsInto(later, 40, xyz), 0, 'waits for its delay');
  const third = startRing(rings, { x: 0, z: 0, from: 1, to: 2, ms: 100, dots: 8, color: 3 }, 60);
  assert.equal(third, wavy, 'every record plays: the one that left first is reused');
  clearRings(rings);
  assert.ok(rings.every((r) => !r.active));
});
