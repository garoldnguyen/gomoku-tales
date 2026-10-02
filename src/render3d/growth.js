// Pure growth timing of a plant (docs/art-direction-v3.md section 4): a
// move is a seed that grows through the stages Drop, Land, Sprout, Open and
// Rest (frame index = stage) at the stage start times from v3-meta.js. It
// only animates; it never blocks input and never changes the rules. No DOM
// or Three.js, so it runs under node --test. The `Into` functions write into
// an object the caller keeps, so the per-frame update never allocates.

import {
  PLANT_DROP_MS, PLANT_DROP_PX, PLANT_OPEN_POP_MS, PLANT_OPEN_POP_SCALE,
} from '../config.js';

export const STAGE_DROP = 0;
export const STAGE_LAND = 1;
export const STAGE_SPROUT = 2;
export const STAGE_OPEN = 3;
export const STAGE_REST = 4;

// Stage of a plant `elapsedMs` after its seed was planted: { frame,
// progress } where frame is the stage (and sheet frame) index and progress
// runs from 0 at the stage start towards 1 at the next stage's start. Rest
// has no end, so it is { frame: last, progress: 1 }; so is any time past
// the end, and Infinity (a plant that already stood there). Times before 0
// (or not a number) are the start of Drop.
export function growthStage(elapsedMs, stageStartMs) {
  return growthStageInto(elapsedMs, stageStartMs, { frame: 0, progress: 0 });
}

export function growthStageInto(elapsedMs, stageStartMs, out) {
  const last = stageStartMs.length - 1;
  if (!(elapsedMs > 0)) {
    out.frame = 0;
    out.progress = 0;
    return out;
  }
  if (elapsedMs >= stageStartMs[last]) {
    out.frame = last;
    out.progress = 1;
    return out;
  }
  let frame = 0;
  while (frame < last - 1 && elapsedMs >= stageStartMs[frame + 1]) frame++;
  const from = stageStartMs[frame];
  out.frame = frame;
  out.progress = (elapsedMs - from) / (stageStartMs[frame + 1] - from);
  return out;
}

// How many art pixels above the plot the seed still is `elapsedMs` after
// planting: PLANT_DROP_PX at 0, sliding down with an ease in (slow first,
// fast at the end) to 0 at PLANT_DROP_MS, and 0 from then on.
export function dropOffsetPx(elapsedMs) {
  if (!(elapsedMs > 0)) return PLANT_DROP_PX;
  if (elapsedMs >= PLANT_DROP_MS) return 0;
  const t = elapsedMs / PLANT_DROP_MS;
  return PLANT_DROP_PX * (1 - t * t);
}

// Scale of the bloom `msSinceOpen` after the Open stage started: 1.0 rising
// to PLANT_OPEN_POP_SCALE halfway through PLANT_OPEN_POP_MS and back to 1.0;
// exactly 1 before and after.
export function openPopScale(msSinceOpen) {
  if (!(msSinceOpen > 0) || msSinceOpen >= PLANT_OPEN_POP_MS) return 1;
  return 1 + (PLANT_OPEN_POP_SCALE - 1) * Math.sin((Math.PI * msSinceOpen) / PLANT_OPEN_POP_MS);
}

// Everything a plant sprite shows `elapsedMs` after planting, written into
// out: frame, progress, dropPx (art pixels above the plot) and scale.
export function plantPoseInto(elapsedMs, stageStartMs, out) {
  growthStageInto(elapsedMs, stageStartMs, out);
  out.dropPx = dropOffsetPx(elapsedMs);
  out.scale = openPopScale(elapsedMs - stageStartMs[STAGE_OPEN]);
  return out;
}

// True when a plant that showed stage `previous` last frame and shows
// `frame` now has just entered `stage` and is still growing (not yet at
// Rest), so a stage cue (the Land soil puff, the Open sparkles) plays once
// and never for a plant that jumped straight to Rest (a hidden tab).
export function enteredStage(previous, frame, stage) {
  return previous < stage && frame >= stage && frame < STAGE_REST;
}

// The cells { x, y, player } where the events planted a seed (a placed
// move). Plants that a skill moves or converts are not new seeds.
export function plantedCells(events) {
  const cells = [];
  for (const event of events) {
    if (event.type === 'stonePlaced') cells.push({ x: event.x, y: event.y, player: event.player });
  }
  return cells;
}
