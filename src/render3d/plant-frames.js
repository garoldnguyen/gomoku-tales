// Pure in-between frames of the planting animation (Design v4 part 4, no
// new art): between each two neighbouring stage frames of plant-x and
// plant-o (Drop, Land, Sprout, Open, Rest) the quality row's plantInBetween
// frames cross-fade the two and nudge the sprite up or down by whole art
// pixels (0 to PLANT_IN_BETWEEN_LIFT_PX). With 2 in-betweens the five
// stages give 13 frames; with 0 they stay the five stage frames. The list
// is built once per quality change; picking a frame allocates nothing. No
// DOM or Three.js, so it runs under node --test.

import { PLANT_IN_BETWEEN_LIFT_PX } from '../config.js';

// The frames of a growth of `stageCount` stage frames with `inBetween`
// frames between each two neighbours, in order. Each frame is frozen:
//   from, to  the two sheet frames it shows (equal for a stage frame)
//   mix       how much of `to` it shows, 0 (all `from`) to 1
//   liftPx    whole art pixels the sprite moves up (below 0: down)
// `topRows` (optional, one per stage frame) is the highest visible row of
// each stage frame, counted from the bottom. Where the plant grows taller
// the in-betweens start lower and rise towards the next frame's height, and
// where it shrinks they start higher, so its top moves in small steps; the
// nudge never passes PLANT_IN_BETWEEN_LIFT_PX and is 0 on stage frames.
export function plantFrames(stageCount, inBetween, topRows = null) {
  const steps = Math.max(0, Math.floor(inBetween) || 0);
  const frames = [];
  for (let stage = 0; stage < stageCount; stage++) {
    frames.push(Object.freeze({ from: stage, to: stage, mix: 0, liftPx: 0 }));
    if (stage === stageCount - 1) break;
    const grow = topRows ? topRows[stage + 1] - topRows[stage] : 0;
    const reach = Math.max(-PLANT_IN_BETWEEN_LIFT_PX, Math.min(PLANT_IN_BETWEEN_LIFT_PX, grow));
    for (let k = 1; k <= steps; k++) {
      const mix = k / (steps + 1);
      // Math.round(-0) is -0; + 0 keeps the lift a plain 0.
      frames.push(Object.freeze({ from: stage, to: stage + 1, mix, liftPx: -Math.round(reach * (1 - mix)) + 0 }));
    }
  }
  return Object.freeze(frames);
}

// Index into plantFrames(…, inBetween) of a plant at growth stage `frame`
// with `progress` (0 to 1) through it (growthStageInto in growth.js): each
// stage shows its own frame for the first share and then its in-betweens
// towards the next stage, all equally long. The last stage (Rest) is the
// last frame.
export function plantFrameIndex(frame, progress, stageCount, inBetween) {
  const per = inBetween + 1;
  if (frame >= stageCount - 1) return (stageCount - 1) * per;
  const step = Math.min(inBetween, Math.max(0, Math.floor(progress * per)));
  return Math.max(0, frame) * per + step;
}

// The cross-fade of an in-between frame keeps every art pixel whole: the
// plant is cut out by the alpha test, so a pixel cannot be half there.
// Instead each art pixel (x, y) of the sheet gets a fixed threshold from a
// 4 x 4 ordered pattern, and it shows where the two frames' mixed cover
// passes it. A pixel in both frames always shows, its colour mixed; a pixel
// only in the old frame shows on about (1 - mix) of the pixels, one only in
// the new frame on about mix of them, so both visibly fade, crisp and still.
// The shader in sprites.js uses FADE_THRESHOLD_GLSL, the same formula.
function bayer2(x, y) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const v = fx * 0.5 + fy * fy * 0.75;
  return v - Math.floor(v);
}

// The threshold of art pixel (x, y), one of 1/32, 3/32 … 31/32.
export function fadeThreshold(x, y) {
  return bayer2(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y) + 1 / 32;
}

// The mixed cover of a pixel with alpha `fromA` in the old frame and `toA`
// in the new one (0 to 1 each), `mix` of the way along.
export function fadeCover(fromA, toA, mix) {
  return fromA * (1 - mix) + toA * mix;
}

// Whether art pixel (x, y) shows in the cross-fade.
export function fadeShows(fromA, toA, mix, x, y) {
  return fadeCover(fromA, toA, mix) > fadeThreshold(x, y);
}

export const FADE_THRESHOLD_GLSL = `float plantBayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float plantFadeThreshold(vec2 p) {
  return plantBayer2(p * 0.5) * 0.25 + plantBayer2(p) + ${(1 / 32).toFixed(6)};
}`;
