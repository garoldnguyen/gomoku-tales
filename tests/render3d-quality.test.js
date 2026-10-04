import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_STALL_MS, QUALITY_STEP_DOWN_MS, TARGET_FRAME_MS } from '../src/config.js';
import {
  blursMenus, cappedPixelRatio, changedFeatures, createSlowFrameWatch, cycleQuality, loadSavedQuality,
  lowerQuality, MAX_PARTICLE_CAP, normalizeQuality, qualityFeatures, QUALITY_FALLBACK, QUALITY_LEVELS,
  QUALITY_ORDER, QUALITY_STORAGE_KEY, saveQuality, startQuality,
} from '../src/render3d/quality.js';

// Feeds `frames` frames of `frameMs` each, starting at `start`. Returns the
// time of the last frame and the frame times at which the watch said "step down".
function run(watch, { start = 0, frameMs, frames }) {
  const steps = [];
  let now = start;
  for (let i = 0; i < frames; i++) {
    if (watch.tick(now)) steps.push(now);
    now += frameMs;
  }
  return { now: now - frameMs, steps };
}

function labWatch() {
  return createSlowFrameWatch({ targetFrameMs: TARGET_FRAME_MS, holdMs: QUALITY_STEP_DOWN_MS, stallMs: QUALITY_STALL_MS });
}

// --- The feature table (docs/art-direction-v3.md section 5) ---

const { low, medium, high } = QUALITY_LEVELS;

// Every feature the doc lists, as a key of the table.
const FEATURES = [
  'pixelRatioCap', 'boardTexture', 'ground', 'scenery', 'meadowFlowers', 'skyHaze', 'groundFog', 'ridges', 'floorShade', 'sky', 'shadows',
  'postEffects', 'wind', 'growthExtras', 'skillEffects', 'particleCap', 'hudFrost', 'backgroundMotion',
];

// How each feature grows from low to high. Strings name their steps from
// least to most; numbers and booleans only grow; objects grow per field.
// boardTexture is a swap (a lighter texture on low), not an addition.
const STEPS = {
  ground: ['mown', 'painted', 'painted-ripples'],
  meadowFlowers: ['off', 'still', 'sway'],
  sky: ['gradient', 'still-clouds', 'drifting-clouds'],
  shadows: ['none', 'blob', 'sun'],
  skillEffects: ['simple', 'particles', 'full'],
  'hudFrost.shadow': ['none', 'small', 'soft'],
};
const NOT_ADDITIVE = new Set(['name', 'goal', 'boardTexture']);

// Deep keys of a row, such as 'postEffects.bloom'.
function deepKeys(row, prefix = '') {
  return Object.entries(row).flatMap(([key, value]) => (value && typeof value === 'object'
    ? deepKeys(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

function valueAt(row, path) {
  return path.split('.').reduce((value, key) => value[key], row);
}

// A comparable rank of a value of `path`: higher means more features.
function rank(path, value) {
  if (STEPS[path]) {
    const i = STEPS[path].indexOf(value);
    assert.ok(i >= 0, `${path}: unknown step ${value}`);
    return i;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  assert.equal(typeof value, 'number', `${path} needs steps in this test`);
  return value;
}

test('the table has low, medium and high, and nothing else', () => {
  assert.deepEqual(Object.keys(QUALITY_LEVELS).sort(), ['high', 'low', 'medium']);
  assert.deepEqual(QUALITY_ORDER, ['high', 'medium', 'low']);
  for (const name of QUALITY_ORDER) assert.equal(QUALITY_LEVELS[name].name, name);
});

test('all three levels have exactly the same keys, every listed feature among them', () => {
  const keys = deepKeys(medium);
  assert.deepEqual(deepKeys(low), keys);
  assert.deepEqual(deepKeys(high), keys);
  for (const feature of FEATURES) assert.ok(Object.hasOwn(medium, feature), feature);
});

test('each level only adds features compared with the one below it', () => {
  const ascending = [low, medium, high];
  for (const path of deepKeys(medium)) {
    if (NOT_ADDITIVE.has(path.split('.')[0])) continue;
    for (let i = 1; i < ascending.length; i++) {
      const below = rank(path, valueAt(ascending[i - 1], path));
      const above = rank(path, valueAt(ascending[i], path));
      assert.ok(above >= below, `${path}: ${ascending[i].name} has less than ${ascending[i - 1].name}`);
    }
  }
});

test('the table matches section 5 cell by cell', () => {
  assert.deepEqual([low, medium, high].map((l) => l.pixelRatioCap), [1, 1.5, 2]);
  assert.deepEqual([low, medium, high].map((l) => l.boardTexture), ['farm-board-low', 'farm-board', 'farm-board']);
  assert.deepEqual([low, medium, high].map((l) => l.scenery), [false, true, true]);
  assert.deepEqual([low, medium, high].map((l) => l.wind), [false, false, true]);
  assert.deepEqual([low, medium, high].map((l) => l.backgroundMotion), [false, false, true]);
  assert.deepEqual([low, medium, high].map((l) => l.hudFrost.blurPx), [0, 10, 18]);
  // Medium has no blur at all and no post effects; high has all four.
  for (const level of [low, medium]) {
    assert.deepEqual(level.postEffects, { bloom: false, depthOfField: false, warmGrade: false, vignette: false });
  }
  assert.deepEqual(high.postEffects, { bloom: true, depthOfField: true, warmGrade: true, vignette: true });
  assert.deepEqual(low.growthExtras, { openSparkles: false, soilPuff: false, rockShake: false });
  assert.deepEqual(medium.growthExtras, { openSparkles: true, soilPuff: false, rockShake: false });
  assert.deepEqual(high.growthExtras, { openSparkles: true, soilPuff: true, rockShake: true });
});

test('the particle caps are 0, 60 and 220', () => {
  assert.deepEqual([low, medium, high].map((l) => l.particleCap), [0, 60, 220]);
  assert.equal(MAX_PARTICLE_CAP, 220);
});

test('the table cannot be changed at run time', () => {
  assert.ok(Object.isFrozen(QUALITY_LEVELS));
  assert.ok(Object.isFrozen(high));
  assert.ok(Object.isFrozen(high.postEffects));
  assert.throws(() => { high.postEffects.bloom = false; });
});

// --- Picking, saving and switching ---

test('unknown values fall back to medium', () => {
  assert.equal(QUALITY_FALLBACK, 'medium');
  for (const value of [undefined, null, '', 'ultra', 'HIGHEST', 'toString', '__proto__', 3, {}]) {
    assert.equal(normalizeQuality(value), 'medium', String(value));
    assert.equal(qualityFeatures(value), medium);
  }
  assert.equal(normalizeQuality('low'), 'low');
  assert.equal(normalizeQuality(' High '), 'high', 'case and spaces do not matter');
  assert.equal(qualityFeatures('high'), high);
});

// A localStorage stand-in; `broken` makes every call throw.
function fakeStorage(initial = {}, broken = false) {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      if (broken) throw new Error('SecurityError');
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      if (broken) throw new Error('QuotaExceededError');
      data[key] = String(value);
    },
  };
}

test('?quality= wins over the saved choice, and unknown URL values are medium', () => {
  const storage = fakeStorage({ [QUALITY_STORAGE_KEY]: 'low' });
  assert.deepEqual(startQuality('high', storage), { level: 'high', fromUrl: true });
  assert.deepEqual(startQuality('ultra', storage), { level: 'medium', fromUrl: true });
  assert.deepEqual(startQuality(null, storage), { level: 'low', fromUrl: false });
  assert.deepEqual(startQuality(null, fakeStorage()), { level: 'medium', fromUrl: false });
  assert.deepEqual(startQuality(null, fakeStorage({ [QUALITY_STORAGE_KEY]: 'shiny' })), { level: 'medium', fromUrl: false });
});

test('the choice is saved and loaded, and the game works without storage', () => {
  const storage = fakeStorage();
  assert.equal(saveQuality(storage, 'high'), true);
  assert.equal(storage.data[QUALITY_STORAGE_KEY], 'high');
  assert.equal(loadSavedQuality(storage), 'high');
  assert.equal(saveQuality(storage, 'nonsense'), true);
  assert.equal(loadSavedQuality(storage), 'medium');

  const broken = fakeStorage({}, true);
  assert.equal(saveQuality(broken, 'low'), false);
  assert.equal(loadSavedQuality(broken), null);
  assert.deepEqual(startQuality(null, broken), { level: 'medium', fromUrl: false });
  assert.equal(saveQuality(null, 'low'), false);
  assert.equal(loadSavedQuality(null), null);
});

test('a switch rebuilds only the features that changed', () => {
  assert.deepEqual(changedFeatures(medium, medium), []);
  assert.deepEqual(changedFeatures(null, low), Object.keys(low), 'the first level sets everything');
  const lowToMedium = changedFeatures(low, medium);
  assert.ok(lowToMedium.includes('scenery') && lowToMedium.includes('particleCap'));
  assert.ok(!lowToMedium.includes('postEffects'), 'low and medium share their post effects');
  assert.ok(!lowToMedium.includes('wind'));
  assert.ok(!changedFeatures(medium, high).includes('boardTexture'));
  assert.ok(!changedFeatures(medium, high).includes('scenery'));
});

test('the scene behind the menus is blurred only with frosted HUD glass', () => {
  assert.deepEqual([low, medium, high].map(blursMenus), [false, true, true]);
});

test('Q cycles high, medium, low and back to high', () => {
  assert.equal(cycleQuality('high'), 'medium');
  assert.equal(cycleQuality('medium'), 'low');
  assert.equal(cycleQuality('low'), 'high');
  assert.throws(() => cycleQuality('ultra'));
});

test('lowerQuality steps down one level and stops at low', () => {
  assert.equal(lowerQuality('high'), 'medium');
  assert.equal(lowerQuality('medium'), 'low');
  assert.equal(lowerQuality('low'), 'low');
});

test('cappedPixelRatio caps high-DPI screens at the level\'s pixelRatioCap', () => {
  assert.equal(cappedPixelRatio(1, 1.5), 1);
  assert.equal(cappedPixelRatio(1.25, 1.5), 1.25);
  assert.equal(cappedPixelRatio(2, 1.5), 1.5);
  assert.equal(cappedPixelRatio(3, high.pixelRatioCap), 2);
  assert.equal(cappedPixelRatio(3, low.pixelRatioCap), 1);
  assert.equal(cappedPixelRatio(undefined, 1.5), 1);
  assert.equal(cappedPixelRatio(0, 1.5), 1);
});

test('stepping down waits 3 seconds and never fires at a steady 60 fps', () => {
  assert.equal(QUALITY_STEP_DOWN_MS, 3000);
  assert.ok(TARGET_FRAME_MS >= 1000 / 60, 'stepping down must not happen at a steady 60 fps');
});

test('slow frames for 3 seconds step down once, not earlier', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  // 30 ms frames: the 100th frame gap ends exactly 3000 ms after the first frame.
  const { steps } = run(watch, { frameMs: 30, frames: 101 });
  assert.deepEqual(steps, [3000]);
});

test('after a step down the next level gets a fresh 3 seconds', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  const { steps } = run(watch, { frameMs: 30, frames: 201 });
  assert.deepEqual(steps, [3000, 6000]);
});

test('fast frames never step down', () => {
  const watch = labWatch();
  assert.deepEqual(run(watch, { frameMs: 1000 / 60, frames: 60 * 20 }).steps, []);
  assert.ok(Math.abs(watch.averageMs - 1000 / 60) < 1e-6);
  assert.deepEqual(run(createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 }), { frameMs: 20, frames: 1000 }).steps, []);
});

test('a short slow patch does not step down when the 3 second average is fine', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  let { now, steps } = run(watch, { frameMs: 10, frames: 400 });
  // One second of 40 ms frames: the 3 second average stays (2000 + 1000) / (200 + 25) ms.
  ({ now, steps } = run(watch, { start: now + 40, frameMs: 40, frames: 25 }));
  assert.deepEqual(steps, []);
  ({ steps } = run(watch, { start: now + 10, frameMs: 10, frames: 400 }));
  assert.deepEqual(steps, []);
});

test('the average is over the most recent 3 seconds, so a fast start does not hide slow frames', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  const fast = run(watch, { frameMs: 10, frames: 1000 }); // 10 s of fast frames
  assert.deepEqual(fast.steps, []);
  const slow = run(watch, { start: fast.now + 50, frameMs: 50, frames: 60 }); // 3 s of slow frames
  assert.equal(slow.steps.length, 1);
  // It steps down once the newest 3 s average passes 20 ms, before 3 s of slow frames.
  assert.ok(slow.steps[0] - fast.now <= 3000);
});

test('a stall (hidden tab, shader compile) starts the watch over instead of counting as load', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  let { now, steps } = run(watch, { frameMs: 30, frames: 80 }); // 2.37 s of slow frames
  assert.deepEqual(steps, []);
  // A 5 second gap, then slow frames again: 3 more seconds are needed.
  ({ steps } = run(watch, { start: now + 5000, frameMs: 30, frames: 101 }));
  assert.deepEqual(steps, [now + 5000 + 3000]);
});

test('reset() after a manual change gives the new level a fresh 3 seconds', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  const { now } = run(watch, { frameMs: 30, frames: 90 });
  watch.reset();
  assert.equal(watch.averageMs, 0);
  const { steps } = run(watch, { start: now + 30, frameMs: 30, frames: 101 });
  assert.deepEqual(steps, [now + 30 + 3000]);
});

test('very fast frames that overflow the buffer never step down', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250, capacity: 64 });
  assert.deepEqual(run(watch, { frameMs: 2, frames: 5000 }).steps, []);
});

test('backwards or broken timestamps are ignored', () => {
  const watch = createSlowFrameWatch({ targetFrameMs: 20, holdMs: 3000, stallMs: 250 });
  assert.equal(watch.tick(1000), false);
  assert.equal(watch.tick(900), false);
  assert.equal(watch.tick(Number.NaN), false);
  assert.equal(watch.averageMs, 0);
  const { steps } = run(watch, { start: 2000, frameMs: 30, frames: 101 });
  assert.deepEqual(steps, [5000]);
});
