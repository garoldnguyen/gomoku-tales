// Pure wind petal math (docs/art-direction-v3.md section 7, High only):
// the three lanes of petals, leaves and seed flecks from wind-bits, where
// each petal is at any time, its ghost trail and the fade of near-lane
// petals over the field. A petal's place is a function of time alone, so a
// ghost is simply the petal a few ms earlier. Nothing here allocates per
// call. No Three.js imports, so this runs under node --test.

import {
  BOARD_SIZE, CELL_SIZE, CURB_PX, PETAL_BOB, PETAL_BOB_MS, PETAL_END_FADE, PETAL_FIELD_FADE, PETAL_FLUTTER,
  PETAL_FLUTTER_MS, PETAL_TRAIL_ALPHA, PETAL_TRAIL_MS, PETAL_TUMBLE_MS, PX_WORLD, WIND_LANES,
} from '../config.js';
import { seededRandom } from './seeded-random.js';
import { WIND_GROUND } from './wind.js';

export const LANE_NAMES = Object.freeze(['far', 'mid', 'near']);
// Frames of wind-bits: petal pink, white, yellow, lilac, leaf, seed fleck.
// Petals are the most common.
export const BIT_WEIGHTS = Object.freeze([3, 3, 3, 3, 2, 1]);
const PETAL_SEED = 5150;
// Across the wind on the ground, a quarter turn from it.
const ACROSS = Object.freeze({ x: -WIND_GROUND.z, z: WIND_GROUND.x });
// The field and its curb, half its width.
const FIELD_HALF = (BOARD_SIZE * CELL_SIZE) / 2 + CURB_PX * PX_WORLD;

// World units per second of a lane's petals along the ground: its speed
// along the wind.
export function laneVelocity(laneName) {
  const { speed } = WIND_LANES[laneName];
  return { x: WIND_GROUND.x * speed, z: WIND_GROUND.z * speed };
}

function pick(weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  let t = r * total;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i];
    if (t < 0) return i;
  }
  return weights.length - 1;
}

// The petals of every lane: { lane, frame, start, across, height, phases }.
// `start` is where along the lane it is at time 0 (0 to 1), `across` its
// place across the lane (-0.5 to 0.5), `height` 0 to 1 within the lane's
// heights. Same seed, same petals.
export function planPetals(seed = PETAL_SEED) {
  const random = seededRandom(seed);
  const petals = [];
  for (const lane of LANE_NAMES) {
    const { count } = WIND_LANES[lane];
    for (let i = 0; i < count; i++) {
      petals.push({
        lane,
        frame: pick(BIT_WEIGHTS, random()),
        start: (i + random()) / count,
        across: random() - 0.5,
        height: random(),
        bobPhase: random() * Math.PI * 2,
        flutterPhase: random() * Math.PI * 2,
        tumblePhase: random() * Math.PI * 2,
      });
    }
  }
  return petals;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

// How much a near-lane petal at (x, y, z) shows, seen from `camera` { x,
// y, z }: 0 while it is in front of the field (or its curb) on screen,
// rising to 1 over PETAL_FIELD_FADE cells past its edge.
export function fieldFade(x, y, z, camera) {
  if (!(y < camera.y)) return 1;
  // Where the line from the camera through the petal meets the board top.
  const t = camera.y / (camera.y - y);
  const gx = camera.x + (x - camera.x) * t;
  const gz = camera.z + (z - camera.z) * t;
  const outside = Math.max(Math.abs(gx), Math.abs(gz)) - FIELD_HALF;
  return smoothstep(0, PETAL_FIELD_FADE * CELL_SIZE, outside);
}

// Writes into `out` where `petal` is at `timeMs`: x, y, z (its centre),
// alpha (it fades in and out at the lane's ends, and near-lane petals fade
// out over the field as seen from `camera`) and flip (+1 or -1, it tumbles).
// Returns `out`.
export function petalAt(petal, timeMs, camera, out) {
  const lane = WIND_LANES[petal.lane];
  const along = (((petal.start + (lane.speed * timeMs) / 1000 / lane.length) % 1) + 1) % 1; // 0 to 1, wraps
  const s = (along - 0.5) * lane.length;
  const a = petal.across * lane.width + PETAL_FLUTTER * Math.sin((timeMs / PETAL_FLUTTER_MS) * Math.PI * 2 + petal.flutterPhase);
  out.x = lane.centre[0] + WIND_GROUND.x * s + ACROSS.x * a;
  out.z = lane.centre[1] + WIND_GROUND.z * s + ACROSS.z * a;
  out.y = lane.height[0] + petal.height * (lane.height[1] - lane.height[0])
    + PETAL_BOB * Math.sin((timeMs / PETAL_BOB_MS) * Math.PI * 2 + petal.bobPhase);
  out.alpha = smoothstep(0, PETAL_END_FADE, along) * smoothstep(0, PETAL_END_FADE, 1 - along);
  if (petal.lane === 'near') out.alpha *= fieldFade(out.x, out.y, out.z, camera);
  out.flip = Math.sin((timeMs / PETAL_TUMBLE_MS) * Math.PI * 2 + petal.tumblePhase) < 0 ? -1 : 1;
  return out;
}

// Writes into `out` ghost `k` (0, 1, 2) of `petal`'s trail at `timeMs`:
// the petal PETAL_TRAIL_MS[k] earlier, at PETAL_TRAIL_ALPHA[k] of its
// alpha then. Returns `out`.
export function trailAt(petal, timeMs, k, camera, out) {
  petalAt(petal, timeMs - PETAL_TRAIL_MS[k], camera, out);
  out.alpha *= PETAL_TRAIL_ALPHA[k];
  return out;
}

// A place to write petalAt and trailAt results into.
export function petalPoint() {
  return { x: 0, y: 0, z: 0, alpha: 0, flip: 1 };
}
