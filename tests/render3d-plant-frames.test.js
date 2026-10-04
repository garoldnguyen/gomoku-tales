// The in-between frames of the planting animation (Design v4 part 4):
// src/render3d/plant-frames.js and the plantInBetween key of the ONE
// quality table.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PLANT_IN_BETWEEN_LIFT_PX } from '../src/config.js';
import { growthStage, STAGE_DROP, STAGE_LAND, STAGE_REST } from '../src/render3d/growth.js';
import { plantFrameIndex, plantFrames } from '../src/render3d/plant-frames.js';
import { QUALITY_LEVELS, qualityFeatures } from '../src/render3d/quality.js';

const STAGES = 5; // Drop, Land, Sprout, Open, Rest
const STAGE_START_MS = [0, 150, 450, 850, 1200]; // as in assets/v3-meta.json
const TOP_ROWS = [6, 3, 12, 20, 21]; // a seed, the soil, a sprout, a bloom, the bloom at rest

function framesFor(level, topRows = TOP_ROWS) {
  return plantFrames(STAGES, qualityFeatures(level).plantInBetween, topRows);
}

test('the quality table has plantInBetween: 0 on Low, 2 on Medium and High', () => {
  const { low, medium, high } = QUALITY_LEVELS;
  assert.deepEqual([low, medium, high].map((row) => row.plantInBetween), [0, 2, 2]);
});

test('13 frames on Medium and High, the 5 stage frames on Low', () => {
  assert.equal(framesFor('medium').length, 13);
  assert.equal(framesFor('high').length, 13);
  const low = framesFor('low');
  assert.equal(low.length, 5);
  low.forEach((frame, stage) => assert.deepEqual(frame, { from: stage, to: stage, mix: 0, liftPx: 0 }));
});

test('the first and last frames are the Drop and Rest stage frames', () => {
  for (const level of ['low', 'medium', 'high']) {
    const frames = framesFor(level);
    assert.deepEqual(frames[0], { from: STAGE_DROP, to: STAGE_DROP, mix: 0, liftPx: 0 }, level);
    assert.deepEqual(frames.at(-1), { from: STAGE_REST, to: STAGE_REST, mix: 0, liftPx: 0 }, level);
  }
});

test('every stage frame is in the list, with two in-betweens after each but the last', () => {
  const frames = framesFor('medium');
  for (let stage = 0; stage < STAGES; stage++) {
    assert.deepEqual(frames[stage * 3], { from: stage, to: stage, mix: 0, liftPx: 0 });
  }
});

test('each in-between frame lies between its two neighbours', () => {
  for (const topRows of [TOP_ROWS, null, [30, 0, 30, 0, 30]]) {
    const frames = framesFor('medium', topRows);
    // As a position along the growth: stage + mix rises strictly frame by frame.
    const along = frames.map((f) => f.from + f.mix * (f.to - f.from));
    for (let i = 1; i < frames.length - 1; i++) {
      const frame = frames[i];
      if (frame.from === frame.to) continue;
      assert.equal(frame.to, frame.from + 1, 'it fades into the next stage frame');
      assert.ok(along[i - 1] < along[i] && along[i] < along[i + 1], `frame ${i} lies between its neighbours`);
      assert.ok(frame.mix > 0 && frame.mix < 1, `frame ${i} mixes both frames`);
      // Each neighbour is the same stage frame or the other in-between.
      for (const neighbour of [frames[i - 1], frames[i + 1]]) {
        assert.ok(neighbour.from >= frame.from && neighbour.to <= frame.to, `frame ${i}: its neighbours are its two stage frames or between them`);
      }
      // The shown top (the frames' tops mixed, plus the nudge) lies between
      // the neighbours' tops too, when the art gives them.
      if (topRows) {
        const top = (f) => topRows[f.from] + f.mix * (topRows[f.to] - topRows[f.from]);
        const lo = Math.min(topRows[frame.from], topRows[frame.to]);
        const hi = Math.max(topRows[frame.from], topRows[frame.to]);
        assert.ok(top(frame) >= lo && top(frame) <= hi, `frame ${i}: its mixed top lies between the stage tops`);
      }
    }
    assert.deepEqual(frames.slice(1, 3).map((f) => f.mix), [1 / 3, 2 / 3], 'the mixes are 1/3 and 2/3');
  }
});

test('the in-betweens move the sprite by whole art pixels, 0 to 2, against the growth', () => {
  const frames = framesFor('high');
  for (const frame of frames) {
    assert.ok(Number.isInteger(frame.liftPx), 'whole pixels: crisp');
    assert.ok(Math.abs(frame.liftPx) <= PLANT_IN_BETWEEN_LIFT_PX, `|${frame.liftPx}| <= 2`);
    if (frame.from === frame.to) assert.equal(frame.liftPx, 0, 'a stage frame never moves');
    const grow = TOP_ROWS[frame.to] - TOP_ROWS[frame.from];
    if (grow > 0) assert.ok(frame.liftPx <= 0, 'growing taller: it starts lower');
    if (grow < 0) assert.ok(frame.liftPx >= 0, 'shrinking: it starts higher');
  }
  assert.equal(PLANT_IN_BETWEEN_LIFT_PX, 2);
  // Land -> Sprout grows 9 rows: the nudge is capped at 2 and shrinks to the next frame.
  assert.deepEqual(frames.slice(4, 6).map((f) => f.liftPx), [-1, -1]);
  // No art rows: no nudge.
  for (const frame of plantFrames(STAGES, 2)) assert.equal(frame.liftPx, 0);
});

test('the frame list is frozen and built once, not per frame', () => {
  const frames = framesFor('medium');
  assert.ok(Object.isFrozen(frames));
  assert.ok(frames.every(Object.isFrozen));
});

test('plantFrameIndex walks all 13 frames in order through one growth, and the 5 on Low', () => {
  for (const [inBetween, count] of [[2, 13], [0, 5]]) {
    const seen = [];
    for (let ms = 0; ms <= 1300; ms += 5) {
      const { frame, progress } = growthStage(ms, STAGE_START_MS);
      const index = plantFrameIndex(frame, progress, STAGES, inBetween);
      if (seen.at(-1) !== index) seen.push(index);
    }
    assert.deepEqual(seen, Array.from({ length: count }, (_, i) => i), `${count} frames in order`);
  }
  assert.equal(plantFrameIndex(STAGE_REST, 1, STAGES, 2), 12);
  assert.equal(plantFrameIndex(STAGE_LAND, 0, STAGES, 2), 3, 'a stage starts on its own frame');
  assert.equal(plantFrameIndex(STAGE_LAND, 0.999, STAGES, 2), 5);
  assert.equal(plantFrameIndex(STAGE_LAND, 0.5, STAGES, 0), STAGE_LAND);
});

test('only the quality table chooses the in-betweens: no code tests the level name', () => {
  for (const file of ['../src/render3d/plant-frames.js', '../src/render3d/world-renderer.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''); // code only
    assert.ok(!/['"](low|medium|high)['"]/.test(source), `${file} names no level`);
  }
  const renderer = readFileSync(new URL('../src/render3d/world-renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /features\?\.plantInBetween/, 'the renderer reads plantInBetween from the quality row');
});

test('the cross-fade keeps whole pixels and visibly fades pixels only one frame has', async () => {
  const { FADE_THRESHOLD_GLSL, fadeCover, fadeShows, fadeThreshold } = await import('../src/render3d/plant-frames.js');
  // 16 different thresholds in every 4 x 4 block, repeating, all inside 0 to 1.
  const levels = new Set();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) levels.add(fadeThreshold(x, y));
  assert.equal(levels.size, 16);
  for (const t of levels) assert.ok(t > 0 && t < 1);
  assert.equal(fadeThreshold(9, 14), fadeThreshold(1, 2));
  assert.match(FADE_THRESHOLD_GLSL, /plantFadeThreshold/);
  // Share of a 16 x 16 patch that shows, for a pixel in one frame or both.
  const share = (fromA, toA, mix) => {
    let shown = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (fadeShows(fromA, toA, mix, x, y)) shown++;
    return shown / 256;
  };
  const mixes = framesFor('medium').map((f) => f.mix).filter((m) => m > 0); // 1/3, 2/3, ...
  for (const mix of mixes) {
    const oldOnly = share(1, 0, mix);
    const newOnly = share(0, 1, mix);
    // Strictly between the two stage frames: neither all nor none.
    assert.ok(oldOnly > 0 && oldOnly < 1, `old-only pixels partly shown at ${mix}`);
    assert.ok(newOnly > 0 && newOnly < 1, `new-only pixels partly shown at ${mix}`);
    assert.ok(Math.abs(oldOnly - (1 - mix)) <= 1 / 16, 'the old frame fades out with the mix');
    assert.ok(Math.abs(newOnly - mix) <= 1 / 16, 'the new frame fades in with the mix');
    assert.equal(share(1, 1, mix), 1, 'pixels in both frames always show');
    assert.equal(share(0, 0, mix), 0, 'empty pixels never show');
  }
  // More of the new frame on the later in-between.
  assert.ok(share(0, 1, 2 / 3) > share(0, 1, 1 / 3));
  assert.equal(fadeCover(1, 0, 0), 1);
  assert.equal(fadeCover(1, 0, 1), 0);
});
