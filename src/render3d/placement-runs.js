// The placement effects playing on the field (effects3d.js): one run per
// planted seed, playing the frozen plan of its character's effect
// (placementPlan in character-look.js). Each step of a plan starts exactly
// once, when the run's age passes its startMs, and the run ends when its
// plan has played out. The runs are a fixed set of records made once, so
// stepping them allocates nothing. Pure: no DOM or Three.js imports.

import { VINE_POINTS } from '../config.js';
import { planDurationMs } from './character-look.js';

const NO_PLAN = Object.freeze([]);
const TWO_PI = Math.PI * 2;
const AT_EPSILON = 0.001; // world units: two centres this close are the same plot

// `slots` run records: { active, plan, x, z, start, lastMs, durationMs, vine }.
export function createPlacementRuns(slots) {
  const runs = [];
  for (let i = 0; i < slots; i++) {
    runs.push({ active: false, plan: NO_PLAN, x: 0.5, z: 0.5, start: 0.5, lastMs: -1, durationMs: 0.5, vine: false });
  }
  return runs;
}

// Starts `plan` on the plot centre (x, z) at `time` in a free record, or
// in the oldest one when all are playing. Returns the record.
export function startPlacementRun(runs, plan, x, z, time) {
  let run = runs[0];
  for (let i = 0; i < runs.length; i++) {
    if (!runs[i].active) {
      run = runs[i];
      break;
    }
    if (runs[i].start < run.start) run = runs[i];
  }
  run.active = plan.length > 0;
  run.plan = plan;
  run.x = x;
  run.z = z;
  run.start = time;
  run.lastMs = -1; // every step starts at 0 ms or later
  run.durationMs = planDurationMs(plan);
  run.vine = plan.some((step) => step.kind === 'vineCoil');
  return run;
}

// Advances every playing run to `time`: onStep(step, run) once for each
// step whose start time has come since the last call, then the runs whose
// plan is over end.
export function stepPlacementRuns(runs, time, onStep) {
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (!run.active) continue;
    const age = time - run.start;
    if (age < 0) continue;
    const { plan } = run;
    for (let s = 0; s < plan.length; s++) {
      const step = plan[s];
      if (step.startMs > run.lastMs && step.startMs <= age) onStep(step, run);
    }
    run.lastMs = age;
    if (age >= run.durationMs) run.active = false;
  }
}

// The runs playing on the plot centre (x, z) stop at once (the plot became
// covered for the viewer).
export function stopRunsAt(runs, x, z) {
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.active && Math.abs(run.x - x) < AT_EPSILON && Math.abs(run.z - z) < AT_EPSILON) run.active = false;
  }
}

// Every run stops at once (a new game).
export function clearPlacementRuns(runs) {
  for (let r = 0; r < runs.length; r++) runs[r].active = false;
}

// The dots of the vine of a vineCoil plan `ageMs` into it, relative to
// the plot centre, written into `out` (x, y, z per dot, room for
// VINE_POINTS): VINE_POINTS dots spaced evenly along the whole vine (up
// its rise, then round its coil). The vine grows out of the soil over the
// rise and the coil steps, then sinks back over the sink step; dots below
// the ground are left out. Returns how many dots it wrote (0 when the
// plan has no vine or it is not showing).
export function vinePointsInto(plan, ageMs, out) {
  let rise = null;
  let coil = null;
  let sink = null;
  for (let i = 0; i < plan.length; i++) {
    const kind = plan[i].kind;
    if (kind === 'vineRise') rise = plan[i];
    else if (kind === 'vineCoil') coil = plan[i];
    else if (kind === 'vineSink') sink = plan[i];
  }
  if (rise === null || coil === null || sink === null) return 0;
  if (ageMs < rise.startMs || ageMs >= sink.startMs + sink.durationMs) return 0;
  const riseLength = Math.abs(rise.to[1] - rise.from[1]);
  const coilLength = Math.hypot(TWO_PI * coil.turns * coil.radius, coil.to[1] - coil.from[1]);
  const split = riseLength / Math.max(riseLength + coilLength, 1e-6); // the share of the vine that is its rise
  const head = ageMs < coil.startMs
    ? split * clamp01((ageMs - rise.startMs) / rise.durationMs)
    : split + (1 - split) * clamp01((ageMs - coil.startMs) / coil.durationMs);
  const drop = clamp01((ageMs - sink.startMs) / sink.durationMs) * (coil.to[1] - sink.to[1]);
  let n = 0;
  for (let i = 0; i < VINE_POINTS; i++) {
    const u = i / (VINE_POINTS - 1);
    if (u > head) break;
    let x;
    let y;
    let z;
    if (u < split) {
      const t = u / split;
      x = rise.from[0];
      y = rise.from[1] + (rise.to[1] - rise.from[1]) * t;
      z = rise.from[2];
    } else {
      const t = split < 1 ? (u - split) / (1 - split) : 1;
      const angle = t * coil.turns * TWO_PI;
      x = Math.cos(angle) * coil.radius;
      y = coil.from[1] + (coil.to[1] - coil.from[1]) * t;
      z = Math.sin(angle) * coil.radius;
    }
    y -= drop;
    if (y < 0) continue;
    out[n * 3] = x;
    out[n * 3 + 1] = y;
    out[n * 3 + 2] = z;
    n++;
  }
  return n;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
