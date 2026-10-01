import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_DEFAULT, QUALITY_STALL_MS, QUALITY_STEP_DOWN_MS, RENDER_SCALE, TARGET_FRAME_MS,
} from '../src/config.js';
import {
  cappedPixelRatio, createSlowFrameWatch, cycleQuality, lowerQuality, QUALITY_LEVELS, QUALITY_ORDER,
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

test('quality levels match docs/art-direction-hd2d.md section E', () => {
  assert.deepEqual(QUALITY_ORDER, ['HIGH', 'MEDIUM', 'LOW']);
  const { HIGH, MEDIUM, LOW } = QUALITY_LEVELS;

  assert.equal(HIGH.postProcessing, true);
  assert.equal(HIGH.depthOfField, 'bokeh');
  assert.equal(HIGH.bloom, true);
  assert.equal(HIGH.bloomResolution, 1);
  assert.equal(HIGH.vignette, true);
  assert.equal(HIGH.shadowMaps, true);

  assert.equal(MEDIUM.postProcessing, true);
  assert.equal(MEDIUM.depthOfField, 'tiltShift');
  assert.ok(!MEDIUM.bloom || MEDIUM.bloomResolution === 0.5, 'bloom off or at half resolution');
  assert.equal(MEDIUM.shadowMaps, false);

  assert.equal(LOW.postProcessing, false);
  assert.equal(LOW.depthOfField, 'none');
  assert.equal(LOW.bloom, false);
  assert.equal(LOW.vignette, false);
  assert.equal(LOW.shadowMaps, false);

  for (const name of QUALITY_ORDER) assert.equal(QUALITY_LEVELS[name].name, name);
});

test('the default level is MEDIUM and the pixel ratio cap is 1 to 1.5', () => {
  assert.equal(QUALITY_DEFAULT, 'MEDIUM');
  assert.ok(QUALITY_LEVELS[QUALITY_DEFAULT]);
  assert.ok(RENDER_SCALE >= 1 && RENDER_SCALE <= 1.5);
  assert.equal(QUALITY_STEP_DOWN_MS, 3000);
  assert.ok(TARGET_FRAME_MS >= 1000 / 60, 'stepping down must not happen at a steady 60 fps');
});

test('Q cycles HIGH, MEDIUM, LOW and back to HIGH', () => {
  assert.equal(cycleQuality('HIGH'), 'MEDIUM');
  assert.equal(cycleQuality('MEDIUM'), 'LOW');
  assert.equal(cycleQuality('LOW'), 'HIGH');
  assert.throws(() => cycleQuality('ULTRA'));
});

test('lowerQuality steps down one level and stops at LOW', () => {
  assert.equal(lowerQuality('HIGH'), 'MEDIUM');
  assert.equal(lowerQuality('MEDIUM'), 'LOW');
  assert.equal(lowerQuality('LOW'), 'LOW');
});

test('cappedPixelRatio caps high-DPI screens at RENDER_SCALE', () => {
  assert.equal(cappedPixelRatio(1, 1.5), 1);
  assert.equal(cappedPixelRatio(1.25, 1.5), 1.25);
  assert.equal(cappedPixelRatio(2, 1.5), 1.5);
  assert.equal(cappedPixelRatio(3, 1), 1);
  assert.equal(cappedPixelRatio(undefined, 1.5), 1);
  assert.equal(cappedPixelRatio(0, 1.5), 1);
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
