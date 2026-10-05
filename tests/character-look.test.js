import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from '../src/config.js';
import { CHARACTERS, CLOUD_EAGLE, EARTH_BEAR, JADE_SERPENT, WIND_RABBIT } from '../src/logic/characters.js';
import { O, X } from '../src/logic/board.js';
import { QUALITY_LEVELS, QUALITY_ORDER } from '../src/render3d/quality.js';
import {
  CHARACTER_LOOK, CLOUD_SWIRL, SIDE_SHAPE, SOIL_BURST, VINE_COIL, WIND_DANDELION, hexToRgb, markLookFor, paletteSwap,
  particleCount, placementPlan, planDurationMs,
} from '../src/render3d/character-look.js';

const EFFECTS = [WIND_DANDELION, SOIL_BURST, VINE_COIL, CLOUD_SWIRL];

test('each character has one colour and one effect', () => {
  assert.deepEqual(Object.keys(CHARACTER_LOOK).sort(), Object.keys(CHARACTERS).sort());
  assert.deepEqual(markLookFor(WIND_RABBIT), { colour: '#3b8cff', effect: WIND_DANDELION });
  assert.deepEqual(markLookFor(EARTH_BEAR), { colour: '#c9703a', effect: SOIL_BURST });
  assert.deepEqual(markLookFor(JADE_SERPENT), { colour: '#2fbf7a', effect: VINE_COIL });
  assert.deepEqual(markLookFor(CLOUD_EAGLE), { colour: '#fff2a8', effect: CLOUD_SWIRL });
  for (const id of Object.keys(CHARACTERS)) {
    const look = markLookFor(id);
    assert.deepEqual(Object.keys(look).sort(), ['colour', 'effect']);
    assert.match(look.colour, /^#[0-9a-f]{6}$/);
  }
  const colours = Object.values(CHARACTER_LOOK).map((look) => look.colour);
  const effects = Object.values(CHARACTER_LOOK).map((look) => look.effect);
  assert.equal(new Set(colours).size, 4);
  assert.equal(new Set(effects).size, 4);
  assert.equal(markLookFor('nobody'), null);
});

test('the shape stays with the side: X is the cross, O the round bloom', () => {
  assert.deepEqual(SIDE_SHAPE, { [X]: 'cross', [O]: 'round' });
  for (const look of Object.values(CHARACTER_LOOK)) assert.ok(!('shape' in look));
});

test('paletteSwap changes only the source colour and keeps alpha', () => {
  const blue = hexToRgb('#3b8cff');
  assert.deepEqual(blue, [59, 140, 255]);
  const jade = hexToRgb('#2fbf7a');
  const pixels = new Uint8ClampedArray([
    59, 140, 255, 255, // source, opaque
    59, 140, 255, 128, // source, half alpha
    59, 140, 254, 255, // near the source, not it
    10, 20, 30, 0, // other colour
  ]);
  const before = pixels.slice();
  const out = paletteSwap(pixels, blue, jade);
  assert.ok(out instanceof Uint8ClampedArray);
  assert.deepEqual([...out], [47, 191, 122, 255, 47, 191, 122, 128, 59, 140, 254, 255, 10, 20, 30, 0]);
  assert.deepEqual(pixels, before, 'the input is not changed');
});

test('placementPlan is deterministic and built once', () => {
  for (const effect of EFFECTS) {
    const features = QUALITY_LEVELS.high;
    const a = placementPlan(effect, { features });
    const b = placementPlan(effect, { features });
    assert.equal(a, b, 'the same plan object is handed out again');
    assert.ok(Object.isFrozen(a));
    const other = placementPlan(effect, { features, seed: 99 });
    assert.equal(JSON.stringify(placementPlan(effect, { features, seed: 99 })), JSON.stringify(other));
  }
  assert.deepEqual(placementPlan('nothing'), []);
});

test('placementPlan respects the particle cap of every level', () => {
  for (const effect of EFFECTS) {
    for (const level of QUALITY_ORDER) {
      const features = QUALITY_LEVELS[level];
      assert.ok(particleCount(placementPlan(effect, { features })) <= features.particleCap);
    }
    for (const cap of [0, 1, 3, 5]) {
      assert.ok(particleCount(placementPlan(effect, { features: { particleCap: cap } })) <= cap);
    }
  }
});

test('windDandelion: streaks and 6 to 8 puffs drifting toward the lower right', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const plan = placementPlan(WIND_DANDELION, { features: QUALITY_LEVELS.high, seed });
    const puffs = plan.filter((step) => step.kind === 'dandelionPuff');
    assert.ok(puffs.length >= config.DANDELION_PUFF_MIN && puffs.length <= config.DANDELION_PUFF_MAX);
    const streaks = plan.filter((step) => step.kind === 'windStreak');
    assert.equal(streaks.length, config.DANDELION_STREAK_COUNT);
    streaks.forEach((step, i) => assert.ok(step.startMs >= 0 && step.startMs <= i * config.DANDELION_STREAK_STAGGER_MS));
    for (const step of streaks) assert.equal(step.durationMs, config.DANDELION_STREAK_MS);
    for (const step of puffs) assert.equal(step.durationMs, config.DANDELION_PUFF_MS);
    for (const step of plan) {
      assert.ok(step.to[0] > step.from[0], 'moves right');
      assert.ok(step.to[2] > step.from[2], 'moves toward the viewer (down the screen)');
    }
  }
});

test('soilBurst: specks and 4 to 6 rock chips thrown out and falling back', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const plan = placementPlan(SOIL_BURST, { features: QUALITY_LEVELS.high, seed });
    const chips = plan.filter((step) => step.kind === 'rockChip');
    assert.ok(chips.length >= config.SOIL_CHIP_MIN && chips.length <= config.SOIL_CHIP_MAX);
    assert.equal(plan.filter((step) => step.kind === 'soilSpeck').length, config.SOIL_SPECK_COUNT);
    for (const step of plan) {
      assert.equal(step.to[1], 0, 'falls back to the ground');
      assert.ok(step.startMs >= 0 && step.startMs <= config.SOIL_THROW_JITTER_MS);
      assert.equal(step.durationMs, step.kind === 'rockChip' ? config.SOIL_CHIP_MS : config.SOIL_SPECK_MS);
      assert.ok(step.height > 0);
    }
  }
});

test('vineCoil: rises, coils twice, sinks over about 1.2 seconds on every level', () => {
  for (const level of QUALITY_ORDER) {
    const plan = placementPlan(VINE_COIL, { features: QUALITY_LEVELS[level] });
    assert.deepEqual(plan.filter((step) => !step.particle).map((step) => step.kind), ['vineRise', 'vineCoil', 'vineSink']);
    assert.equal(plan.find((step) => step.kind === 'vineCoil').turns, 2);
    assert.equal(planDurationMs(plan), 1200);
    assert.ok(plan.find((step) => step.kind === 'vineSink').to[1] < 0, 'ends in the soil');
  }
});

test('character-look.js has no Three.js import and tests no level name', () => {
  const source = readFileSync(new URL('../src/render3d/character-look.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]three/);
  assert.doesNotMatch(source, /'(low|medium|high)'/);
});
